/**
 * Domain types + the injectable VenlyClient interface.
 *
 * These shapes are a minimal projection of the vendored OpenAPI specs at
 * projects/venly-docs-rebuild/api-reference/finance.yaml (servers:
 * https://api.venlyfinance.com/api/v1) and fundflow.yaml (servers:
 * https://api-fundflow.venly.io). Only the fields the tools actually read or
 * echo are modeled. Fields are intentionally loose (optional) because this is a
 * thin wrapper, not a full SDK.
 *
 * TRANSPORT NOTE: the bundled HttpVenlyClient is a deliberately minimal fetch
 * transport (see client/http-client.ts). A future release replaces it with a
 * thin adapter over `@venlyfinance/sdk` with no change to this interface;
 * until then the minimal transport is what ships. When that lands, replace
 * HttpVenlyClient with a thin adapter over it and delete the vendored transport.
 */

/** Ramp request status flow, per fundflow.yaml overview. */
export type RampStatus =
  | "AWAITING_APPROVAL"
  | "AWAITING_FUNDS"
  | "PROCESSING"
  | "SUCCEEDED"
  | "FAILED"
  | "BLOCKED"
  | "DENIED"
  | "REJECTED"
  | "CANCELLED";

export type RampType = "ON_RAMP" | "OFF_RAMP";

/** Simplified ramp request for list views (fundflow RampRequestListItem). */
export interface RampRequestListItem {
  id: string;
  paymentReference?: string;
  rampType?: RampType;
  status?: RampStatus;
  fiatAmount?: number;
  fiatCurrency?: string;
  cryptoAmount?: number;
  cryptoCurrency?: string;
  createdAt?: string;
  createdBy?: string;
}

/** Full ramp request detail (fundflow RampRequestDto). `version` drives the
 * four-eyes optimistic-locking approve/reject calls. */
export interface RampRequestDto {
  id: string;
  companyId?: string;
  companyName?: string;
  rampType?: RampType;
  status?: RampStatus;
  fiatAmount?: number;
  fiatNetAmount?: number;
  cryptoAmount?: number;
  fiatFeeAmount?: number;
  exchangeRate?: number;
  feePercentage?: number;
  paymentReference?: string;
  paymentReceived?: boolean;
  blockchainTransactionHash?: string;
  createdAt?: string;
  createdBy?: string;
  version?: number;
}

/** Finance Account (finance getAccount). */
export interface Account {
  id: string;
  status?: string;
  reference?: string;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

/** Finance VirtualBankAccount. `referenceCode` is the reconciliation key. */
export interface VirtualBankAccount {
  id: string;
  accountId?: string;
  bankAccountType?: string;
  name?: string;
  status?: string;
  currency?: string;
  targetCryptocurrency?: string;
  iban?: string;
  bic?: string;
  bankName?: string;
  beneficiaryName?: string;
  referenceCode?: string;
  createdAt?: string;
  updatedAt?: string;
}

/** Finance Transfer (finance getTransfer). */
export interface Transfer {
  id: string;
  status?: string;
  fiatAmount?: string | number;
  fiatCurrency?: string;
  cryptocurrency?: string;
  createdAt?: string;
  [key: string]: unknown;
}

/** Finance Party (finance listParties). */
export interface Party {
  id: string;
  type?: string;
  status?: string;
  [key: string]: unknown;
}

/** A payment link (finance PaymentLink). */
export interface PaymentLink {
  id: string;
  accountId?: string;
  paymentUrl?: string;
  externalRef?: string;
  status?: string;
  [key: string]: unknown;
}

/**
 * An observed incoming bank transaction on a vIBAN. This is operator- or
 * bank-feed-supplied data (there is no list-vIBAN-transactions endpoint in the
 * Release 1 specs), matched against a vIBAN referenceCode during reconciliation.
 */
export interface ObservedBankTransaction {
  /** The reference code carried in the payment (payment reference / remittance). */
  referenceCode: string;
  amount: number;
  currency: string;
  remitterName?: string;
  valueDate?: string;
  bankTransactionId?: string;
}

/** Query params for listing ramp requests (fundflow getAll). */
export interface ListRampRequestsParams {
  rampType?: RampType;
  status?: RampStatus;
  fromDate?: string;
  toDate?: string;
  paymentReference?: string;
  page?: number;
  size?: number;
}

/** Body for the fiat transfer POST (finance CreateFiatTransferInput). */
export interface CreateFiatTransferInput {
  receiverAccountId: string;
  receiverExternalId?: string;
  fiatAmount: string;
  fiatCurrency: string;
  cryptocurrency?: string;
  description?: string;
  merchantReference?: string;
}

/** Body for approve/reject (fundflow UpdateWithOptimisticLockingRequest). */
export interface OptimisticLockingBody {
  version: number;
}

/** Body for the payment link POST (finance CreatePaymentLinkRequest). */
export interface CreatePaymentLinkRequest {
  inAmount: string;
  inCurrency: string;
  outCryptocurrency?: string;
  redirectUrl?: string;
  externalRef?: string;
  metadata?: Record<string, string>;
}

/**
 * The injectable Venly transport. HttpVenlyClient is the real fetch-based
 * implementation; tests inject a mock. The MCP layer depends ONLY on this
 * interface, never on a concrete transport, which is what makes the fail-closed
 * write path testable without a network.
 */
export interface VenlyClient {
  // ----- READ (GET) -----
  listRampRequests(params?: ListRampRequestsParams): Promise<RampRequestListItem[]>;
  getRampRequest(id: string): Promise<RampRequestDto>;
  getAccount(accountId: string): Promise<Account>;
  listVirtualBankAccounts(accountId: string): Promise<VirtualBankAccount[]>;
  getTransfer(accountId: string, transferId: string): Promise<Transfer>;
  listParties(params?: { page?: number; size?: number }): Promise<Party[]>;
  getSupportedChains(): Promise<unknown[]>;
  getFiatCurrencies(): Promise<unknown[]>;
  getCryptocurrencies(): Promise<unknown[]>;
  getCompanyFees(): Promise<unknown>;

  // ----- WRITE (POST) -----
  // These are only ever called when the write gate is armed (confirm + env + creds).
  createFiatTransfer(senderAccountId: string, body: CreateFiatTransferInput): Promise<Transfer>;
  approveRampRequest(id: string, body: OptimisticLockingBody): Promise<RampRequestDto>;
  rejectRampRequest(id: string, body: OptimisticLockingBody): Promise<RampRequestDto>;
  createPaymentLink(accountId: string, body: CreatePaymentLinkRequest): Promise<PaymentLink>;
}
