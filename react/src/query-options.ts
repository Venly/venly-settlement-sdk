import type { FundflowClient, VenlyFinanceClient } from "@venlyfinance/sdk";
import type { VenlyClients } from "./provider.js";
import { venlyKeys } from "./keys.js";

// Parameter types are extracted from the SDK's method signatures (which are
// generated from the OpenAPI specs), never hand-written: a spec regeneration
// that changes a query shape breaks this package's build instead of silently
// drifting. Same rule as the SDK's own mock fixtures.
export type PartiesQuery = NonNullable<Parameters<VenlyFinanceClient["parties"]["list"]>[0]>;
export type AccountsQuery = NonNullable<Parameters<VenlyFinanceClient["accounts"]["list"]>[0]>;
export type WalletsQuery = NonNullable<Parameters<VenlyFinanceClient["wallets"]["list"]>[1]>;
export type PartyRolesQuery = NonNullable<
  Parameters<VenlyFinanceClient["accounts"]["listPartyRoles"]>[1]
>;
export type VirtualBankAccountsQuery = NonNullable<
  Parameters<VenlyFinanceClient["virtualBankAccounts"]["list"]>[1]
>;
export type TransfersQuery = NonNullable<Parameters<VenlyFinanceClient["transfers"]["list"]>[1]>;
export type PayoutsQuery = NonNullable<Parameters<VenlyFinanceClient["payouts"]["list"]>[1]>;
export type PayoutRoutesQuery = NonNullable<
  Parameters<VenlyFinanceClient["payoutRoutes"]["list"]>[1]
>;
export type PayoutBankAccountsQuery = NonNullable<
  Parameters<VenlyFinanceClient["payoutBankAccounts"]["list"]>[1]
>;
export type RampRequestsQuery = NonNullable<
  Parameters<FundflowClient["rampRequests"]["list"]>[0]
>;
export type FeeQuoteInput = Parameters<FundflowClient["fees"]["calculate"]>[0];
export type CompanyBankAccountsQuery = NonNullable<
  Parameters<FundflowClient["bankAccounts"]["list"]>[0]
>;
export type CompanyWalletsQuery = NonNullable<
  Parameters<FundflowClient["companyWallets"]["list"]>[0]
>;
export type DepositWalletsQuery = NonNullable<
  Parameters<FundflowClient["referenceData"]["depositWallets"]>[0]
>;

/**
 * Pure `{ queryKey, queryFn }` factories, one per read. The hooks in
 * queries.ts are one-line wrappers over these; anything that needs the same
 * read outside React (prefetching, route loaders, tests) uses them directly.
 */
export const venlyQueries = {
  parties: (clients: VenlyClients, query?: PartiesQuery) => ({
    queryKey: venlyKeys.parties(query),
    queryFn: () => clients.finance.parties.list(query),
  }),

  party: (clients: VenlyClients, partyId: string) => ({
    queryKey: venlyKeys.party(partyId),
    queryFn: () => clients.finance.parties.get(partyId),
  }),

  /**
   * The party's identity-verification state, read off the contract operation
   * (`getPartyIvVerification`) - never off the mock's internals, so the same
   * read works against every environment. `NOT_LINKED` is a state, not an
   * error: an unlinked party resolves rather than rejecting.
   */
  partyIvVerification: (clients: VenlyClients, partyId: string) => ({
    queryKey: venlyKeys.partyIvVerification(partyId),
    queryFn: () => clients.finance.parties.ivVerification(partyId),
  }),

  accounts: (clients: VenlyClients, query?: AccountsQuery) => ({
    queryKey: venlyKeys.accounts(query),
    queryFn: () => clients.finance.accounts.list(query),
  }),

  account: (clients: VenlyClients, accountId: string) => ({
    queryKey: venlyKeys.account(accountId),
    queryFn: () => clients.finance.accounts.get(accountId),
  }),

  /**
   * The parties attached to an account, each with a role type
   * (ACCOUNT_HOLDER | PAYOUT_RECIPIENT) and a status. The payout-recipient
   * rows are the account's saved third-party recipients.
   */
  partyRoles: (clients: VenlyClients, accountId: string, query?: PartyRolesQuery) => ({
    queryKey: venlyKeys.partyRoles(accountId, query),
    queryFn: () => clients.finance.accounts.listPartyRoles(accountId, query),
  }),

  wallets: (clients: VenlyClients, accountId: string, query?: WalletsQuery) => ({
    queryKey: venlyKeys.wallets(accountId, query),
    queryFn: () => clients.finance.wallets.list(accountId, query),
  }),

  /** Tenant-wide supported assets, each with its on-chain `decimals`. */
  supportedAssets: (clients: VenlyClients) => ({
    queryKey: venlyKeys.supportedAssets(),
    queryFn: () => clients.finance.supportedAssets.list(),
  }),

  /** Account-scoped rows: the same assets plus per-asset `permitStatus`. */
  accountSupportedAssets: (clients: VenlyClients, accountId: string) => ({
    queryKey: venlyKeys.accountSupportedAssets(accountId),
    queryFn: () => clients.finance.supportedAssets.listForAccount(accountId),
  }),

  virtualBankAccounts: (
    clients: VenlyClients,
    accountId: string,
    query?: VirtualBankAccountsQuery,
  ) => ({
    queryKey: venlyKeys.virtualBankAccounts(accountId, query),
    queryFn: () => clients.finance.virtualBankAccounts.list(accountId, query),
  }),

  transfers: (clients: VenlyClients, accountId: string, query?: TransfersQuery) => ({
    queryKey: venlyKeys.transfers(accountId, query),
    queryFn: () => clients.finance.transfers.list(accountId, query),
  }),

  transfer: (clients: VenlyClients, accountId: string, transferId: string) => ({
    queryKey: venlyKeys.transfer(accountId, transferId),
    queryFn: () => clients.finance.transfers.get(accountId, transferId),
  }),

  payouts: (clients: VenlyClients, accountId: string, query?: PayoutsQuery) => ({
    queryKey: venlyKeys.payouts(accountId, query),
    queryFn: () => clients.finance.payouts.list(accountId, query),
  }),

  payout: (clients: VenlyClients, accountId: string, payoutId: string) => ({
    queryKey: venlyKeys.payout(accountId, payoutId),
    queryFn: () => clients.finance.payouts.get(accountId, payoutId),
  }),

  payoutRoutes: (clients: VenlyClients, accountId: string, query?: PayoutRoutesQuery) => ({
    queryKey: venlyKeys.payoutRoutes(accountId, query),
    queryFn: () => clients.finance.payoutRoutes.list(accountId, query),
  }),

  payoutBankAccounts: (
    clients: VenlyClients,
    partyId: string,
    query?: PayoutBankAccountsQuery,
  ) => ({
    queryKey: venlyKeys.payoutBankAccounts(partyId, query),
    queryFn: () => clients.finance.payoutBankAccounts.list(partyId, query),
  }),

  /** Registered webhook endpoints (bare array on the wire; Page for resultPresent). */
  webhooks: (clients: VenlyClients) => ({
    queryKey: venlyKeys.webhooks(),
    queryFn: () => clients.finance.webhooks.list(),
  }),

  webhook: (clients: VenlyClients, webhookId: string) => ({
    queryKey: venlyKeys.webhook(webhookId),
    queryFn: () => clients.finance.webhooks.get(webhookId),
  }),

  rampRequests: (clients: VenlyClients, query?: RampRequestsQuery) => ({
    queryKey: venlyKeys.rampRequests(query),
    queryFn: () => clients.fundflow.rampRequests.list(query),
  }),

  rampRequest: (clients: VenlyClients, id: string) => ({
    queryKey: venlyKeys.rampRequest(id),
    queryFn: () => clients.fundflow.rampRequests.get(id),
  }),

  /** Chains + fiat + crypto currencies in one cacheable read. */
  referenceData: (clients: VenlyClients) => ({
    queryKey: venlyKeys.referenceData(),
    queryFn: async () => {
      const [fiatCurrencies, cryptoCurrencies, chains] = await Promise.all([
        clients.fundflow.referenceData.fiatCurrencies(),
        clients.fundflow.referenceData.cryptoCurrencies(),
        clients.fundflow.referenceData.chains(),
      ]);
      return { fiatCurrencies, cryptoCurrencies, chains };
    },
  }),

  companyFees: (clients: VenlyClients) => ({
    queryKey: venlyKeys.companyFees(),
    queryFn: () => clients.fundflow.fees.listCompanyFees(),
  }),

  /**
   * Fee calculation is a POST but semantically a pure function of its input,
   * so it is modelled as a query keyed by the input: same input, cached
   * answer; new input, new fetch.
   */
  feeQuote: (clients: VenlyClients, input: FeeQuoteInput) => ({
    queryKey: venlyKeys.feeQuote(input),
    queryFn: () => clients.fundflow.fees.calculate(input),
  }),

  companyBankAccounts: (clients: VenlyClients, query?: CompanyBankAccountsQuery) => ({
    queryKey: venlyKeys.companyBankAccounts(query),
    queryFn: () => clients.fundflow.bankAccounts.list(query),
  }),

  companyBankAccount: (clients: VenlyClients, id: string) => ({
    queryKey: venlyKeys.companyBankAccount(id),
    queryFn: () => clients.fundflow.bankAccounts.get(id),
  }),

  companyWallets: (clients: VenlyClients, query?: CompanyWalletsQuery) => ({
    queryKey: venlyKeys.companyWallets(query),
    queryFn: () => clients.fundflow.companyWallets.list(query),
  }),

  bankAccountConfig: (clients: VenlyClients) => ({
    queryKey: venlyKeys.bankAccountConfig(),
    queryFn: () => clients.fundflow.referenceData.bankAccountConfig(),
  }),

  depositWallets: (clients: VenlyClients, query?: DepositWalletsQuery) => ({
    queryKey: venlyKeys.depositWallets(query),
    queryFn: () => clients.fundflow.referenceData.depositWallets(query),
  }),

  rampPairs: (clients: VenlyClients, direction: "on" | "off") => ({
    queryKey: venlyKeys.rampPairs(direction),
    queryFn: () =>
      direction === "on"
        ? clients.fundflow.rampRequests.onRampPairs()
        : clients.fundflow.rampRequests.offRampPairs(),
  }),
} as const;
