// Provider + context
export {
  VenlyProvider,
  useVenly,
  useVenlyMock,
  type VenlyClients,
  type VenlyProviderProps,
  type VenlyReactEnvironment,
} from "./provider.js";

// Query keys + pure query factories (prefetching, loaders, tests)
export { venlyKeys } from "./keys.js";
export {
  venlyQueries,
  type AccountsQuery,
  type FeeQuoteInput,
  type PartiesQuery,
  type RampRequestsQuery,
  type TransfersQuery,
  type VirtualBankAccountsQuery,
  type WalletsQuery,
} from "./query-options.js";

// Read hooks
export {
  useAccount,
  useAccounts,
  useCompanyFees,
  useFeeQuote,
  useParties,
  useParty,
  useRampRequest,
  useRampRequests,
  useReferenceData,
  useTransfer,
  useTransfers,
  useVirtualBankAccounts,
  useWallets,
  useCompanyBankAccount,
  useCompanyBankAccounts,
  useCompanyWallets,
  useBankAccountConfig,
  useDepositWallets,
  useRampPairs,
} from "./queries.js";

// Write hooks
export {
  useCreateAccount,
  useCreateParty,
  useCreatePaymentSession,
  useCreateRampRequest,
  useCreateVirtualBankAccount,
  useCreateCompanyBankAccount,
  useCreateCompanyWallet,
  useSetRampAmount,
  useInitiateRamp,
} from "./mutations.js";

// Flow machines: the regulated-money lifecycles
export {
  StagedTransferController,
  useStagedTransfer,
  validateDraft,
  type StagedRequest,
  type StagedTransferOptions,
  type StagedTransferState,
  type TransferDraft,
} from "./flows/staged-transfer.js";
export {
  approvalCapabilities,
  interpretApprovalError,
  useFourEyesApproval,
  type ApprovalCapability,
  type ApprovalFailureKind,
  type FourEyesState,
} from "./flows/four-eyes.js";
export {
  describeRampStatus,
  useRampLifecycle,
  type RampLifecycleOptions,
  type RampStatus,
  type RampStatusDescriptor,
} from "./flows/ramp-lifecycle.js";

// Browser-safe deployment shape
export {
  proxyClientOptions,
  VENLY_PROXY_SECRET_SENTINEL,
  type ProxyClientOptions,
} from "./proxy.js";

// Re-export the SDK surface consumers need alongside the hooks, so app code
// can import one package. The SDK remains the canonical home.
export {
  FundflowClient,
  VenlyApiError,
  VenlyAuthError,
  VenlyFinanceClient,
} from "@venlyfinance/sdk";
export type {
  Account,
  Party,
  RampRequest,
  Transfer,
  VirtualBankAccount,
  Wallet,
} from "@venlyfinance/sdk";
