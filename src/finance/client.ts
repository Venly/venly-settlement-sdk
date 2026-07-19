import type { components, operations } from "../generated/finance.js";
import { TokenManager } from "../core/auth.js";
import { HttpClient, type RequestOptions } from "../core/http.js";
import { iteratePages, type Page, type PageParams } from "../core/pagination.js";

type schemas = components["schemas"];
type Query<Op extends keyof operations> = operations[Op]["parameters"] extends {
  query?: infer Q;
}
  ? NonNullable<Q>
  : never;

/** Per-call options accepted by every resource method. */
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
  return { items: res.result ?? [], pagination: res.pagination };
}

export type FinanceEnvironment = "production" | "staging";

export interface VenlyFinanceClientOptions {
  clientId: string;
  clientSecret: string;
  /** Picks base + auth URLs. Default "production". */
  environment?: FinanceEnvironment;
  /** Override the API base URL (takes precedence over `environment`). */
  baseUrl?: string;
  /** Override the OAuth2 token URL (takes precedence over `environment`). */
  tokenUrl?: string;
  /** Custom fetch implementation (testing, instrumentation). Default: global fetch. */
  fetch?: typeof fetch;
  /** Total attempts per request including the first. Default 3. */
  maxAttempts?: number;
}

const FINANCE_URLS: Record<FinanceEnvironment, { base: string; token: string }> = {
  production: {
    base: "https://api.venlyfinance.com/api/v1",
    token: "https://login.venly.io/auth/realms/VenlyFinance/protocol/openid-connect/token",
  },
  staging: {
    base: "https://api-staging.venlyfinance.com/api/v1",
    token:
      "https://login-sandbox.venly.io/auth/realms/VenlyFinance/protocol/openid-connect/token",
  },
};

/**
 * Client for the Venly Finance API: parties, accounts, wallets, virtual bank
 * accounts, payment links, payment requests, transfers and permits.
 *
 * ```ts
 * const venly = new VenlyFinanceClient({
 *   clientId: process.env.VENLY_CLIENT_ID!,
 *   clientSecret: process.env.VENLY_CLIENT_SECRET!,
 *   environment: "staging",
 * });
 * const party = await venly.parties.create({
 *   partyType: "INDIVIDUAL", firstName: "Ada", lastName: "Lovelace",
 * });
 * ```
 */
export class VenlyFinanceClient {
  readonly parties: PartiesResource;
  readonly accounts: AccountsResource;
  readonly wallets: WalletsResource;
  readonly virtualBankAccounts: VirtualBankAccountsResource;
  readonly paymentLinks: PaymentLinksResource;
  readonly paymentRequests: PaymentRequestsResource;
  readonly transfers: TransfersResource;
  readonly accountToAccountTransfers: AccountToAccountTransfersResource;
  readonly permits: PermitsResource;
  readonly allowances: AllowancesResource;

  private readonly http: HttpClient;

  constructor(options: VenlyFinanceClientOptions) {
    const env = FINANCE_URLS[options.environment ?? "production"];
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
    this.parties = new PartiesResource(this.http);
    this.accounts = new AccountsResource(this.http);
    this.wallets = new WalletsResource(this.http);
    this.virtualBankAccounts = new VirtualBankAccountsResource(this.http);
    this.paymentLinks = new PaymentLinksResource(this.http);
    this.paymentRequests = new PaymentRequestsResource(this.http);
    this.transfers = new TransfersResource(this.http);
    this.accountToAccountTransfers = new AccountToAccountTransfersResource(this.http);
    this.permits = new PermitsResource(this.http);
    this.allowances = new AllowancesResource(this.http);
  }

  /**
   * Escape hatch for endpoints without a named wrapper. Auth, retries and
   * idempotency keys are still applied.
   */
  request<T = unknown>(method: string, path: string, options?: RequestOptions): Promise<T> {
    return this.http.request<T>(method, path, options);
  }
}

export class PartiesResource {
  constructor(private readonly http: HttpClient) {}

  list(query?: Query<"listParties">, opts?: CallOptions): Promise<Page<schemas["Party"]>> {
    return this.http
      .request<Envelope<schemas["Party"][]>>("GET", "/parties", { query, ...opts })
      .then(unwrapPage);
  }

  iterate(query?: Omit<Query<"listParties">, "page">): AsyncGenerator<schemas["Party"]> {
    return iteratePages(
      (p: PageParams) => this.list({ ...query, page: p.page, size: p.size }),
      { size: query?.size },
    );
  }

  create(body: schemas["CreatePartyRequest"], opts?: CallOptions): Promise<schemas["Party"]> {
    return this.http
      .request<Envelope<schemas["Party"]>>("POST", "/parties", { body, ...opts })
      .then(unwrap);
  }

  get(partyId: string, opts?: CallOptions): Promise<schemas["Party"]> {
    return this.http
      .request<Envelope<schemas["Party"]>>("GET", `/parties/${partyId}`, opts)
      .then(unwrap);
  }

  update(
    partyId: string,
    body: schemas["UpdatePartyRequest"],
    opts?: CallOptions,
  ): Promise<schemas["Party"]> {
    return this.http
      .request<Envelope<schemas["Party"]>>("PATCH", `/parties/${partyId}`, { body, ...opts })
      .then(unwrap);
  }

  delete(partyId: string, opts?: CallOptions): Promise<void> {
    return this.http.request<void>("DELETE", `/parties/${partyId}`, opts);
  }

  listAccounts(
    partyId: string,
    query?: Query<"listPartyAccounts">,
    opts?: CallOptions,
  ): Promise<Page<schemas["Account"]>> {
    return this.http
      .request<Envelope<schemas["Account"][]>>("GET", `/parties/${partyId}/accounts`, {
        query,
        ...opts,
      })
      .then(unwrapPage);
  }
}

export class AccountsResource {
  constructor(private readonly http: HttpClient) {}

  list(query?: Query<"listAccounts">, opts?: CallOptions): Promise<Page<schemas["Account"]>> {
    return this.http
      .request<Envelope<schemas["Account"][]>>("GET", "/accounts", { query, ...opts })
      .then(unwrapPage);
  }

  iterate(query?: Omit<Query<"listAccounts">, "page">): AsyncGenerator<schemas["Account"]> {
    return iteratePages(
      (p: PageParams) => this.list({ ...query, page: p.page, size: p.size }),
      { size: query?.size },
    );
  }

  create(body: schemas["CreateAccountRequest"], opts?: CallOptions): Promise<schemas["Account"]> {
    return this.http
      .request<Envelope<schemas["Account"]>>("POST", "/accounts", { body, ...opts })
      .then(unwrap);
  }

  get(accountId: string, opts?: CallOptions): Promise<schemas["Account"]> {
    return this.http
      .request<Envelope<schemas["Account"]>>("GET", `/accounts/${accountId}`, opts)
      .then(unwrap);
  }

  update(
    accountId: string,
    body: schemas["UpdateAccountRequest"],
    opts?: CallOptions,
  ): Promise<schemas["Account"]> {
    return this.http
      .request<Envelope<schemas["Account"]>>("PATCH", `/accounts/${accountId}`, {
        body,
        ...opts,
      })
      .then(unwrap);
  }

  delete(accountId: string, opts?: CallOptions): Promise<void> {
    return this.http.request<void>("DELETE", `/accounts/${accountId}`, opts);
  }

  suspend(accountId: string, opts?: CallOptions): Promise<schemas["Account"]> {
    return this.http
      .request<Envelope<schemas["Account"]>>("POST", `/accounts/${accountId}/suspend`, opts)
      .then(unwrap);
  }

  reactivate(accountId: string, opts?: CallOptions): Promise<schemas["Account"]> {
    return this.http
      .request<Envelope<schemas["Account"]>>("POST", `/accounts/${accountId}/reactivate`, opts)
      .then(unwrap);
  }

  listPartyRoles(
    accountId: string,
    query?: Query<"listAccountPartyRoles">,
    opts?: CallOptions,
  ): Promise<Page<schemas["PartyRole"]>> {
    return this.http
      .request<Envelope<schemas["PartyRole"][]>>("GET", `/accounts/${accountId}/party-roles`, {
        query,
        ...opts,
      })
      .then(unwrapPage);
  }

  addPartyRole(
    accountId: string,
    body: schemas["AddPartyRoleRequest"],
    opts?: CallOptions,
  ): Promise<schemas["PartyRole"]> {
    return this.http
      .request<Envelope<schemas["PartyRole"]>>("POST", `/accounts/${accountId}/party-roles`, {
        body,
        ...opts,
      })
      .then(unwrap);
  }

  removePartyRole(accountId: string, partyId: string, opts?: CallOptions): Promise<void> {
    return this.http.request<void>(
      "DELETE",
      `/accounts/${accountId}/party-roles/${partyId}`,
      opts,
    );
  }
}

export class WalletsResource {
  constructor(private readonly http: HttpClient) {}

  list(
    accountId: string,
    query?: Query<"listWallets">,
    opts?: CallOptions,
  ): Promise<Page<schemas["Wallet"]>> {
    return this.http
      .request<Envelope<schemas["Wallet"][]>>("GET", `/accounts/${accountId}/wallets`, {
        query,
        ...opts,
      })
      .then(unwrapPage);
  }

  create(
    accountId: string,
    body: schemas["CreateWalletRequest"],
    opts?: CallOptions,
  ): Promise<schemas["Wallet"]> {
    return this.http
      .request<Envelope<schemas["Wallet"]>>("POST", `/accounts/${accountId}/wallets`, {
        body,
        ...opts,
      })
      .then(unwrap);
  }

  get(accountId: string, walletId: string, opts?: CallOptions): Promise<schemas["Wallet"]> {
    return this.http
      .request<Envelope<schemas["Wallet"]>>(
        "GET",
        `/accounts/${accountId}/wallets/${walletId}`,
        opts,
      )
      .then(unwrap);
  }
}

export class VirtualBankAccountsResource {
  constructor(private readonly http: HttpClient) {}

  list(
    accountId: string,
    query?: Query<"listVirtualBankAccounts">,
    opts?: CallOptions,
  ): Promise<Page<schemas["VirtualBankAccount"]>> {
    return this.http
      .request<Envelope<schemas["VirtualBankAccount"][]>>(
        "GET",
        `/accounts/${accountId}/virtual-bank-accounts`,
        { query, ...opts },
      )
      .then(unwrapPage);
  }

  create(
    accountId: string,
    body: schemas["CreateVirtualBankAccountRequest"],
    opts?: CallOptions,
  ): Promise<schemas["VirtualBankAccount"]> {
    return this.http
      .request<Envelope<schemas["VirtualBankAccount"]>>(
        "POST",
        `/accounts/${accountId}/virtual-bank-accounts`,
        { body, ...opts },
      )
      .then(unwrap);
  }

  get(
    accountId: string,
    virtualBankAccountId: string,
    opts?: CallOptions,
  ): Promise<schemas["VirtualBankAccount"]> {
    return this.http
      .request<Envelope<schemas["VirtualBankAccount"]>>(
        "GET",
        `/accounts/${accountId}/virtual-bank-accounts/${virtualBankAccountId}`,
        opts,
      )
      .then(unwrap);
  }
}

export class PaymentLinksResource {
  constructor(private readonly http: HttpClient) {}

  create(
    accountId: string,
    body: schemas["CreatePaymentLinkRequest"],
    opts?: CallOptions,
  ): Promise<schemas["PaymentLink"]> {
    return this.http
      .request<Envelope<schemas["PaymentLink"]>>(
        "POST",
        `/accounts/${accountId}/fiat-to-crypto/payment-links`,
        { body, ...opts },
      )
      .then(unwrap);
  }
}

export class PaymentRequestsResource {
  constructor(private readonly http: HttpClient) {}

  /** Create a payment request scoped to an account. */
  create(
    accountId: string,
    body: schemas["CreatePaymentRequestInput"],
    opts?: CallOptions,
  ): Promise<schemas["PaymentRequest"]> {
    return this.http
      .request<Envelope<schemas["PaymentRequest"]>>(
        "POST",
        `/accounts/${accountId}/payment-requests`,
        { body, ...opts },
      )
      .then(unwrap);
  }

  /** Create a payment request addressed by the card provider's own reference. */
  createByCardProvider(
    body: schemas["CardProviderPaymentRequestInput"],
    opts?: CallOptions,
  ): Promise<schemas["PaymentRequest"]> {
    return this.http
      .request<Envelope<schemas["PaymentRequest"]>>("POST", "/payment-requests", {
        body,
        ...opts,
      })
      .then(unwrap);
  }
}

export class TransfersResource {
  constructor(private readonly http: HttpClient) {}

  createFiat(
    senderAccountId: string,
    body: schemas["CreateFiatTransferInput"],
    opts?: CallOptions,
  ): Promise<schemas["Transfer"]> {
    return this.http
      .request<Envelope<schemas["Transfer"]>>(
        "POST",
        `/accounts/${senderAccountId}/transfers/fiat`,
        { body, ...opts },
      )
      .then(unwrap);
  }

  createCrypto(
    senderAccountId: string,
    body: schemas["CreateCryptoTransferInput"],
    opts?: CallOptions,
  ): Promise<schemas["Transfer"]> {
    return this.http
      .request<Envelope<schemas["Transfer"]>>(
        "POST",
        `/accounts/${senderAccountId}/transfers/crypto`,
        { body, ...opts },
      )
      .then(unwrap);
  }

  list(
    accountId: string,
    query?: Query<"listTransfers">,
    opts?: CallOptions,
  ): Promise<Page<schemas["Transfer"]>> {
    return this.http
      .request<Envelope<schemas["Transfer"][]>>("GET", `/accounts/${accountId}/transfers`, {
        query,
        ...opts,
      })
      .then(unwrapPage);
  }

  get(accountId: string, transferId: string, opts?: CallOptions): Promise<schemas["Transfer"]> {
    return this.http
      .request<Envelope<schemas["Transfer"]>>(
        "GET",
        `/accounts/${accountId}/transfers/${transferId}`,
        opts,
      )
      .then(unwrap);
  }
}

export class AccountToAccountTransfersResource {
  constructor(private readonly http: HttpClient) {}

  list(
    query?: Query<"listAccountToAccountTransfers">,
    opts?: CallOptions,
  ): Promise<Page<schemas["AccountToAccountTransfer"]>> {
    return this.http
      .request<Envelope<schemas["AccountToAccountTransfer"][]>>(
        "GET",
        "/account-to-account-transfers",
        { query, ...opts },
      )
      .then(unwrapPage);
  }

  create(
    body: schemas["CreateAccountToAccountTransferRequest"],
    opts?: CallOptions,
  ): Promise<schemas["AccountToAccountTransfer"]> {
    return this.http
      .request<Envelope<schemas["AccountToAccountTransfer"]>>(
        "POST",
        "/account-to-account-transfers",
        { body, ...opts },
      )
      .then(unwrap);
  }
}

export class PermitsResource {
  constructor(private readonly http: HttpClient) {}

  /** Retrieve the unsigned EIP-712 permit messages for a wallet. */
  getMessages(
    accountId: string,
    walletId: string,
    query?: Query<"getPermitMessages">,
    opts?: CallOptions,
  ): Promise<schemas["PermitMessage"][]> {
    return this.http
      .request<Envelope<schemas["PermitMessage"][]>>(
        "GET",
        `/accounts/${accountId}/wallets/${walletId}/permits`,
        { query, ...opts },
      )
      .then((res) => res.result ?? []);
  }

  /** Submit signed permit messages. */
  submit(
    accountId: string,
    walletId: string,
    body: schemas["SubmitPermitRequest"],
    opts?: CallOptions,
  ): Promise<schemas["PermitResult"]> {
    return this.http
      .request<Envelope<schemas["PermitResult"]>>(
        "POST",
        `/accounts/${accountId}/wallets/${walletId}/permits`,
        { body, ...opts },
      )
      .then(unwrap);
  }
}

export class AllowancesResource {
  constructor(private readonly http: HttpClient) {}

  list(
    accountId: string,
    walletId: string,
    query?: Query<"getWalletAllowances">,
    opts?: CallOptions,
  ): Promise<schemas["Allowance"][]> {
    return this.http
      .request<Envelope<schemas["Allowance"][]>>(
        "GET",
        `/accounts/${accountId}/wallets/${walletId}/allowances`,
        { query, ...opts },
      )
      .then((res) => res.result ?? []);
  }
}
