import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import { iteratePages, type Page, type Transfer as TransferRow } from "@venlyfinance/sdk";
import { useVenly } from "./provider.js";
import {
  venlyQueries,
  type AccountsQuery,
  type FeeQuoteInput,
  type PartiesQuery,
  type PartyRolesQuery,
  type PayoutBankAccountsQuery,
  type PayoutRoutesQuery,
  type PayoutsQuery,
  type RampRequestsQuery,
  type TransfersQuery,
  type VirtualBankAccountsQuery,
  type WalletsQuery,
  type CompanyBankAccountsQuery,
  type CompanyWalletsQuery,
  type DepositWalletsQuery,
} from "./query-options.js";
import { venlyKeys } from "./keys.js";

// Consumers may tune any TanStack option except the key/fn pair, which this
// package owns so cache identity stays consistent across an app.
type Tune<T> = Omit<UseQueryOptions<T, Error>, "queryKey" | "queryFn">;

export function useParties(query?: PartiesQuery, options?: Tune<PartiesPage>) {
  const clients = useVenly();
  return useQuery({ ...venlyQueries.parties(clients, query), ...options });
}
type PartiesPage = Awaited<ReturnType<ReturnType<typeof venlyQueries.parties>["queryFn"]>>;

export function useParty(partyId: string | undefined, options?: Tune<Party>) {
  const clients = useVenly();
  return useQuery({
    ...venlyQueries.party(clients, partyId ?? ""),
    enabled: Boolean(partyId) && (options?.enabled ?? true),
    ...options,
  });
}
type Party = Awaited<ReturnType<ReturnType<typeof venlyQueries.party>["queryFn"]>>;

/**
 * The party's identity-verification state, from the contract operation
 * (`getPartyIvVerification`). `NOT_LINKED` resolves like any other state -
 * identity verification is a state every party has, not a resource some lack.
 */
export function usePartyIvVerification(
  partyId: string | undefined,
  options?: Tune<PartyIvVerification>,
) {
  const clients = useVenly();
  return useQuery({
    ...venlyQueries.partyIvVerification(clients, partyId ?? ""),
    enabled: Boolean(partyId) && (options?.enabled ?? true),
    ...options,
  });
}
type PartyIvVerification = Awaited<
  ReturnType<ReturnType<typeof venlyQueries.partyIvVerification>["queryFn"]>
>;

export function useAccounts(query?: AccountsQuery, options?: Tune<AccountsPage>) {
  const clients = useVenly();
  return useQuery({ ...venlyQueries.accounts(clients, query), ...options });
}
type AccountsPage = Awaited<ReturnType<ReturnType<typeof venlyQueries.accounts>["queryFn"]>>;

export function useAccount(accountId: string | undefined, options?: Tune<Account>) {
  const clients = useVenly();
  return useQuery({
    ...venlyQueries.account(clients, accountId ?? ""),
    enabled: Boolean(accountId) && (options?.enabled ?? true),
    ...options,
  });
}
type Account = Awaited<ReturnType<ReturnType<typeof venlyQueries.account>["queryFn"]>>;

/**
 * The parties attached to an account with their role type and status.
 * Saved payout recipients are the PAYOUT_RECIPIENT rows of this read.
 */
export function usePartyRoles(
  accountId: string | undefined,
  query?: PartyRolesQuery,
  options?: Tune<PartyRolesPage>,
) {
  const clients = useVenly();
  return useQuery({
    ...venlyQueries.partyRoles(clients, accountId ?? "", query),
    enabled: Boolean(accountId) && (options?.enabled ?? true),
    ...options,
  });
}
type PartyRolesPage = Awaited<ReturnType<ReturnType<typeof venlyQueries.partyRoles>["queryFn"]>>;

export function useWallets(
  accountId: string | undefined,
  query?: WalletsQuery,
  options?: Tune<WalletsPage>,
) {
  const clients = useVenly();
  return useQuery({
    ...venlyQueries.wallets(clients, accountId ?? "", query),
    enabled: Boolean(accountId) && (options?.enabled ?? true),
    ...options,
  });
}
type WalletsPage = Awaited<ReturnType<ReturnType<typeof venlyQueries.wallets>["queryFn"]>>;

/**
 * Tenant-wide supported assets. `decimals` per asset is the render contract
 * for amounts; cached hard (the asset set changes on deploys, not minutes).
 */
export function useSupportedAssets(options?: Tune<SupportedAssetsPage>) {
  const clients = useVenly();
  return useQuery({
    ...venlyQueries.supportedAssets(clients),
    staleTime: Infinity,
    ...options,
  });
}
type SupportedAssetsPage = Awaited<
  ReturnType<ReturnType<typeof venlyQueries.supportedAssets>["queryFn"]>
>;

/**
 * Account-scoped supported assets (adds `permitStatus`). Not frozen:
 * permit status moves while an asset activates.
 */
export function useAccountSupportedAssets(
  accountId: string | undefined,
  options?: Tune<AccountSupportedAssetsPage>,
) {
  const clients = useVenly();
  return useQuery({
    ...venlyQueries.accountSupportedAssets(clients, accountId ?? ""),
    enabled: Boolean(accountId) && (options?.enabled ?? true),
    ...options,
  });
}
type AccountSupportedAssetsPage = Awaited<
  ReturnType<ReturnType<typeof venlyQueries.accountSupportedAssets>["queryFn"]>
>;

export function useVirtualBankAccounts(
  accountId: string | undefined,
  query?: VirtualBankAccountsQuery,
  options?: Tune<VibaPage>,
) {
  const clients = useVenly();
  return useQuery({
    ...venlyQueries.virtualBankAccounts(clients, accountId ?? "", query),
    enabled: Boolean(accountId) && (options?.enabled ?? true),
    ...options,
  });
}
type VibaPage = Awaited<
  ReturnType<ReturnType<typeof venlyQueries.virtualBankAccounts>["queryFn"]>
>;

export function useTransfers(
  accountId: string | undefined,
  query?: TransfersQuery,
  options?: Tune<TransfersPage>,
) {
  const clients = useVenly();
  return useQuery({
    ...venlyQueries.transfers(clients, accountId ?? "", query),
    enabled: Boolean(accountId) && (options?.enabled ?? true),
    ...options,
  });
}
type TransfersPage = Awaited<ReturnType<ReturnType<typeof venlyQueries.transfers>["queryFn"]>>;

export type TransferPeriod = { start: string; end: string };

export type TransfersForPeriodPage = {
  /** Rows whose `createdAt` falls in `[start, end]`. */
  items: TransferRow[];
  /**
   * Every transfer on the account after paging to completion. Opening and
   * closing walk from the current wallet total through this full ledger;
   * a window-only set would silently drop later movements.
   */
  ledger: TransferRow[];
  resultPresent: boolean;
};

/**
 * Page every transfer on the account (the list contract has no date filter),
 * then keep the window. `iteratePages` walks `hasNextPage`.
 */
export async function collectTransfersForPeriod(
  list: (query?: TransfersQuery) => Promise<Page<Transfer>>,
  period: TransferPeriod,
  pageSize = 20,
): Promise<TransfersForPeriodPage> {
  const ledger: TransferRow[] = [];
  for await (const item of iteratePages((params) => list({ page: params.page, size: params.size }), {
    size: pageSize,
  })) {
    ledger.push(item);
  }
  const items = ledger.filter((transfer) => {
    const at = transfer.createdAt;
    return Boolean(at && at >= period.start && at <= period.end);
  });
  return { items, ledger, resultPresent: true as const };
}

export function useTransfersForPeriod(
  accountId: string | undefined,
  period: TransferPeriod | undefined,
  options?: Tune<TransfersForPeriodPage>,
) {
  const clients = useVenly();
  const start = period?.start ?? "";
  const end = period?.end ?? "";
  return useQuery({
    queryKey: venlyKeys.transfersForPeriod(accountId ?? "", { start, end }),
    queryFn: () =>
      collectTransfersForPeriod(
        (query) => clients.finance.transfers.list(accountId ?? "", query),
        { start, end },
      ),
    enabled: Boolean(accountId && start && end) && (options?.enabled ?? true),
    ...options,
  });
}

export function useTransfer(
  accountId: string | undefined,
  transferId: string | undefined,
  options?: Tune<Transfer>,
) {
  const clients = useVenly();
  return useQuery({
    ...venlyQueries.transfer(clients, accountId ?? "", transferId ?? ""),
    enabled: Boolean(accountId && transferId) && (options?.enabled ?? true),
    ...options,
  });
}
type Transfer = Awaited<ReturnType<ReturnType<typeof venlyQueries.transfer>["queryFn"]>>;

export function usePayouts(
  accountId: string | undefined,
  query?: PayoutsQuery,
  options?: Tune<PayoutsPage>,
) {
  const clients = useVenly();
  return useQuery({
    ...venlyQueries.payouts(clients, accountId ?? "", query),
    enabled: Boolean(accountId) && (options?.enabled ?? true),
    ...options,
  });
}
type PayoutsPage = Awaited<ReturnType<ReturnType<typeof venlyQueries.payouts>["queryFn"]>>;

export function usePayout(
  accountId: string | undefined,
  payoutId: string | undefined,
  options?: Tune<PayoutDetail>,
) {
  const clients = useVenly();
  return useQuery({
    ...venlyQueries.payout(clients, accountId ?? "", payoutId ?? ""),
    enabled: Boolean(accountId && payoutId) && (options?.enabled ?? true),
    ...options,
  });
}
type PayoutDetail = Awaited<ReturnType<ReturnType<typeof venlyQueries.payout>["queryFn"]>>;

export function usePayoutRoutes(
  accountId: string | undefined,
  query?: PayoutRoutesQuery,
  options?: Tune<PayoutRoutesList>,
) {
  const clients = useVenly();
  return useQuery({
    ...venlyQueries.payoutRoutes(clients, accountId ?? "", query),
    enabled: Boolean(accountId) && (options?.enabled ?? true),
    ...options,
  });
}
type PayoutRoutesList = Awaited<
  ReturnType<ReturnType<typeof venlyQueries.payoutRoutes>["queryFn"]>
>;

export function usePayoutBankAccounts(
  partyId: string | undefined,
  query?: PayoutBankAccountsQuery,
  options?: Tune<PayoutBankAccountsPage>,
) {
  const clients = useVenly();
  return useQuery({
    ...venlyQueries.payoutBankAccounts(clients, partyId ?? "", query),
    enabled: Boolean(partyId) && (options?.enabled ?? true),
    ...options,
  });
}
type PayoutBankAccountsPage = Awaited<
  ReturnType<ReturnType<typeof venlyQueries.payoutBankAccounts>["queryFn"]>
>;

export function useRampRequests(query?: RampRequestsQuery, options?: Tune<RampPage>) {
  const clients = useVenly();
  return useQuery({ ...venlyQueries.rampRequests(clients, query), ...options });
}
type RampPage = Awaited<ReturnType<ReturnType<typeof venlyQueries.rampRequests>["queryFn"]>>;

export function useRampRequest(id: string | undefined, options?: Tune<Ramp>) {
  const clients = useVenly();
  return useQuery({
    ...venlyQueries.rampRequest(clients, id ?? ""),
    enabled: Boolean(id) && (options?.enabled ?? true),
    ...options,
  });
}
type Ramp = Awaited<ReturnType<ReturnType<typeof venlyQueries.rampRequest>["queryFn"]>>;

export function useReferenceData(options?: Tune<ReferenceData>) {
  const clients = useVenly();
  return useQuery({
    ...venlyQueries.referenceData(clients),
    staleTime: Infinity, // chains and currencies change on deploys, not minutes
    ...options,
  });
}
type ReferenceData = Awaited<
  ReturnType<ReturnType<typeof venlyQueries.referenceData>["queryFn"]>
>;

export function useCompanyFees(options?: Tune<CompanyFees>) {
  const clients = useVenly();
  return useQuery({ ...venlyQueries.companyFees(clients), ...options });
}
type CompanyFees = Awaited<ReturnType<ReturnType<typeof venlyQueries.companyFees>["queryFn"]>>;

export function useFeeQuote(input: FeeQuoteInput | undefined, options?: Tune<FeeQuote>) {
  const clients = useVenly();
  return useQuery({
    ...venlyQueries.feeQuote(clients, input as FeeQuoteInput),
    enabled: Boolean(input) && (options?.enabled ?? true),
    ...options,
  });
}
type FeeQuote = Awaited<ReturnType<ReturnType<typeof venlyQueries.feeQuote>["queryFn"]>>;

export function useCompanyBankAccounts(
  query?: CompanyBankAccountsQuery,
  options?: Tune<BankAccountsPage>,
) {
  const clients = useVenly();
  return useQuery({ ...venlyQueries.companyBankAccounts(clients, query), ...options });
}
type BankAccountsPage = Awaited<
  ReturnType<ReturnType<typeof venlyQueries.companyBankAccounts>["queryFn"]>
>;

export function useCompanyBankAccount(id: string | undefined, options?: Tune<BankAccountDetail>) {
  const clients = useVenly();
  return useQuery({
    ...venlyQueries.companyBankAccount(clients, id ?? ""),
    enabled: Boolean(id) && (options?.enabled ?? true),
    ...options,
  });
}
type BankAccountDetail = Awaited<
  ReturnType<ReturnType<typeof venlyQueries.companyBankAccount>["queryFn"]>
>;

export function useCompanyWallets(query?: CompanyWalletsQuery, options?: Tune<WalletsListPage>) {
  const clients = useVenly();
  return useQuery({ ...venlyQueries.companyWallets(clients, query), ...options });
}
type WalletsListPage = Awaited<
  ReturnType<ReturnType<typeof venlyQueries.companyWallets>["queryFn"]>
>;

export function useBankAccountConfig(options?: Tune<BankAccountConfigData>) {
  const clients = useVenly();
  return useQuery({
    ...venlyQueries.bankAccountConfig(clients),
    staleTime: Infinity, // enabled types/countries change on deploys, not minutes
    ...options,
  });
}
type BankAccountConfigData = Awaited<
  ReturnType<ReturnType<typeof venlyQueries.bankAccountConfig>["queryFn"]>
>;

export function useDepositWallets(query?: DepositWalletsQuery, options?: Tune<DepositWalletsData>) {
  const clients = useVenly();
  return useQuery({ ...venlyQueries.depositWallets(clients, query), ...options });
}
type DepositWalletsData = Awaited<
  ReturnType<ReturnType<typeof venlyQueries.depositWallets>["queryFn"]>
>;

/** Supported on/off-ramp currency pairs, for destination/asset pickers. */
export function useRampPairs(direction: "on" | "off", options?: Tune<RampPairsData>) {
  const clients = useVenly();
  return useQuery({
    ...venlyQueries.rampPairs(clients, direction),
    staleTime: Infinity,
    ...options,
  });
}
type RampPairsData = Awaited<ReturnType<ReturnType<typeof venlyQueries.rampPairs>["queryFn"]>>;
