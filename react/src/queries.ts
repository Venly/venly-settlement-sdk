import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import { useVenly } from "./provider.js";
import {
  venlyQueries,
  type AccountsQuery,
  type FeeQuoteInput,
  type PartiesQuery,
  type RampRequestsQuery,
  type TransfersQuery,
  type VirtualBankAccountsQuery,
  type WalletsQuery,
} from "./query-options.js";

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
