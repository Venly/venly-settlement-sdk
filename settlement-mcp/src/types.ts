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

type FinanceSchemas = FinanceComponents["schemas"];
type FundflowSchemas = FundflowComponents["schemas"];

export type AddressInput = FinanceSchemas["Address"];
export type Party = FinanceSchemas["Party"];
export type CreatePartyInput = FinanceSchemas["CreatePartyRequest"];
export type Account = FinanceSchemas["Account"];
export type CreateAccountInput = FinanceSchemas["CreateAccountRequest"];
export type Wallet = FinanceSchemas["Wallet"];
export type VirtualBankAccount = FinanceSchemas["VirtualBankAccount"];
export type CreateVirtualBankAccountInput =
  FinanceSchemas["CreateVirtualBankAccountRequest"];
export type PaymentSession = FinanceSchemas["PaymentSession"];
export type CreatePayInSessionRequest =
  FinanceSchemas["CreatePayInSessionRequest"];
export type Transfer = FinanceSchemas["Transfer"];
export type CurrentCreateFiatTransferInput =
  FinanceSchemas["CreateFiatTransferInput"];
export type CreateCryptoTransferInput =
  FinanceSchemas["CreateCryptoTransferInput"];

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
}
