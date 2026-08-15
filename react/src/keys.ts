/**
 * Query-key factory. Every hook and every cache invalidation goes through
 * this object so keys can never drift apart. Keys are plain JSON values.
 */
export const venlyKeys = {
  all: ["venly"] as const,

  parties: (query?: unknown) => ["venly", "parties", query ?? null] as const,
  party: (partyId: string) => ["venly", "party", partyId] as const,

  accounts: (query?: unknown) => ["venly", "accounts", query ?? null] as const,
  account: (accountId: string) => ["venly", "account", accountId] as const,

  wallets: (accountId: string, query?: unknown) =>
    ["venly", "account", accountId, "wallets", query ?? null] as const,

  supportedAssets: () => ["venly", "supported-assets"] as const,
  accountSupportedAssets: (accountId: string) =>
    ["venly", "account", accountId, "supported-assets"] as const,

  virtualBankAccounts: (accountId: string, query?: unknown) =>
    ["venly", "account", accountId, "virtual-bank-accounts", query ?? null] as const,

  transfers: (accountId: string, query?: unknown) =>
    ["venly", "account", accountId, "transfers", query ?? null] as const,
  transfer: (accountId: string, transferId: string) =>
    ["venly", "account", accountId, "transfer", transferId] as const,

  rampRequests: (query?: unknown) => ["venly", "ramp-requests", query ?? null] as const,
  rampRequest: (id: string) => ["venly", "ramp-request", id] as const,

  referenceData: () => ["venly", "reference-data"] as const,
  companyBankAccounts: (query?: unknown) =>
    ["venly", "company-bank-accounts", query ?? null] as const,
  companyBankAccount: (id: string) => ["venly", "company-bank-account", id] as const,
  companyWallets: (query?: unknown) => ["venly", "company-wallets", query ?? null] as const,
  bankAccountConfig: () => ["venly", "bank-account-config"] as const,
  depositWallets: (query?: unknown) => ["venly", "deposit-wallets", query ?? null] as const,
  rampPairs: (direction: "on" | "off") => ["venly", "ramp-pairs", direction] as const,
  companyFees: () => ["venly", "company-fees"] as const,
  feeQuote: (input: unknown) => ["venly", "fee-quote", input] as const,
} as const;
