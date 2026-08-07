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

type _fs = _finance["schemas"];
export type Party = _fs["Party"];
export type PartyRole = _fs["PartyRole"];
export type Account = _fs["Account"];
export type Wallet = _fs["Wallet"];
export type VirtualBankAccount = _fs["VirtualBankAccount"];
export type PaymentSession = _fs["PaymentSession"];
export type PaymentRequest = _fs["PaymentRequest"];
export type PaymentExecution = _fs["PaymentExecution"];
export type Transfer = _fs["Transfer"];
export type PermitMessage = _fs["PermitMessage"];
export type PermitResult = _fs["PermitResult"];
export type Allowance = _fs["Allowance"];
export type Address = _fs["Address"];
export type Pagination = _fs["Pagination"];
export type CreatePartyRequest = _fs["CreatePartyRequest"];
export type UpdatePartyRequest = _fs["UpdatePartyRequest"];
export type CreateAccountRequest = _fs["CreateAccountRequest"];
export type AddPartyRoleRequest = _fs["AddPartyRoleRequest"];
export type CreateVirtualBankAccountRequest = _fs["CreateVirtualBankAccountRequest"];
export type CreatePayInSessionRequest = _fs["CreatePayInSessionRequest"];
export type CreatePaymentRequestInput = _fs["CreatePaymentRequestInput"];
export type CreateFiatTransferInput = _fs["CreateFiatTransferInput"];
export type CreateCryptoTransferInput = _fs["CreateCryptoTransferInput"];

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
