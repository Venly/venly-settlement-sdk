import type { components, operations } from "../generated/finance.js";
import { TokenManager } from "../core/auth.js";
import { HttpClient, type RequestOptions, type Transport } from "../core/http.js";
import { iteratePages, type Page, type PageParams } from "../core/pagination.js";
import { FinanceMockTransport, type VenlyFinanceMock } from "../mock/finance.js";

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

/**
 * Contract 1.3.0 wraps mutation results in an idempotent-response envelope
 * `{ createdResourceId, response }`. The SDK resolves to the resource itself;
 * `createdResourceId` duplicates `response.id`.
 */
type Idempotent<T> = { createdResourceId?: string; response?: T };

function unwrapIdempotent<T>(res: Envelope<Idempotent<T>>): T {
  return res.result?.response as T;
}

function unwrapPage<T>(res: Envelope<T[]>): Page<T> {
  return {
    items: Array.isArray(res.result) ? res.result : [],
    resultPresent: Array.isArray(res.result),
    pagination: res.pagination,
  };
}

/**
 * One idempotency key per request: the body's `idempotencyKey` (the field the
 * API contract requires on money-moving endpoints) and the SDK's
 * `Idempotency-Key` header always carry the same value. Body key wins when
 * both are present; a missing body key is filled from the per-call option or
 * a fresh UUID.
 */
function alignIdempotency<B extends { idempotencyKey?: string }>(
  body: B,
  opts?: CallOptions,
): { body: B; opts: CallOptions } {
  const key = body?.idempotencyKey ?? opts?.idempotencyKey ?? crypto.randomUUID();
  return {
    body: body?.idempotencyKey === key ? body : { ...body, idempotencyKey: key },
    opts: { ...opts, idempotencyKey: key },
  };
}

export type FinanceEnvironment = "production" | "staging" | "qa";

export interface VenlyFinanceCredentialOptions {
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

/**
 * Mock mode: zero credentials, zero network. Every method answers from a
 * stateful fixture store typed against the OpenAPI schemas; `client.mock`
 * exposes the call log, error injection and lifecycle advancement
 * (`advanceVerification`, `advanceTransfer`, `reset`).
 *
 * Credential fields are accepted and ignored, so one options object can vary
 * only its `environment` string between mock, staging and production.
 */
export interface VenlyFinanceMockOptions {
  environment: "mock";
  clientId?: string;
  clientSecret?: string;
  baseUrl?: string;
  tokenUrl?: string;
  fetch?: typeof fetch;
  maxAttempts?: number;
}

/** Every environment the client constructor accepts. */
export type VenlyEnvironment = FinanceEnvironment | "mock";

export type VenlyFinanceClientOptions = VenlyFinanceCredentialOptions | VenlyFinanceMockOptions;

const FINANCE_URLS: Record<FinanceEnvironment, { base: string; token: string }> = {
  production: {
    base: "https://api.venlyfinance.com/v1",
    token: "https://login.venly.io/auth/realms/VenlyFinance/protocol/openid-connect/token",
  },
  staging: {
    base: "https://api-staging.venlyfinance.com/v1",
    token:
      "https://login-staging.venly.io/auth/realms/VenlyFinance/protocol/openid-connect/token",
  },
  // QA runs the leading contract (the version this SDK is generated from);
  // production trails it.
  qa: {
    base: "https://api-qa.venlyfinance.com/v1",
    token: "https://login-qa.venly.io/auth/realms/VenlyFinance/protocol/openid-connect/token",
  },
};

/**
 * Client for the Venly Finance API: parties, accounts, wallets, virtual bank
 * accounts, payment sessions, payment requests, transfers and permits.
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
  readonly paymentSessions: PaymentSessionsResource;
  readonly paymentRequests: PaymentRequestsResource;
  readonly transfers: TransfersResource;
  readonly permits: PermitsResource;
  readonly allowances: AllowancesResource;
  readonly payouts: PayoutsResource;
  readonly payoutRoutes: PayoutRoutesResource;
  readonly payoutBankAccounts: PayoutBankAccountsResource;
  readonly supportedAssets: SupportedAssetsResource;
  readonly webhooks: WebhooksResource;

  private readonly http: Transport;

  /**
   * Mock controls (call log, failNext, advanceVerification, advanceTransfer,
   * reset); defined only when `environment: "mock"`.
   */
  readonly mock?: VenlyFinanceMock;

  constructor(options: VenlyFinanceClientOptions) {
    if (options.environment === "mock") {
      // Zero network by construction: no TokenManager, no HttpClient, no fetch.
      const transport = new FinanceMockTransport();
      this.http = transport;
      this.mock = transport;
    } else {
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
    }
    this.parties = new PartiesResource(this.http);
    this.accounts = new AccountsResource(this.http);
    this.wallets = new WalletsResource(this.http);
    this.virtualBankAccounts = new VirtualBankAccountsResource(this.http);
    this.paymentSessions = new PaymentSessionsResource(this.http);
    this.paymentRequests = new PaymentRequestsResource(this.http);
    this.transfers = new TransfersResource(this.http);
    this.permits = new PermitsResource(this.http);
    this.allowances = new AllowancesResource(this.http);
    this.payouts = new PayoutsResource(this.http);
    this.payoutRoutes = new PayoutRoutesResource(this.http);
    this.payoutBankAccounts = new PayoutBankAccountsResource(this.http);
    this.supportedAssets = new SupportedAssetsResource(this.http);
    this.webhooks = new WebhooksResource(this.http);
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
  constructor(private readonly http: Transport) {}

  list(query?: Query<"listParties">, opts?: CallOptions): Promise<Page<schemas["PartyDto"]>> {
    return this.http
      .request<Envelope<schemas["PartyDto"][]>>("GET", "/parties", { query, ...opts })
      .then(unwrapPage);
  }

  iterate(query?: Omit<Query<"listParties">, "page">): AsyncGenerator<schemas["PartyDto"]> {
    return iteratePages(
      (p: PageParams) => this.list({ ...query, page: p.page, size: p.size }),
      { size: query?.size },
    );
  }

  create(body: schemas["CreatePartyRequest"], opts?: CallOptions): Promise<schemas["PartyDto"]> {
    return this.http
      .request<Envelope<schemas["PartyDto"]>>("POST", "/parties", { body, ...opts })
      .then(unwrap);
  }

  get(partyId: string, opts?: CallOptions): Promise<schemas["PartyDto"]> {
    return this.http
      .request<Envelope<schemas["PartyDto"]>>("GET", `/parties/${partyId}`, opts)
      .then(unwrap);
  }

  update(
    partyId: string,
    body: schemas["UpdatePartyRequest"],
    opts?: CallOptions,
  ): Promise<schemas["PartyDto"]> {
    return this.http
      .request<Envelope<schemas["PartyDto"]>>("PATCH", `/parties/${partyId}`, { body, ...opts })
      .then(unwrap);
  }

  delete(partyId: string, opts?: CallOptions): Promise<void> {
    return this.http.request<void>("DELETE", `/parties/${partyId}`, opts);
  }

  /**
   * `GET /parties/{partyId}/iv-verification` (operation
   * `getPartyIvVerification`): the party's identity-verification state -
   * `NOT_LINKED · SUBMITTED · FORWARDED · ACCEPTED · COMPLETED · FAILED`,
   * with the case reference and link time. A party with no linked case reads
   * `NOT_LINKED` rather than 404: the contract models identity verification
   * as a state every party has, not a resource some parties lack.
   */
  ivVerification(
    partyId: string,
    opts?: CallOptions,
  ): Promise<schemas["PartyIvVerificationDto"]> {
    return this.http
      .request<Envelope<schemas["PartyIvVerificationDto"]>>(
        "GET",
        `/parties/${partyId}/iv-verification`,
        opts,
      )
      .then(unwrap);
  }
}

export class AccountsResource {
  constructor(private readonly http: Transport) {}

  list(query?: Query<"listAccounts">, opts?: CallOptions): Promise<Page<schemas["AccountListItemDto"]>> {
    return this.http
      .request<Envelope<schemas["AccountListItemDto"][]>>("GET", "/accounts", { query, ...opts })
      .then(unwrapPage);
  }

  iterate(query?: Omit<Query<"listAccounts">, "page">): AsyncGenerator<schemas["AccountListItemDto"]> {
    return iteratePages(
      (p: PageParams) => this.list({ ...query, page: p.page, size: p.size }),
      { size: query?.size },
    );
  }

  create(body: schemas["CreateAccountRequest"], opts?: CallOptions): Promise<schemas["AccountListItemDto"]> {
    return this.http
      .request<Envelope<schemas["AccountListItemDto"]>>("POST", "/accounts", { body, ...opts })
      .then(unwrap);
  }

  get(accountId: string, opts?: CallOptions): Promise<schemas["AccountListItemDto"]> {
    return this.http
      .request<Envelope<schemas["AccountListItemDto"]>>("GET", `/accounts/${accountId}`, opts)
      .then(unwrap);
  }

  listPartyRoles(
    accountId: string,
    query?: Query<"listPartyRoles">,
    opts?: CallOptions,
  ): Promise<Page<schemas["PartyRoleDto"]>> {
    return this.http
      .request<Envelope<schemas["PartyRoleDto"][]>>("GET", `/accounts/${accountId}/party-roles`, {
        query,
        ...opts,
      })
      .then(unwrapPage);
  }

  addPartyRole(
    accountId: string,
    body: schemas["AddPartyRoleRequest"],
    opts?: CallOptions,
  ): Promise<schemas["PartyRoleDto"]> {
    return this.http
      .request<Envelope<schemas["PartyRoleDto"]>>("POST", `/accounts/${accountId}/party-roles`, {
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
  constructor(private readonly http: Transport) {}

  list(
    accountId: string,
    query?: Query<"listWallets">,
    opts?: CallOptions,
  ): Promise<Page<schemas["WalletBalanceDto"]>> {
    return this.http
      .request<Envelope<schemas["WalletBalanceDto"][]>>("GET", `/accounts/${accountId}/wallets`, {
        query,
        ...opts,
      })
      .then(unwrapPage);
  }

}

export class VirtualBankAccountsResource {
  constructor(private readonly http: Transport) {}

  list(
    accountId: string,
    query?: Query<"listVirtualBankAccounts">,
    opts?: CallOptions,
  ): Promise<Page<schemas["VirtualBankAccountResponse"]>> {
    return this.http
      .request<Envelope<schemas["VirtualBankAccountResponse"][]>>(
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
  ): Promise<schemas["VirtualBankAccountResponse"]> {
    const aligned = alignIdempotency(body, opts);
    return this.http
      .request<Envelope<Idempotent<schemas["VirtualBankAccountResponse"]>>>(
        "POST",
        `/accounts/${accountId}/virtual-bank-accounts`,
        { body: aligned.body, ...aligned.opts },
      )
      .then(unwrapIdempotent);
  }

  get(
    accountId: string,
    virtualBankAccountId: string,
    opts?: CallOptions,
  ): Promise<schemas["VirtualBankAccountResponse"]> {
    return this.http
      .request<Envelope<schemas["VirtualBankAccountResponse"]>>(
        "GET",
        `/accounts/${accountId}/virtual-bank-accounts/${virtualBankAccountId}`,
        opts,
      )
      .then(unwrap);
  }
}

export class PaymentSessionsResource {
  constructor(private readonly http: Transport) {}

  /**
   * Create a hosted fiat-to-crypto pay-in session. Redirect the payer to the
   * returned `paymentUrl`; the API requires `callbackUrl` and a UUID
   * `idempotencyKey` in the body.
   */
  create(
    accountId: string,
    body: schemas["CreatePayInSessionInput"],
    opts?: CallOptions,
  ): Promise<schemas["PayInSessionDto"]> {
    const aligned = alignIdempotency(body, opts);
    return this.http
      .request<Envelope<schemas["PayInSessionDto"]>>(
        "POST",
        `/accounts/${accountId}/fiat-to-crypto/payment-sessions`,
        { body: aligned.body, ...aligned.opts },
      )
      .then(unwrap);
  }
}

export class PaymentRequestsResource {
  constructor(private readonly http: Transport) {}

  /** Create a payment request scoped to an account. */
  create(
    accountId: string,
    body: schemas["CreatePaymentRequestInput"],
    opts?: CallOptions,
  ): Promise<schemas["PaymentRequestDto"]> {
    const aligned = alignIdempotency(body, opts);
    return this.http
      .request<Envelope<Idempotent<schemas["PaymentRequestDto"]>>>(
        "POST",
        `/accounts/${accountId}/payment-requests`,
        { body: aligned.body, ...aligned.opts },
      )
      .then(unwrapIdempotent);
  }

  /** Create a payment request addressed by the card provider's own reference. */
  createByCardProvider(
    body: schemas["CardProviderPaymentRequestInput"],
    opts?: CallOptions,
  ): Promise<schemas["PaymentRequestDto"]> {
    return this.http
      .request<Envelope<Idempotent<schemas["PaymentRequestDto"]>>>(
        "POST", "/payment-requests", {
        body,
        ...opts,
      })
      .then(unwrapIdempotent);
  }

  /** Adjust the reserved amount of a payment request before settlement. */
  update(
    paymentRequestId: string,
    body: schemas["UpdatePaymentRequestInput"],
    opts?: CallOptions,
  ): Promise<schemas["PaymentRequestDto"]> {
    const aligned = alignIdempotency(body, opts);
    return this.http
      .request<Envelope<Idempotent<schemas["PaymentRequestDto"]>>>(
        "PATCH",
        `/payment-requests/${paymentRequestId}`,
        { body: aligned.body, ...aligned.opts },
      )
      .then(unwrapIdempotent);
  }

  /**
   * Settle a payment request: escrow moves to the settlement wallet. Returns
   * `202` with `status: SETTLING`; the terminal `SETTLED` state lands once the
   * on-chain transfers confirm.
   */
  settle(
    paymentRequestId: string,
    body: schemas["SettlePaymentRequestInput"],
    opts?: CallOptions,
  ): Promise<schemas["PaymentRequestDto"]> {
    const aligned = alignIdempotency(body, opts);
    return this.http
      .request<Envelope<Idempotent<schemas["PaymentRequestDto"]>>>(
        "POST",
        `/payment-requests/${paymentRequestId}/settlements`,
        { body: aligned.body, ...aligned.opts },
      )
      .then(unwrapIdempotent);
  }

  /** Settle a payment request addressed by card-provider reference + externalId. */
  settleByReference(
    body: schemas["SettlePaymentRequestByReferenceInput"],
    opts?: CallOptions,
  ): Promise<schemas["PaymentRequestDto"]> {
    const aligned = alignIdempotency(body, opts);
    return this.http
      .request<Envelope<Idempotent<schemas["PaymentRequestDto"]>>>(
        "POST", "/payment-requests/settlements", {
        body: aligned.body,
        ...aligned.opts,
      })
      .then(unwrapIdempotent);
  }

  /** Reverse (void/refund) a payment request; reserved funds return to the account wallet. */
  reverse(
    paymentRequestId: string,
    body: schemas["ReversePaymentRequestInput"],
    opts?: CallOptions,
  ): Promise<schemas["PaymentRequestDto"]> {
    const aligned = alignIdempotency(body, opts);
    return this.http
      .request<Envelope<Idempotent<schemas["PaymentRequestDto"]>>>(
        "POST",
        `/payment-requests/${paymentRequestId}/reversal`,
        { body: aligned.body, ...aligned.opts },
      )
      .then(unwrapIdempotent);
  }

  /** Reverse a payment request addressed by card-provider reference + externalId. */
  reverseByReference(
    body: schemas["ReversePaymentRequestByReferenceInput"],
    opts?: CallOptions,
  ): Promise<schemas["PaymentRequestDto"]> {
    const aligned = alignIdempotency(body, opts);
    return this.http
      .request<Envelope<Idempotent<schemas["PaymentRequestDto"]>>>(
        "POST", "/payment-requests/reversals", {
        body: aligned.body,
        ...aligned.opts,
      })
      .then(unwrapIdempotent);
  }
}

export class TransfersResource {
  constructor(private readonly http: Transport) {}

  createFiat(
    senderAccountId: string,
    body: schemas["CreateFiatTransferInput"],
    opts?: CallOptions,
  ): Promise<schemas["TransferRequestDto"]> {
    const aligned = alignIdempotency(body, opts);
    return this.http
      .request<Envelope<schemas["TransferRequestDto"]>>(
        "POST",
        `/accounts/${senderAccountId}/transfers/fiat`,
        { body: aligned.body, ...aligned.opts },
      )
      .then(unwrap);
  }

  createCrypto(
    senderAccountId: string,
    body: schemas["CreateCryptoTransferInput"],
    opts?: CallOptions,
  ): Promise<schemas["TransferRequestDto"]> {
    const aligned = alignIdempotency(body, opts);
    return this.http
      .request<Envelope<schemas["TransferRequestDto"]>>(
        "POST",
        `/accounts/${senderAccountId}/transfers/crypto`,
        { body: aligned.body, ...aligned.opts },
      )
      .then(unwrap);
  }

  list(
    accountId: string,
    query?: Query<"listTransfers">,
    opts?: CallOptions,
  ): Promise<Page<schemas["TransferRequestDto"]>> {
    return this.http
      .request<Envelope<schemas["TransferRequestDto"][]>>("GET", `/accounts/${accountId}/transfers`, {
        query,
        ...opts,
      })
      .then(unwrapPage);
  }

  get(accountId: string, transferId: string, opts?: CallOptions): Promise<schemas["TransferRequestDto"]> {
    return this.http
      .request<Envelope<schemas["TransferRequestDto"]>>(
        "GET",
        `/accounts/${accountId}/transfers/${transferId}`,
        opts,
      )
      .then(unwrap);
  }
}

export class PermitsResource {
  constructor(private readonly http: Transport) {}

  /** Retrieve the unsigned EIP-712 permit messages for a wallet. */
  getMessages(
    accountId: string,
    walletId: string,
    query?: Query<"getPermitMessages">,
    opts?: CallOptions,
  ): Promise<schemas["PermitMessageDto"][]> {
    return this.http
      .request<Envelope<schemas["PermitMessageDto"][]>>(
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
  ): Promise<schemas["PermitResultDto"]> {
    return this.http
      .request<Envelope<schemas["PermitResultDto"]>>(
        "POST",
        `/accounts/${accountId}/wallets/${walletId}/permits`,
        { body, ...opts },
      )
      .then(unwrap);
  }
}

export class AllowancesResource {
  constructor(private readonly http: Transport) {}

  list(
    accountId: string,
    walletId: string,
    query?: Query<"getWalletAllowances">,
    opts?: CallOptions,
  ): Promise<schemas["AllowanceInfo"][]> {
    return this.http
      .request<Envelope<schemas["AllowanceInfo"][]>>(
        "GET",
        `/accounts/${accountId}/wallets/${walletId}/allowances`,
        { query, ...opts },
      )
      .then((res) => res.result ?? []);
  }
}

/**
 * Third-party payouts: crypto out of a Venly account, fiat into a registered
 * beneficiary bank account. The ceremony is three resources deep:
 * a bank account is registered on the PARTY (`payoutBankAccounts`), a payout
 * ROUTE binds it to an ACCOUNT and a deposit asset (`payoutRoutes`, activated
 * via wallet-ownership proof), and each payout then references the route.
 */
export class PayoutsResource {
  constructor(private readonly http: Transport) {}

  list(
    accountId: string,
    query?: Query<"listPayouts">,
    opts?: CallOptions,
  ): Promise<Page<schemas["PayoutDto"]>> {
    return this.http
      .request<Envelope<schemas["PayoutDto"][]>>("GET", `/accounts/${accountId}/payouts`, {
        query,
        ...opts,
      })
      .then(unwrapPage);
  }

  get(accountId: string, payoutId: string, opts?: CallOptions): Promise<schemas["PayoutDto"]> {
    return this.http
      .request<Envelope<schemas["PayoutDto"]>>(
        "GET",
        `/accounts/${accountId}/payouts/${payoutId}`,
        opts,
      )
      .then(unwrap);
  }

  request(
    accountId: string,
    body: schemas["CreatePayoutRequest"],
    opts?: CallOptions,
  ): Promise<schemas["PayoutDto"]> {
    const aligned = alignIdempotency(body, opts);
    return this.http
      .request<Envelope<Idempotent<schemas["PayoutDto"]>>>(
        "POST",
        `/accounts/${accountId}/payouts`,
        { body: aligned.body, ...aligned.opts },
      )
      .then(unwrapIdempotent);
  }
}

export class PayoutRoutesResource {
  constructor(private readonly http: Transport) {}

  list(
    accountId: string,
    query?: Query<"listRoutes">,
    opts?: CallOptions,
  ): Promise<schemas["PayoutRouteDto"][]> {
    return this.http
      .request<Envelope<schemas["PayoutRouteDto"][]>>(
        "GET",
        `/accounts/${accountId}/payout-routes`,
        { query, ...opts },
      )
      .then((res) => res.result ?? []);
  }

  create(
    accountId: string,
    body: schemas["CreatePayoutRouteRequest"],
    opts?: CallOptions,
  ): Promise<schemas["PayoutRouteDto"]> {
    return this.http
      .request<Envelope<schemas["PayoutRouteDto"]>>(
        "POST",
        `/accounts/${accountId}/payout-routes`,
        { body, ...opts },
      )
      .then(unwrap);
  }

  /**
   * Returns the message the route's funding wallet must sign. Takes no body:
   * the server derives the wallet and chain from the route itself.
   */
  prepareOwnershipProof(
    accountId: string,
    routeId: string,
    opts?: CallOptions,
  ): Promise<schemas["PayoutOwnershipProofDto"]> {
    return this.http
      .request<Envelope<schemas["PayoutOwnershipProofDto"]>>(
        "POST",
        `/accounts/${accountId}/payout-routes/${routeId}/ownership-proof/prepare`,
        opts,
      )
      .then(unwrap);
  }

  /** Submits the signed message; on success the route becomes ACTIVE. */
  completeOwnershipProof(
    accountId: string,
    routeId: string,
    body: schemas["CompletePayoutOwnershipProofRequest"],
    opts?: CallOptions,
  ): Promise<schemas["PayoutRouteDto"]> {
    return this.http
      .request<Envelope<schemas["PayoutRouteDto"]>>(
        "POST",
        `/accounts/${accountId}/payout-routes/${routeId}/ownership-proof/complete`,
        { body, ...opts },
      )
      .then(unwrap);
  }
}

/**
 * Asset reference data: which assets the tenant supports – each with its
 * on-chain `decimals` – and, per account, the permit status saying whether
 * that account's wallet can actually move the asset. `decimals` is the
 * render contract for amounts: a UI that assumes two decimals shows
 * sub-cent balances on a 6-decimal asset as 0.00.
 *
 * Both endpoints return a plain array envelope (no pagination on the wire);
 * they still resolve to `Page` for its `resultPresent` flag – the signal
 * that separates "empty list" from "malformed envelope". `pagination` stays
 * undefined.
 */
export class SupportedAssetsResource {
  constructor(private readonly http: Transport) {}

  /** Tenant-wide supported assets, each carrying its on-chain `decimals`. */
  list(opts?: CallOptions): Promise<Page<schemas["SupportedAssetView"]>> {
    return this.http
      .request<Envelope<schemas["SupportedAssetView"][]>>("GET", "/supported-assets", opts)
      .then(unwrapPage);
  }

  /** Account-scoped view: the same asset rows plus per-asset `permitStatus`. */
  listForAccount(
    accountId: string,
    opts?: CallOptions,
  ): Promise<Page<schemas["AccountSupportedAssetView"]>> {
    return this.http
      .request<Envelope<schemas["AccountSupportedAssetView"][]>>(
        "GET",
        `/accounts/${accountId}/supported-assets`,
        opts,
      )
      .then(unwrapPage);
  }
}

/**
 * Webhook endpoints the tenant registers to receive platform events:
 * `GET/POST /webhooks`, `GET/PUT/DELETE /webhooks/{webhookId}` and
 * `POST /webhooks/{webhookId}/ping`.
 *
 * Two contract facts every consumer should know:
 *  - `createWebhook` carries NO idempotency envelope - no body field and no
 *    header parameter, unlike the money-moving endpoints. A replayed create
 *    registers a second webhook. Any retry-safety a client layers on top is
 *    a client-side convention and must be presented as one.
 *  - `authenticationMethod` carries credentials for YOUR endpoint (an API
 *    key or basic-auth pair). The secret fields are write-only on the
 *    contract: the platform stores them server-side and never returns a
 *    stored secret, so no read on this resource can display one.
 */
export class WebhooksResource {
  constructor(private readonly http: Transport) {}

  /** Bare array envelope on the wire (no pagination); `Page` carries `resultPresent`. */
  list(opts?: CallOptions): Promise<Page<schemas["WebhookDto"]>> {
    return this.http
      .request<Envelope<schemas["WebhookDto"][]>>("GET", "/webhooks", opts)
      .then(unwrapPage);
  }

  create(body: schemas["CreateWebhookRequest"], opts?: CallOptions): Promise<schemas["WebhookDto"]> {
    return this.http
      .request<Envelope<schemas["WebhookDto"]>>("POST", "/webhooks", { body, ...opts })
      .then(unwrap);
  }

  get(webhookId: string, opts?: CallOptions): Promise<schemas["WebhookDto"]> {
    return this.http
      .request<Envelope<schemas["WebhookDto"]>>("GET", `/webhooks/${webhookId}`, opts)
      .then(unwrap);
  }

  update(
    webhookId: string,
    body: schemas["UpdateWebhookRequest"],
    opts?: CallOptions,
  ): Promise<schemas["WebhookDto"]> {
    return this.http
      .request<Envelope<schemas["WebhookDto"]>>("PUT", `/webhooks/${webhookId}`, {
        body,
        ...opts,
      })
      .then(unwrap);
  }

  delete(webhookId: string, opts?: CallOptions): Promise<void> {
    return this.http.request<void>("DELETE", `/webhooks/${webhookId}`, opts);
  }

  /**
   * Fire a test delivery at the registered endpoint. The contract's result
   * is a void envelope; resolve it as returned so a surface can render the
   * outcome verbatim.
   */
  ping(webhookId: string, opts?: CallOptions): Promise<schemas["ResponseEnvelopeVoid"]> {
    return this.http
      .request<Envelope<schemas["ResponseEnvelopeVoid"]>>(
        "POST",
        `/webhooks/${webhookId}/ping`,
        opts,
      )
      .then(unwrap);
  }
}

export class PayoutBankAccountsResource {
  constructor(private readonly http: Transport) {}

  list(
    partyId: string,
    query?: Query<"list">,
    opts?: CallOptions,
  ): Promise<Page<schemas["PayoutBankAccountDto"]>> {
    return this.http
      .request<Envelope<schemas["PayoutBankAccountDto"][]>>(
        "GET",
        `/parties/${partyId}/payout-bank-accounts`,
        { query, ...opts },
      )
      .then(unwrapPage);
  }

  /** Registers a beneficiary bank account; it starts PENDING until reviewed. */
  register(
    partyId: string,
    body: schemas["RegisterPayoutBankAccountRequest"],
    opts?: CallOptions,
  ): Promise<schemas["PayoutBankAccountDto"]> {
    return this.http
      .request<Envelope<schemas["PayoutBankAccountDto"]>>(
        "POST",
        `/parties/${partyId}/payout-bank-accounts`,
        { body, ...opts },
      )
      .then(unwrap);
  }

  get(
    partyId: string,
    payoutBankAccountId: string,
    opts?: CallOptions,
  ): Promise<schemas["PayoutBankAccountDto"]> {
    return this.http
      .request<Envelope<schemas["PayoutBankAccountDto"]>>(
        "GET",
        `/parties/${partyId}/payout-bank-accounts/${payoutBankAccountId}`,
        opts,
      )
      .then(unwrap);
  }
}
