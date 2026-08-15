export { VenlyFinanceClient } from "./finance/client.js";
export type {
  VenlyFinanceClientOptions,
  VenlyFinanceCredentialOptions,
  VenlyFinanceMockOptions,
  FinanceEnvironment,
  VenlyEnvironment,
  CallOptions,
} from "./finance/client.js";
export { FundflowClient } from "./fundflow/client.js";
export type {
  CompanyBankAccountDetails,
  CreateCompanyBankAccountInput,
} from "./fundflow/client.js";
export type {
  FundflowClientOptions,
  FundflowCredentialOptions,
  FundflowMockOptions,
  FundflowEnvironment,
} from "./fundflow/client.js";

export { VenlyApiError, VenlyAuthError } from "./core/errors.js";
export type { ApiErrorBody } from "./core/errors.js";
export { TokenManager } from "./core/auth.js";
export { HttpClient } from "./core/http.js";
export type { RequestOptions, Transport } from "./core/http.js";

export { MockTransport, FinanceMockTransport, FundflowMockTransport, errorPresets, fundflowErrorPresets } from "./mock/index.js";
export type {
  VenlyMock,
  VenlyFinanceMock,
  VenlyFundflowMock,
  MockCall,
  ErrorPresetName,
  ErrorSpec,
  VerificationStatusInput,
} from "./mock/index.js";
export { iteratePages } from "./core/pagination.js";
export type { Page, PagingInfo, PageParams } from "./core/pagination.js";

export type { components as FinanceComponents } from "./generated/finance.js";
export type { components as FundflowComponents } from "./generated/fundflow.js";

// ── Named domain types ──────────────────────────────────────────────────
// Aliases for the most-used generated schemas, so consumers write `Party`
// instead of `FinanceComponents["schemas"]["Party"]`.
import type { components as _finance } from "./generated/finance.js";
import type { components as _fundflow } from "./generated/fundflow.js";

// Contract 1.3.0 (QA, retrieved 2026-08-14) renamed every read schema to a
// *Dto/*Response form. The SDK keeps its established names where the concept
// is unchanged; the mapping below is the single place that translation lives.
type _fs = _finance["schemas"];
export type Party = _fs["PartyDto"];
export type PartyRole = _fs["PartyRoleDto"];
export type Account = _fs["AccountListItemDto"];
/**
 * One asset balance row of an account's wallet, as returned by
 * `accounts.listWallets`. Contract 1.3.0 removed the wallet wrapper
 * (id/chain/address) from this listing — only balance rows remain, so the
 * former `Wallet` type no longer exists.
 */
export type WalletBalance = _fs["WalletBalanceDto"];
export type BalanceSummary = _fs["CryptoBalanceSummaryDto"];
export type VirtualBankAccount = _fs["VirtualBankAccountResponse"];
export type PaymentSession = _fs["PayInSessionDto"];
export type PaymentRequest = _fs["PaymentRequestDto"];
export type PaymentExecution = _fs["PaymentExecutionDto"];
export type Transfer = _fs["TransferRequestDto"];
export type PermitMessage = _fs["PermitMessageDto"];
export type PermitResult = _fs["PermitResultDto"];
export type Allowance = _fs["AllowanceInfo"];
export type Address = _fs["AddressDto"];
export type Pagination = _fs["Pagination"];
export type Payout = _fs["PayoutDto"];
export type PayoutRoute = _fs["PayoutRouteDto"];
export type PayoutBankAccount = _fs["PayoutBankAccountDto"];
export type SupportedAsset = _fs["SupportedAssetView"];
/** Account-scoped supported asset: the tenant row plus `permitStatus`. */
export type AccountSupportedAsset = _fs["AccountSupportedAssetView"];
export type Webhook = _fs["WebhookDto"];
export type PartyIvVerification = _fs["PartyIvVerificationDto"];
export type PartyVerificationLink = _fs["PartyVerificationLinkDto"];
export type CreatePartyRequest = _fs["CreatePartyRequest"];
export type UpdatePartyRequest = _fs["UpdatePartyRequest"];
export type CreateAccountRequest = _fs["CreateAccountRequest"];
export type AddPartyRoleRequest = _fs["AddPartyRoleRequest"];
export type CreateVirtualBankAccountRequest = _fs["CreateVirtualBankAccountRequest"];
export type CreatePayInSessionRequest = _fs["CreatePayInSessionInput"];
export type CreatePaymentRequestInput = _fs["CreatePaymentRequestInput"];
export type CreateFiatTransferInput = _fs["CreateFiatTransferInput"];
export type CreateCryptoTransferInput = _fs["CreateCryptoTransferInput"];
export type CreatePayoutRequest = _fs["CreatePayoutRequest"];
export type RegisterPayoutBankAccountRequest = _fs["RegisterPayoutBankAccountRequest"];

type _ffs = _fundflow["schemas"];
export type RampRequest = _ffs["RampRequestDto"];
export type FiatCurrency = _ffs["FiatCurrencyDto"];
export type CryptoCurrency = _ffs["CryptoCurrencyDto"];
export type Fee = _ffs["FeeDto"];
export type RampRequestListItem = _ffs["RampRequestListItem"];
export type RampRequestEvent = _ffs["RampRequestEventDto"];
export type CreateRampRequestRequest = _ffs["CreateRampRequestRequest"];
export type CalculatedFee = _ffs["CalculatedFeeDto"];
export type CompanyWallet = _ffs["CompanyWalletDto"];
export type CompanyWalletListItem = _ffs["CompanyWalletListItem"];
export type CompanyBankAccountListItem = _ffs["CompanyBankAccountListItem"];
export type CreateCompanyWalletRequest = _ffs["CreateCompanyWalletRequest"];
export type DepositWallet = _ffs["DepositWalletDto"];
export type BankAccountConfig = _ffs["BankAccountConfigDto"];
