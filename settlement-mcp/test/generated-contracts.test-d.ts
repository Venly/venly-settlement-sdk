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
  Assert<Equal<AddressInput, Finance["Address"]>>,
  Assert<Equal<Party, Finance["Party"]>>,
  Assert<Equal<CreatePartyInput, Finance["CreatePartyRequest"]>>,
  Assert<Equal<Account, Finance["Account"]>>,
  Assert<Equal<CreateAccountInput, Finance["CreateAccountRequest"]>>,
  Assert<Equal<Wallet, Finance["Wallet"]>>,
  Assert<Equal<VirtualBankAccount, Finance["VirtualBankAccount"]>>,
  Assert<
    Equal<CreateVirtualBankAccountInput, Finance["CreateVirtualBankAccountRequest"]>
  >,
  Assert<Equal<PaymentSession, Finance["PaymentSession"]>>,
  Assert<Equal<CreatePayInSessionRequest, Finance["CreatePayInSessionRequest"]>>,
  Assert<Equal<Transfer, Finance["Transfer"]>>,
  Assert<Equal<CurrentCreateFiatTransferInput, Finance["CreateFiatTransferInput"]>>,
  Assert<Equal<CreateCryptoTransferInput, Finance["CreateCryptoTransferInput"]>>,
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
