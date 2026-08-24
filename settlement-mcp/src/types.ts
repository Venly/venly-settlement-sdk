/**
 * Generated API contracts + the injectable VenlyClient interface.
 *
 * Finance and Fundflow resources and requests are aliases to the types exported
 * by `@venlyfinance/sdk`. Only MCP-owned inputs and compatibility shapes are
 * declared locally. This prevents the MCP from silently drifting away from the
 * vendored OpenAPI specifications.
 */

import type {
  FinanceComponents,
  FundflowComponents,
} from "@venlyfinance/sdk";
import type { VenlyEnvironment } from "./constants.js";

type FinanceSchemas = FinanceComponents["schemas"];
type FundflowSchemas = FundflowComponents["schemas"];

// Contract 1.3.0 (QA) renamed the read schemas; the MCP keeps its established
// names. `Wallet` is the account's per-asset balance row – the wallet wrapper
// left the public contract.
export type AddressInput = FinanceSchemas["AddressDto"];
export type Party = FinanceSchemas["PartyDto"];
export type CreatePartyInput = FinanceSchemas["CreatePartyRequest"];
export type Account = FinanceSchemas["AccountListItemDto"];
export type CreateAccountInput = FinanceSchemas["CreateAccountRequest"];
export type Wallet = FinanceSchemas["WalletBalanceDto"];
export type VirtualBankAccount = FinanceSchemas["VirtualBankAccountResponse"];
export type CreateVirtualBankAccountInput =
  FinanceSchemas["CreateVirtualBankAccountRequest"];
export type PaymentSession = FinanceSchemas["PayInSessionDto"];
export type CreatePayInSessionRequest =
  FinanceSchemas["CreatePayInSessionInput"];
export type Transfer = FinanceSchemas["TransferRequestDto"];
export type CurrentCreateFiatTransferInput =
  FinanceSchemas["CreateFiatTransferInput"];
export type CreateCryptoTransferInput =
  FinanceSchemas["CreateCryptoTransferInput"];
export type Payout = FinanceSchemas["PayoutDto"];
export type CreatePayoutInput = FinanceSchemas["CreatePayoutRequest"];
export type PayoutRoute = FinanceSchemas["PayoutRouteDto"];
export type CreatePayoutRouteInput = FinanceSchemas["CreatePayoutRouteRequest"];
export type PayoutBankAccount = FinanceSchemas["PayoutBankAccountDto"];
export type RegisterPayoutBankAccountInput =
  FinanceSchemas["RegisterPayoutBankAccountRequest"];
export type PayoutOwnershipProof = FinanceSchemas["PayoutOwnershipProofDto"];
export type CompleteOwnershipProofInput =
  FinanceSchemas["CompletePayoutOwnershipProofRequest"];

export type RampRequestDto = FundflowSchemas["RampRequestDto"];
export type RampRequestListItem = FundflowSchemas["RampRequestListItem"];
export type OptimisticLockingBody =
  FundflowSchemas["UpdateWithOptimisticLockingRequest"];
export type SupportedChains = FundflowSchemas["SupportedChainsDto"];
export type FiatCurrency = FundflowSchemas["FiatCurrencyDto"];
export type CryptoCurrency = FundflowSchemas["CryptoCurrencyDto"];
export type VenlyFee = FundflowSchemas["FeeDto"];
export type RampStatus = NonNullable<RampRequestDto["status"]>;
export type RampType = NonNullable<RampRequestDto["rampType"]>;

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

/**
 * An agent-prepared decision draft (the sdk mock's decisionDrafts concept).
 * MOCK-ONLY: no operation on either public plane stores or serves one, which
 * is why these shapes are declared here as MCP-owned compatibility types
 * rather than generated aliases. The draft never auto-applies anything - the
 * human decides through the existing ceremony, and a later decision marks the
 * draft SUPERSEDED.
 */
export interface PrepareDecisionInput {
  recordType: "verification" | "reconciliation" | "payout_exception";
  /** verification: a party or account id · reconciliation: an inbound credit id · payout_exception: a payout id. */
  recordId: string;
  proposal: string;
  reason: string;
  evidenceRefs?: string[];
}

export interface DecisionDraft extends PrepareDecisionInput {
  id: string;
  evidenceRefs: string[];
  preparedAt: string;
  status: "PREPARED" | "SUPERSEDED";
  supersededAt?: string;
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

/** Legacy stage_transfer body, normalized to the current finance
 * CreateFiatTransferInput before any call (see normalizeLegacyFiatTransfer). */
export interface CreateFiatTransferInput {
  receiverAccountId: string;
  receiverExternalId?: string;
  fiatAmount: string;
  fiatCurrency: string;
  /** Retired: the current contract has no such field. Normalization rejects it
   * instead of silently dropping it. */
  cryptocurrency?: string;
  description?: string;
  merchantReference?: string;
  /** Preserved across the dry-run preview and the live call when supplied. */
  idempotencyKey?: string;
}

/**
 * The injectable Venly client contract. SdkVenlyClient is the production
 * implementation; tests inject a lightweight mock. The MCP layer depends only
 * on this interface, keeping the fail-closed write path testable without a
 * network.
 */
export interface VenlyClient {
  /** The environment this client actually targets. When present, createServer
   * refuses to start if it disagrees with the VENLY_ENV the write gate reads –
   * the mock gate auto-arms writes, so the two must never diverge. */
  readonly environment?: VenlyEnvironment;

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
  getSupportedChains(): Promise<SupportedChains[]>;
  getFiatCurrencies(): Promise<FiatCurrency[]>;
  getCryptocurrencies(): Promise<CryptoCurrency[]>;
  getCompanyFees(): Promise<VenlyFee[]>;

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
  /**
   * Store an agent-prepared decision draft on the MOCK world (the sdk mock's
   * simulations.decision.prepare driver). Only reachable in mock mode - the
   * sandbox gate refuses the tool before this is called anywhere else - and
   * it mutates nothing but the local fixture store.
   */
  prepareDecision(input: PrepareDecisionInput): Promise<DecisionDraft>;

  // ----- Payout surface (contract 1.3.0) -----
  listPayouts(accountId: string, params?: { page?: number; size?: number; status?: string }): Promise<Payout[]>;
  getPayout(accountId: string, payoutId: string): Promise<Payout>;
  requestPayout(accountId: string, body: CreatePayoutInput): Promise<Payout>;
  listPayoutRoutes(accountId: string): Promise<PayoutRoute[]>;
  createPayoutRoute(accountId: string, body: CreatePayoutRouteInput): Promise<PayoutRoute>;
  preparePayoutOwnershipProof(
    accountId: string,
    routeId: string,
  ): Promise<PayoutOwnershipProof>;
  completePayoutOwnershipProof(
    accountId: string,
    routeId: string,
    body: CompleteOwnershipProofInput,
  ): Promise<PayoutRoute>;
  listPayoutBankAccounts(partyId: string): Promise<PayoutBankAccount[]>;
  registerPayoutBankAccount(
    partyId: string,
    body: RegisterPayoutBankAccountInput,
  ): Promise<PayoutBankAccount>;
}
