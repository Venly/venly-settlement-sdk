import type { components, operations } from "../generated/fundflow.js";
import { TokenManager } from "../core/auth.js";
import { HttpClient, type RequestOptions, type Transport } from "../core/http.js";
import { iteratePages, type Page, type PageParams } from "../core/pagination.js";
import { MockTransport, type VenlyMock } from "../mock/transport.js";
import { fundflowRoutes } from "../mock/fundflow.js";
import { fundflowErrorPresets } from "../mock/errors.js";

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
  return { items: res.result ?? [], pagination: res.pagination };
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

/** Mock mode: zero credentials, zero network, fixture-backed. See `client.mock`. */
export interface FundflowMockOptions {
  environment: "mock";
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

  private readonly http: Transport;

  /** Mock controls (call log, failNext); defined only when `environment: "mock"`. */
  readonly mock?: VenlyMock;

  constructor(options: FundflowClientOptions) {
    if (options.environment === "mock") {
      // Zero network by construction: no TokenManager, no HttpClient, no fetch.
      const transport = new MockTransport(fundflowRoutes, fundflowErrorPresets);
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
}
