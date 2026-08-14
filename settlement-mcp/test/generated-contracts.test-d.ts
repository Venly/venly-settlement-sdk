import type {
  FinanceComponents,
  FundflowComponents,
} from "@venlyfinance/sdk";
import type {
  Account,
  AddressInput,
  CreateAccountInput,
  CreateCryptoTransferInput,
  CreatePartyInput,
  CreatePayInSessionRequest,
  CreateVirtualBankAccountInput,
  CryptoCurrency,
  CurrentCreateFiatTransferInput,
  FiatCurrency,
  OptimisticLockingBody,
  Party,
  PaymentSession,
  RampRequestDto,
  RampRequestListItem,
  SupportedChains,
  Transfer,
  VenlyFee,
  VirtualBankAccount,
  Wallet,
  Payout,
  CreatePayoutInput,
  PayoutRoute,
  PayoutBankAccount,
  RegisterPayoutBankAccountInput,
} from "../src/types.js";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2)
    ? (<Value>() => Value extends Right ? 1 : 2) extends
        (<Value>() => Value extends Left ? 1 : 2)
      ? true
      : false
    : false;

type Assert<Condition extends true> = Condition;
type Finance = FinanceComponents["schemas"];
type Fundflow = FundflowComponents["schemas"];

type FinanceAliases = [
  Assert<Equal<AddressInput, Finance["AddressDto"]>>,
  Assert<Equal<Party, Finance["PartyDto"]>>,
  Assert<Equal<CreatePartyInput, Finance["CreatePartyRequest"]>>,
  Assert<Equal<Account, Finance["AccountListItemDto"]>>,
  Assert<Equal<CreateAccountInput, Finance["CreateAccountRequest"]>>,
  Assert<Equal<Wallet, Finance["WalletBalanceDto"]>>,
  Assert<Equal<VirtualBankAccount, Finance["VirtualBankAccountResponse"]>>,
  Assert<
    Equal<CreateVirtualBankAccountInput, Finance["CreateVirtualBankAccountRequest"]>
  >,
  Assert<Equal<PaymentSession, Finance["PayInSessionDto"]>>,
  Assert<Equal<CreatePayInSessionRequest, Finance["CreatePayInSessionInput"]>>,
  Assert<Equal<Transfer, Finance["TransferRequestDto"]>>,
  Assert<Equal<CurrentCreateFiatTransferInput, Finance["CreateFiatTransferInput"]>>,
  Assert<Equal<CreateCryptoTransferInput, Finance["CreateCryptoTransferInput"]>>,
  Assert<Equal<Payout, Finance["PayoutDto"]>>,
  Assert<Equal<CreatePayoutInput, Finance["CreatePayoutRequest"]>>,
  Assert<Equal<PayoutRoute, Finance["PayoutRouteDto"]>>,
  Assert<Equal<PayoutBankAccount, Finance["PayoutBankAccountDto"]>>,
  Assert<
    Equal<RegisterPayoutBankAccountInput, Finance["RegisterPayoutBankAccountRequest"]>
  >,
];

type FundflowAliases = [
  Assert<Equal<RampRequestDto, Fundflow["RampRequestDto"]>>,
  Assert<Equal<RampRequestListItem, Fundflow["RampRequestListItem"]>>,
  Assert<
    Equal<OptimisticLockingBody, Fundflow["UpdateWithOptimisticLockingRequest"]>
  >,
  Assert<Equal<SupportedChains, Fundflow["SupportedChainsDto"]>>,
  Assert<Equal<FiatCurrency, Fundflow["FiatCurrencyDto"]>>,
  Assert<Equal<CryptoCurrency, Fundflow["CryptoCurrencyDto"]>>,
  Assert<Equal<VenlyFee, Fundflow["FeeDto"]>>,
];

export type GeneratedContractAssertions = FinanceAliases | FundflowAliases;
