/**
 * Domain types + the injectable VenlyClient interface.
 *
 * These shapes are a minimal projection of the published OpenAPI specs
 * vendored in this repository under `specs/` – finance.yaml (servers:
 * https://api.venlyfinance.com/v1) and fundflow.yaml (servers:
 * https://api-fundflow.venly.io). Only the fields the tools actually read or
 * echo are modeled. Fields are intentionally loose (optional) because this is a
 * thin wrapper, not a full SDK.
 *
 * The production implementation is an adapter over `@venlyfinance/sdk`, so
 * endpoint transport, auth, retry and idempotency behavior have one source.
 * Tests inject a lightweight implementation of this interface.
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

/** Finance Wallet, auto-provisioned when an account is created. */
export interface Wallet {
  id: string;
  accountId?: string;
  chain?: string;
  address?: string;
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

export interface AddressInput {
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
}

export interface CreatePartyInput {
  partyType: "INDIVIDUAL" | "ORGANISATION";
  externalId?: string;
  firstName?: string;
  lastName?: string;
  name?: string;
  vatNumber?: string;
  address?: AddressInput;
}

export interface CreateAccountInput {
  externalId: string;
  name?: string;
  chain: "AVALANCHE" | "BASE" | "POLYGON";
  address?: string;
  partyId?: string;
  party?: CreatePartyInput;
}

export interface CreateVirtualBankAccountInput {
  name: string;
  inCurrency: string;
  targetCryptocurrency: string;
  idempotencyKey: string;
}

/** A fiat-to-crypto payment session (finance PaymentSession). */
export interface PaymentSession {
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

/** Current finance CreateFiatTransferInput, kept separate from the legacy stage tool input. */
export interface CurrentCreateFiatTransferInput {
  receiverAccountId?: string;
  receiverExternalId?: string;
  currency: string;
  amount: number;
  description?: string;
  merchantReference?: string;
  idempotencyKey: string;
}

export interface CreateCryptoTransferInput {
  receiverAccountId?: string;
  receiverExternalId?: string;
  chain: "AVALANCHE" | "BASE" | "POLYGON";
  asset: string;
  amount: number;
  description?: string;
  merchantReference?: string;
  idempotencyKey: string;
}

/** Body for approve/reject (fundflow UpdateWithOptimisticLockingRequest). */
export interface OptimisticLockingBody {
  version: number;
}

/** Body for the payment session POST (finance CreatePayInSessionRequest). */
export interface CreatePayInSessionRequest {
  inAmount: string;
  inCurrency: string;
  outCryptocurrency: string;
  callbackUrl: string;
  idempotencyKey: string;
  successRedirectUrl?: string;
  failureRedirectUrl?: string;
  externalRef?: string;
  metadata?: Record<string, string>;
}

/**
 * The injectable Venly client contract. SdkVenlyClient is the production
 * implementation; tests inject a lightweight mock. The MCP layer depends only
 * on this interface, keeping the fail-closed write path testable without a
 * network.
 */
export interface VenlyClient {
  // ----- READ (GET) -----
  listRampRequests(params?: ListRampRequestsParams): Promise<RampRequestListItem[]>;
  getRampRequest(id: string): Promise<RampRequestDto>;
  listAccounts(params?: { page?: number; size?: number }): Promise<Account[]>;
  getAccount(accountId: string): Promise<Account>;
  listWallets(accountId: string, params?: { page?: number; size?: number }): Promise<Wallet[]>;
  listVirtualBankAccounts(accountId: string): Promise<VirtualBankAccount[]>;
  getVirtualBankAccount(
    accountId: string,
    virtualBankAccountId: string,
  ): Promise<VirtualBankAccount>;
  listTransfers(
    accountId: string,
    params?: { page?: number; size?: number },
  ): Promise<Transfer[]>;
  getTransfer(accountId: string, transferId: string): Promise<Transfer>;
  listParties(params?: { page?: number; size?: number }): Promise<Party[]>;
  getParty(partyId: string): Promise<Party>;
  getSupportedChains(): Promise<unknown[]>;
  getFiatCurrencies(): Promise<unknown[]>;
  getCryptocurrencies(): Promise<unknown[]>;
  getCompanyFees(): Promise<unknown>;

  // ----- WRITE (POST) -----
  // These are only ever called when the write gate is armed (confirm + env + creds).
  createParty(body: CreatePartyInput): Promise<Party>;
  createAccount(body: CreateAccountInput): Promise<Account>;
  createVirtualBankAccount(
    accountId: string,
    body: CreateVirtualBankAccountInput,
  ): Promise<VirtualBankAccount>;
  createFiatTransfer(senderAccountId: string, body: CreateFiatTransferInput): Promise<Transfer>;
  createCurrentFiatTransfer(
    senderAccountId: string,
    body: CurrentCreateFiatTransferInput,
  ): Promise<Transfer>;
  createCryptoTransfer(
    senderAccountId: string,
    body: CreateCryptoTransferInput,
  ): Promise<Transfer>;
  approveRampRequest(id: string, body: OptimisticLockingBody): Promise<RampRequestDto>;
  rejectRampRequest(id: string, body: OptimisticLockingBody): Promise<RampRequestDto>;
  createPayInSession(
    accountId: string,
    body: CreatePayInSessionRequest,
  ): Promise<PaymentSession>;
}
