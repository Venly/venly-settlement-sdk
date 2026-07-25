/**
 * HttpVenlyClient: a minimal fetch-based transport implementing VenlyClient.
 *
 * TRANSPORT NOTE
 * --------------
 * Minimal by design: OAuth2 client credentials, lazy token fetch, staging
 * defaults. A future release replaces this with a thin adapter over
 * `@venlyfinance/sdk` (single-flight token refresh, automatic idempotency
 * keys, retry/backoff, richer errors) with no change to the tool interface.
 *
 * Safety invariants honored here:
 *  - credentials are read from env ONLY, never logged, never returned in output.
 *  - no request is issued at construction time; tokens are fetched lazily.
 *  - this class does not know about the write gate. It only issues a live call
 *    when a write method is invoked, and write methods are invoked only after
 *    the gate in safety.ts is armed. Read-only by default is enforced upstream.
 */

import {
  DEFAULT_FINANCE_BASE_URL,
  DEFAULT_FUNDFLOW_BASE_URL,
  DEFAULT_TOKEN_URL,
} from "../constants.js";
import type {
  Account,
  CreateFiatTransferInput,
  CreatePayInSessionRequest,
  ListRampRequestsParams,
  OptimisticLockingBody,
  Party,
  PaymentSession,
  RampRequestDto,
  RampRequestListItem,
  Transfer,
  VenlyClient,
  VirtualBankAccount,
} from "../types.js";

export interface HttpVenlyClientConfig {
  financeBaseUrl?: string;
  fundflowBaseUrl?: string;
  tokenUrl?: string;
  clientId?: string;
  clientSecret?: string;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

/** Unwrap the Venly `{ success, result, pagination }` envelope. */
function unwrap<T>(payload: unknown): T {
  if (payload && typeof payload === "object" && "result" in payload) {
    return (payload as { result: T }).result;
  }
  return payload as T;
}

export class HttpVenlyClient implements VenlyClient {
  private readonly financeBaseUrl: string;
  private readonly fundflowBaseUrl: string;
  private readonly tokenUrl: string;
  private readonly clientId?: string;
  private readonly clientSecret?: string;
  private readonly fetchImpl: typeof fetch;
  private token: CachedToken | null = null;

  constructor(config: HttpVenlyClientConfig = {}) {
    this.financeBaseUrl = config.financeBaseUrl ?? DEFAULT_FINANCE_BASE_URL;
    this.fundflowBaseUrl = config.fundflowBaseUrl ?? DEFAULT_FUNDFLOW_BASE_URL;
    this.tokenUrl = config.tokenUrl ?? DEFAULT_TOKEN_URL;
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  /** Build a client from environment variables. Never logs credentials. */
  static fromEnv(env: NodeJS.ProcessEnv = process.env): HttpVenlyClient {
    return new HttpVenlyClient({
      financeBaseUrl: env.VENLY_FINANCE_BASE_URL,
      fundflowBaseUrl: env.VENLY_FUNDFLOW_BASE_URL,
      tokenUrl: env.VENLY_TOKEN_URL,
      clientId: env.VENLY_CLIENT_ID,
      clientSecret: env.VENLY_CLIENT_SECRET,
    });
  }

  private async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.token && this.token.expiresAt > now + 5_000) {
      return this.token.accessToken;
    }
    if (!this.clientId || !this.clientSecret) {
      // Do not include any credential material in the error.
      throw new Error(
        "Missing Venly credentials. Set VENLY_CLIENT_ID and VENLY_CLIENT_SECRET.",
      );
    }
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: this.clientId,
      client_secret: this.clientSecret,
    });
    const res = await this.fetchImpl(this.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!res.ok) {
      // Never echo the request body (contains the secret).
      throw new Error(`Token request failed with status ${res.status}`);
    }
    const json = (await res.json()) as {
      access_token: string;
      expires_in?: number;
    };
    const expiresInMs = (json.expires_in ?? 300) * 1000;
    this.token = {
      accessToken: json.access_token,
      expiresAt: now + expiresInMs,
    };
    return json.access_token;
  }

  private async request<T>(
    base: string,
    method: string,
    path: string,
    opts: { query?: Record<string, unknown>; body?: unknown } = {},
  ): Promise<T> {
    const token = await this.getAccessToken();
    const url = new URL(path.replace(/^\//, ""), base.endsWith("/") ? base : base + "/");
    if (opts.query) {
      for (const [k, v] of Object.entries(opts.query)) {
        if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
      }
    }
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    };
    if (opts.body !== undefined) {
      headers["Content-Type"] = "application/json";
      // Idempotency for writes. Production SDK does this automatically.
      headers["Idempotency-Key"] = crypto.randomUUID();
    }
    const res = await this.fetchImpl(url.toString(), {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    if (!res.ok) {
      throw new Error(`Venly API ${method} ${path} failed with status ${res.status}`);
    }
    const json = await res.json();
    return unwrap<T>(json);
  }

  // ----- READ (finance) -----
  getAccount(accountId: string): Promise<Account> {
    return this.request(this.financeBaseUrl, "GET", `/accounts/${accountId}`);
  }
  listVirtualBankAccounts(accountId: string): Promise<VirtualBankAccount[]> {
    return this.request(
      this.financeBaseUrl,
      "GET",
      `/accounts/${accountId}/virtual-bank-accounts`,
    );
  }
  getTransfer(accountId: string, transferId: string): Promise<Transfer> {
    return this.request(
      this.financeBaseUrl,
      "GET",
      `/accounts/${accountId}/transfers/${transferId}`,
    );
  }
  listParties(params: { page?: number; size?: number } = {}): Promise<Party[]> {
    return this.request(this.financeBaseUrl, "GET", "/parties", { query: params });
  }

  // ----- READ (fundflow) -----
  listRampRequests(params: ListRampRequestsParams = {}): Promise<RampRequestListItem[]> {
    return this.request(this.fundflowBaseUrl, "GET", "/v1/ramp-requests", {
      query: params as Record<string, unknown>,
    });
  }
  getRampRequest(id: string): Promise<RampRequestDto> {
    return this.request(this.fundflowBaseUrl, "GET", `/v1/ramp-requests/${id}`);
  }
  getSupportedChains(): Promise<unknown[]> {
    return this.request(this.fundflowBaseUrl, "GET", "/v1/chains");
  }
  getFiatCurrencies(): Promise<unknown[]> {
    return this.request(this.fundflowBaseUrl, "GET", "/v1/fiat-currencies");
  }
  getCryptocurrencies(): Promise<unknown[]> {
    return this.request(this.fundflowBaseUrl, "GET", "/v1/crypto-currencies");
  }
  getCompanyFees(): Promise<unknown> {
    return this.request(this.fundflowBaseUrl, "GET", "/v1/fees");
  }

  // ----- WRITE -----
  createFiatTransfer(
    senderAccountId: string,
    body: CreateFiatTransferInput,
  ): Promise<Transfer> {
    return this.request(
      this.financeBaseUrl,
      "POST",
      `/accounts/${senderAccountId}/transfers/fiat`,
      { body },
    );
  }
  approveRampRequest(id: string, body: OptimisticLockingBody): Promise<RampRequestDto> {
    return this.request(this.fundflowBaseUrl, "POST", `/v1/ramp-requests/${id}/approve`, {
      body,
    });
  }
  rejectRampRequest(id: string, body: OptimisticLockingBody): Promise<RampRequestDto> {
    return this.request(this.fundflowBaseUrl, "POST", `/v1/ramp-requests/${id}/reject`, {
      body,
    });
  }
  createPayInSession(
    accountId: string,
    body: CreatePayInSessionRequest,
  ): Promise<PaymentSession> {
    return this.request(
      this.financeBaseUrl,
      "POST",
      `/accounts/${accountId}/fiat-to-crypto/payment-sessions`,
      { body },
    );
  }
}
