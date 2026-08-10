import type { components, operations } from "../generated/fundflow.js";
import { TokenManager } from "../core/auth.js";
import { HttpClient, type RequestOptions, type Transport } from "../core/http.js";
import { iteratePages, type Page, type PageParams } from "../core/pagination.js";
import { FundflowMockTransport, type VenlyFundflowMock } from "../mock/fundflow.js";

type schemas = components["schemas"];
type Query<Op extends keyof operations> = operations[Op]["parameters"] extends {
  query?: infer Q;
}
  ? NonNullable<Q>
  : never;

export type CallOptions = Pick<RequestOptions, "headers" | "signal" | "idempotencyKey">;

interface Envelope<T> {
  success?: boolean;
  result?: T;
  pagination?: schemas["Pagination"];
}

function unwrap<T>(res: Envelope<T>): T {
  return res.result as T;
}

function unwrapPage<T>(res: Envelope<T[]>): Page<T> {
  return {
    items: Array.isArray(res.result) ? res.result : [],
    resultPresent: Array.isArray(res.result),
    pagination: res.pagination,
  };
}

export type FundflowEnvironment = "production" | "staging" | "qa";

export interface FundflowCredentialOptions {
  clientId: string;
  clientSecret: string;
  /** Picks base + auth URLs. Default "production". */
  environment?: FundflowEnvironment;
  baseUrl?: string;
  tokenUrl?: string;
  fetch?: typeof fetch;
  maxAttempts?: number;
}

/**
 * Mock mode: zero credentials, zero network, fixture-backed. See `client.mock`.
 * Credential fields are accepted and ignored, so one options object can vary
 * only its `environment` string across environments.
 */
export interface FundflowMockOptions {
  environment: "mock";
  clientId?: string;
  clientSecret?: string;
  baseUrl?: string;
  tokenUrl?: string;
  fetch?: typeof fetch;
  maxAttempts?: number;
}

export type FundflowClientOptions = FundflowCredentialOptions | FundflowMockOptions;

const FUNDFLOW_URLS: Record<FundflowEnvironment, { base: string; token: string }> = {
  production: {
    base: "https://api-fundflow.venly.io",
    token: "https://login.venly.io/auth/realms/VenlyFinance/protocol/openid-connect/token",
  },
  staging: {
    base: "https://api-fundflow-staging.venly.io",
    token:
      "https://login-sandbox.venly.io/auth/realms/VenlyFinance/protocol/openid-connect/token",
  },
  qa: {
    base: "https://api-fundflow-qa.venly.io",
    token: "https://login-qa.venly.io/auth/realms/VenlyFinance/protocol/openid-connect/token",
  },
};

/**
 * Client for the Fundflow API: on/off-ramp requests with four-eyes
 * (maker-checker) approvals, fee calculation and reference data.
 * Company/user admin endpoints are reachable through `request()`.
 */
export class FundflowClient {
  readonly rampRequests: RampRequestsResource;
  readonly fees: FeesResource;
  readonly referenceData: ReferenceDataResource;
  readonly bankAccounts: CompanyBankAccountsResource;
  readonly companyWallets: CompanyWalletsResource;

  private readonly http: Transport;

  /**
   * Mock controls (call log, failNext, advanceRamp,
   * advanceBankAccountVerification, advanceCompanyWalletVerification,
   * reset); defined only when `environment: "mock"`.
   */
  readonly mock?: VenlyFundflowMock;

  constructor(options: FundflowClientOptions) {
    if (options.environment === "mock") {
      // Zero network by construction: no TokenManager, no HttpClient, no fetch.
      const transport = new FundflowMockTransport();
      this.http = transport;
      this.mock = transport;
    } else {
      const env = FUNDFLOW_URLS[options.environment ?? "production"];
      const fetchImpl = options.fetch ?? fetch;
      const tokenManager = new TokenManager({
        tokenUrl: options.tokenUrl ?? env.token,
        clientId: options.clientId,
        clientSecret: options.clientSecret,
        fetch: fetchImpl,
      });
      this.http = new HttpClient({
        baseUrl: options.baseUrl ?? env.base,
        tokenManager,
        fetch: fetchImpl,
        maxAttempts: options.maxAttempts,
      });
    }
    this.rampRequests = new RampRequestsResource(this.http);
    this.fees = new FeesResource(this.http);
    this.referenceData = new ReferenceDataResource(this.http);
    this.bankAccounts = new CompanyBankAccountsResource(this.http);
    this.companyWallets = new CompanyWalletsResource(this.http);
  }

  /** Escape hatch with auth, retries and idempotency still applied. */
  request<T = unknown>(method: string, path: string, options?: RequestOptions): Promise<T> {
    return this.http.request<T>(method, path, options);
  }
}

export class RampRequestsResource {
  constructor(private readonly http: Transport) {}

  list(
    query?: Query<"getAll">,
    opts?: CallOptions,
  ): Promise<Page<schemas["RampRequestListItem"]>> {
    return this.http
      .request<Envelope<schemas["RampRequestListItem"][]>>("GET", "/v1/ramp-requests", {
        query,
        ...opts,
      })
      .then(unwrapPage);
  }

  iterate(
    query?: Omit<Query<"getAll">, "page">,
  ): AsyncGenerator<schemas["RampRequestListItem"]> {
    return iteratePages(
      (p: PageParams) => this.list({ ...query, page: p.page, size: p.size }),
      { size: query?.size },
    );
  }

  create(
    body: schemas["CreateRampRequestRequest"],
    opts?: CallOptions,
  ): Promise<schemas["RampRequestDto"]> {
    return this.http
      .request<Envelope<schemas["RampRequestDto"]>>("POST", "/v1/ramp-requests", {
        body,
        ...opts,
      })
      .then(unwrap);
  }

  get(id: string, opts?: CallOptions): Promise<schemas["RampRequestDto"]> {
    return this.http
      .request<Envelope<schemas["RampRequestDto"]>>("GET", `/v1/ramp-requests/${id}`, opts)
      .then(unwrap);
  }

  /**
   * Four-eyes: approver must differ from the creator. Pass the optimistic-
   * locking `{ version }` read from `get()` to guard concurrent edits.
   */
  approve(
    id: string,
    body?: schemas["UpdateWithOptimisticLockingRequest"],
    opts?: CallOptions,
  ): Promise<schemas["RampRequestDto"]> {
    return this.http
      .request<Envelope<schemas["RampRequestDto"]>>("POST", `/v1/ramp-requests/${id}/approve`, {
        body,
        ...opts,
      })
      .then(unwrap);
  }

  reject(
    id: string,
    body?: schemas["UpdateWithOptimisticLockingRequest"],
    opts?: CallOptions,
  ): Promise<schemas["RampRequestDto"]> {
    return this.http
      .request<Envelope<schemas["RampRequestDto"]>>("POST", `/v1/ramp-requests/${id}/reject`, {
        body,
        ...opts,
      })
      .then(unwrap);
  }

  cancel(
    id: string,
    body?: schemas["UpdateWithOptimisticLockingRequest"],
    opts?: CallOptions,
  ): Promise<schemas["RampRequestDto"]> {
    return this.http
      .request<Envelope<schemas["RampRequestDto"]>>("POST", `/v1/ramp-requests/${id}/cancel`, {
        body,
        ...opts,
      })
      .then(unwrap);
  }

  setAmount(
    id: string,
    body: schemas["EditRampAmountRequest"],
    opts?: CallOptions,
  ): Promise<schemas["RampRequestDto"]> {
    return this.http
      .request<Envelope<schemas["RampRequestDto"]>>("PUT", `/v1/ramp-requests/${id}/amount`, {
        body,
        ...opts,
      })
      .then(unwrap);
  }

  initiate(
    id: string,
    body: schemas["UpdateRampRequestTransactionHashRequest"],
    opts?: CallOptions,
  ): Promise<schemas["RampRequestDto"]> {
    return this.http
      .request<Envelope<schemas["RampRequestDto"]>>(
        "PATCH",
        `/v1/ramp-requests/${id}/initiate`,
        { body, ...opts },
      )
      .then(unwrap);
  }

  setTxHash(
    id: string,
    body: schemas["UpdateRampRequestTransactionHashRequest"],
    opts?: CallOptions,
  ): Promise<schemas["RampRequestDto"]> {
    return this.http
      .request<Envelope<schemas["RampRequestDto"]>>(
        "PATCH",
        `/v1/ramp-requests/${id}/tx-hash`,
        { body, ...opts },
      )
      .then(unwrap);
  }

  onRampPairs(opts?: CallOptions): Promise<schemas["OnRampPair"][]> {
    return this.http
      .request<Envelope<schemas["OnRampPair"][]>>("GET", "/v1/ramp-requests/on-ramp/pairs", opts)
      .then((res) => res.result ?? []);
  }

  offRampPairs(opts?: CallOptions): Promise<schemas["OffRampPair"][]> {
    return this.http
      .request<Envelope<schemas["OffRampPair"][]>>(
        "GET",
        "/v1/ramp-requests/off-ramp/pairs",
        opts,
      )
      .then((res) => res.result ?? []);
  }

  /** CSV export of ramp requests (audit trail). Returns the raw CSV string. */
  export(query?: Query<"exportRampRequests">, opts?: CallOptions): Promise<string> {
    return this.http.request<string>("GET", "/v1/ramp-requests/export", {
      query,
      ...opts,
      responseType: "text",
      headers: { Accept: "text/csv", ...opts?.headers },
    });
  }
}

export class FeesResource {
  constructor(private readonly http: Transport) {}

  calculate(
    body: schemas["CalculateFeeRequest"],
    opts?: CallOptions,
  ): Promise<schemas["CalculatedFeeDto"]> {
    return this.http
      .request<Envelope<schemas["CalculatedFeeDto"]>>("POST", "/v1/fees/calculate", {
        body,
        ...opts,
      })
      .then(unwrap);
  }

  listCompanyFees(opts?: CallOptions): Promise<schemas["FeeDto"][]> {
    return this.http
      .request<Envelope<schemas["FeeDto"][]>>("GET", "/v1/fees", opts)
      .then((res) => res.result ?? []);
  }
}

export class ReferenceDataResource {
  constructor(private readonly http: Transport) {}

  fiatCurrencies(opts?: CallOptions): Promise<schemas["FiatCurrencyDto"][]> {
    return this.http
      .request<Envelope<schemas["FiatCurrencyDto"][]>>("GET", "/v1/fiat-currencies", opts)
      .then((res) => res.result ?? []);
  }

  cryptoCurrencies(opts?: CallOptions): Promise<schemas["CryptoCurrencyDto"][]> {
    return this.http
      .request<Envelope<schemas["CryptoCurrencyDto"][]>>("GET", "/v1/crypto-currencies", opts)
      .then((res) => res.result ?? []);
  }

  chains(opts?: CallOptions): Promise<schemas["SupportedChainsDto"][]> {
    return this.http
      .request<Envelope<schemas["SupportedChainsDto"][]>>("GET", "/v1/chains", opts)
      .then((res) => res.result ?? []);
  }

  fiatCurrency(id: string, opts?: CallOptions): Promise<schemas["FiatCurrencyDto"]> {
    return this.http
      .request<Envelope<schemas["FiatCurrencyDto"]>>("GET", `/v1/fiat-currencies/${id}`, opts)
      .then(unwrap);
  }

  cryptoCurrency(id: string, opts?: CallOptions): Promise<schemas["CryptoCurrencyDto"]> {
    return this.http
      .request<Envelope<schemas["CryptoCurrencyDto"]>>("GET", `/v1/crypto-currencies/${id}`, opts)
      .then(unwrap);
  }

  /** Venly's deposit wallets: where ownership-proof and off-ramp crypto go. */
  depositWallets(
    query?: { chain?: string },
    opts?: CallOptions,
  ): Promise<schemas["DepositWalletDto"][]> {
    return this.http
      .request<Envelope<schemas["DepositWalletDto"][]>>("GET", "/v1/deposit-wallets", {
        query,
        ...opts,
      })
      .then((res) => res.result ?? []);
  }

  /** Which bank-account types/countries/currencies whitelisting accepts. */
  bankAccountConfig(opts?: CallOptions): Promise<schemas["BankAccountConfigDto"]> {
    return this.http
      .request<Envelope<schemas["BankAccountConfigDto"]>>("GET", "/v1/bank-accounts/config", opts)
      .then(unwrap);
  }
}

/**
 * Company bank-account detail as the wire actually returns it: the base DTO
 * plus the per-variant fields (iban/bic for EUR_SEPA, accountNumber/sortCode
 * for GBP_*, accountNumber/routingNumber for USD_*, currency for OTHER_SWIFT).
 *
 * Deliberately NOT the generated oneOf union: the spec's discriminator
 * mapping emits variant type names (e.g. "EurSepaCompanyBankAccountDto") as
 * the discriminator values, which is not what the API sends. The base DTO's
 * own `bankAccountType` enum ("EUR_SEPA", ...) is the real discriminator.
 * Tracked as a contract-hygiene item on the API side.
 */
export type CompanyBankAccountDetails = schemas["CompanyBankAccountDto"] & {
  iban?: string;
  bic?: string;
  intermediaryBic?: string;
  intermediaryBankName?: string;
  accountNumber?: string;
  sortCode?: string;
  routingNumber?: string;
  bankStreetAddress?: string;
  bankCity?: string;
  bankPostalCode?: string;
  currency?: string;
};

/** Create input: common required fields plus the chosen variant's fields. */
export type CreateCompanyBankAccountInput = schemas["CreateCompanyBankAccountRequest"] & {
  iban?: string;
  bic?: string;
  intermediaryBic?: string;
  intermediaryBankName?: string;
  accountNumber?: string;
  sortCode?: string;
  routingNumber?: string;
  bankStreetAddress?: string;
  bankCity?: string;
  bankPostalCode?: string;
  beneficiaryState?: string;
  email?: string;
  phoneNumber?: string;
  currency?: string;
};

export class CompanyBankAccountsResource {
  constructor(private readonly http: Transport) {}

  /**
   * Whitelisted destinations for OFF_RAMP payouts. Accounts are created
   * PENDING and must reach VERIFIED before a ramp request can target them.
   */
  list(
    query?: Query<"getAll_2">,
    opts?: CallOptions,
  ): Promise<Page<schemas["CompanyBankAccountListItem"]>> {
    return this.http
      .request<Envelope<schemas["CompanyBankAccountListItem"][]>>(
        "GET",
        "/v1/company-bank-accounts",
        { query, ...opts },
      )
      .then(unwrapPage);
  }

  create(body: CreateCompanyBankAccountInput, opts?: CallOptions): Promise<CompanyBankAccountDetails> {
    return this.http
      .request<Envelope<CompanyBankAccountDetails>>("POST", "/v1/company-bank-accounts", {
        body,
        ...opts,
      })
      .then(unwrap);
  }

  get(id: string, opts?: CallOptions): Promise<CompanyBankAccountDetails> {
    return this.http
      .request<Envelope<CompanyBankAccountDetails>>("GET", `/v1/company-bank-accounts/${id}`, opts)
      .then(unwrap);
  }

  /** Only the display name is mutable; carries the optimistic-locking version. */
  update(
    id: string,
    body: schemas["UpdateCompanyBankAccountRequest"],
    opts?: CallOptions,
  ): Promise<CompanyBankAccountDetails> {
    return this.http
      .request<Envelope<CompanyBankAccountDetails>>(
        "PATCH",
        `/v1/company-bank-accounts/${id}`,
        { body, ...opts },
      )
      .then(unwrap);
  }
}

export class CompanyWalletsResource {
  constructor(private readonly http: Transport) {}

  /**
   * Whitelisted destinations for ON_RAMP crypto. Wallets are created PENDING;
   * ownership is proven out-of-band (a small transfer from the wallet to a
   * Venly deposit wallet) before they reach VERIFIED.
   */
  list(
    query?: Query<"getAll_1">,
    opts?: CallOptions,
  ): Promise<Page<schemas["CompanyWalletListItem"]>> {
    return this.http
      .request<Envelope<schemas["CompanyWalletListItem"][]>>("GET", "/v1/company-wallets", {
        query,
        ...opts,
      })
      .then(unwrapPage);
  }

  create(
    body: schemas["CreateCompanyWalletRequest"],
    opts?: CallOptions,
  ): Promise<schemas["CompanyWalletDto"]> {
    return this.http
      .request<Envelope<schemas["CompanyWalletDto"]>>("POST", "/v1/company-wallets", {
        body,
        ...opts,
      })
      .then(unwrap);
  }

  get(id: string, opts?: CallOptions): Promise<schemas["CompanyWalletDto"]> {
    return this.http
      .request<Envelope<schemas["CompanyWalletDto"]>>("GET", `/v1/company-wallets/${id}`, opts)
      .then(unwrap);
  }

  /** Only the description is mutable; carries the optimistic-locking version. */
  update(
    id: string,
    body: schemas["UpdateCompanyWalletRequest"],
    opts?: CallOptions,
  ): Promise<schemas["CompanyWalletDto"]> {
    return this.http
      .request<Envelope<schemas["CompanyWalletDto"]>>("PATCH", `/v1/company-wallets/${id}`, {
        body,
        ...opts,
      })
      .then(unwrap);
  }
}
