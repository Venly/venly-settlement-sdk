import type { components } from "../generated/fundflow.js";
import {
  MockTransport,
  itemEnvelope,
  listEnvelope,
  type RouteTable,
  type VenlyMock,
} from "./transport.js";
import { fundflowErrorPresets } from "./errors.js";
import { FundflowMockStore, type FundflowSeeds } from "./fundflow-store.js";

type schemas = components["schemas"];

/**
 * Fundflow API mock for `environment: "mock"`. Stateful: the ramp-request
 * lifecycle behaves like the documented state machine (four-eyes legality,
 * optimistic-locking 409s, accreting event history) instead of echoing
 * fixtures, and bank-account/wallet whitelisting persists PENDING → VERIFIED
 * via drivers. Every seed `satisfies` its generated schema type.
 */

export const fiatCurrencies = [
  { id: "fc000001-0000-4000-8000-000000000001", currency: "EUR", label: "Euro", enabled: true, version: 1 },
  { id: "fc000001-0000-4000-8000-000000000002", currency: "USD", label: "US Dollar", enabled: true, version: 1 },
  { id: "fc000001-0000-4000-8000-000000000003", currency: "GBP", label: "British Pound", enabled: true, version: 1 },
] satisfies schemas["FiatCurrencyDto"][];

export const cryptoCurrencies = [
  { id: "cc000001-0000-4000-8000-000000000001", currency: "USDC", chain: "BASE", label: "USD Coin", enabled: true, version: 1, coingeckoId: "usd-coin" },
  { id: "cc000001-0000-4000-8000-000000000002", currency: "EURC", chain: "BASE", label: "Euro Coin", enabled: true, version: 1, coingeckoId: "euro-coin" },
] satisfies schemas["CryptoCurrencyDto"][];

export const chains = [{ supportedChains: ["BASE", "POLYGON"] }] satisfies schemas["SupportedChainsDto"][];

export const depositWallets = [
  {
    id: "dw000001-0000-4000-8000-000000000001",
    address: "0x4df2f3cbb3a2f6dc38c1ef4d1b6c1e8a29f8b2ca",
    chain: "BASE",
    label: "Venly deposit – BASE",
    isDefault: true,
    isActive: true,
    version: 1,
  },
] satisfies schemas["DepositWalletDto"][];

export const bankAccountConfig = {
  enabledAccountTypes: [
    { type: "EUR_SEPA", description: "SEPA credit transfer (EUR)" },
    { type: "GBP_FPS", description: "Faster Payments (GBP)" },
    { type: "USD_ACH", description: "ACH (USD)" },
  ],
  supportedCountries: [
    { countryCode: "BE", countryName: "Belgium" },
    { countryCode: "DE", countryName: "Germany" },
    { countryCode: "NL", countryName: "Netherlands" },
    { countryCode: "GB", countryName: "United Kingdom" },
    { countryCode: "US", countryName: "United States" },
  ],
  supportedCurrencies: [
    { code: "EUR", name: "Euro" },
    { code: "GBP", name: "British Pound" },
    { code: "USD", name: "US Dollar" },
  ],
} satisfies schemas["BankAccountConfigDto"];

/** Verified EUR account: usable as an OFF_RAMP destination immediately. */
export const bankAccountVerified = {
  id: "ba000001-0000-4000-8000-000000000001",
  companyId: "co000001-0000-4000-8000-000000000001",
  name: "Primary EUR account",
  bankName: "Mock Bank AG",
  companyName: "Acme Corporation B.V.",
  bankCountry: "DE",
  beneficiaryAddressLine1: "Keizersgracht 1",
  beneficiaryCity: "Amsterdam",
  beneficiaryPostalCode: "1015 CC",
  beneficiaryCountry: "NL",
  bankAccountType: "EUR_SEPA",
  supportedRampType: "ON_AND_OFF_RAMP",
  verificationStatus: "VERIFIED",
  verifiedAt: "2026-07-01T10:00:00Z",
  createdAt: "2026-06-28T09:00:00Z",
  version: 2,
} satisfies schemas["CompanyBankAccountDto"] & { iban?: string; bic?: string };

/** Pending USD account: renders the whitelisting-in-review state. */
export const bankAccountPending = {
  id: "ba000001-0000-4000-8000-000000000002",
  companyId: "co000001-0000-4000-8000-000000000001",
  name: "US operating account",
  bankName: "Mock Bank N.A.",
  companyName: "Acme Corporation B.V.",
  bankCountry: "US",
  beneficiaryAddressLine1: "100 Market St",
  beneficiaryCity: "San Francisco",
  beneficiaryState: "CA",
  beneficiaryPostalCode: "94105",
  beneficiaryCountry: "US",
  bankAccountType: "USD_ACH",
  supportedRampType: "OFF_RAMP",
  verificationStatus: "PENDING",
  createdAt: "2026-08-01T14:30:00Z",
  version: 0,
} satisfies schemas["CompanyBankAccountDto"];

export const companyWallets = [
  {
    id: "cw000001-0000-4000-8000-000000000001",
    address: "0x71C7656EC7ab88b098defB751B7401B5f6d8976F",
    chain: "BASE",
    description: "Treasury wallet",
    verificationStatus: "VERIFIED",
    createdAt: "2026-06-28T09:05:00Z",
    version: 1,
  },
  {
    id: "cw000001-0000-4000-8000-000000000002",
    address: "0x2f6dc38c1ef4d1b6c1e8a29f8b2ca4df2f3cbb3a",
    chain: "POLYGON",
    description: "Ops wallet (awaiting ownership proof)",
    verificationStatus: "PENDING",
    createdAt: "2026-08-02T11:00:00Z",
    version: 0,
  },
] satisfies schemas["CompanyWalletDto"][];

const iban = { iban: "DE89370400440532013000", bic: "COBADEFFXXX" };

/** Five seeds covering the visible lifecycle states. */
export const rampRequestSeeds = [
  {
    id: "123e4567-e89b-12d3-a456-426614174000",
    companyId: "co000001-0000-4000-8000-000000000001",
    companyName: "Acme Corporation B.V.",
    rampType: "ON_RAMP",
    status: "AWAITING_APPROVAL",
    fiatAmount: 1000.0,
    fiatNetAmount: 990.0,
    cryptoAmount: 990.0,
    fiatFeeAmount: 10.0,
    exchangeRate: 1.0,
    feePercentage: 1.0,
    paymentReference: "PAY-2026-001234",
    paymentReceived: false,
    createdAt: "2026-07-24T09:00:00Z",
    fiatCurrency: fiatCurrencies[0],
    cryptoCurrency: cryptoCurrencies[0],
    companyWallet: companyWallets[0],
    events: [
      { id: "ev000001-0000-4000-8000-000000000001", eventType: "CREATED", username: "manager", email: "manager@acme.eu", role: "COMPANY_MANAGER", createdAt: "2026-07-24T09:00:00Z", version: 0 },
    ],
    version: 0,
  },
  {
    id: "123e4567-e89b-12d3-a456-426614174001",
    companyId: "co000001-0000-4000-8000-000000000001",
    companyName: "Acme Corporation B.V.",
    rampType: "ON_RAMP",
    status: "AWAITING_FUNDS",
    fiatAmount: 5000.0,
    fiatNetAmount: 4950.0,
    cryptoAmount: 4950.0,
    fiatFeeAmount: 50.0,
    exchangeRate: 1.0,
    feePercentage: 1.0,
    paymentReference: "PAY-2026-001235",
    paymentReceived: false,
    createdAt: "2026-07-23T15:20:00Z",
    fiatCurrency: fiatCurrencies[0],
    cryptoCurrency: cryptoCurrencies[0],
    companyWallet: companyWallets[0],
    // Wire truth is bankAccountType "EUR_SEPA"; the generated oneOf discriminator
    // expects DTO type names (contract-hygiene item), hence the boundary cast.
    depositBankAccount: { bankAccountType: "EUR_SEPA", name: "Venly deposit account", bankName: "Mock Bank AG", ...iban } as unknown as schemas["RampRequestDto"]["depositBankAccount"],
    events: [
      { id: "ev000001-0000-4000-8000-000000000002", eventType: "CREATED", username: "ops", email: "ops@acme.eu", role: "COMPANY_MANAGER", createdAt: "2026-07-23T15:20:00Z", version: 0 },
      { id: "ev000001-0000-4000-8000-000000000003", eventType: "APPROVED", username: "admin", email: "admin@acme.eu", role: "COMPANY_ADMIN", createdAt: "2026-07-23T16:00:00Z", version: 1 },
    ],
    version: 1,
  },
  {
    id: "123e4567-e89b-12d3-a456-426614174002",
    companyId: "co000001-0000-4000-8000-000000000001",
    companyName: "Acme Corporation B.V.",
    rampType: "OFF_RAMP",
    status: "SUCCEEDED",
    fiatAmount: 2500.0,
    fiatNetAmount: 2475.0,
    cryptoAmount: 2500.0,
    fiatFeeAmount: 25.0,
    exchangeRate: 1.0,
    feePercentage: 1.0,
    paymentReference: "PAY-2026-001236",
    paymentReceived: true,
    amountReceived: 2500.0,
    blockchainTransactionHash: "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
    createdAt: "2026-07-20T12:10:00Z",
    fiatCurrency: fiatCurrencies[1],
    cryptoCurrency: cryptoCurrencies[0],
    companyBankAccount: bankAccountVerified as unknown as schemas["RampRequestDto"]["companyBankAccount"],
    depositWallet: depositWallets[0],
    events: [
      { id: "ev000001-0000-4000-8000-000000000004", eventType: "CREATED", username: "treasury", email: "treasury@acme.eu", role: "COMPANY_MANAGER", createdAt: "2026-07-20T12:10:00Z", version: 0 },
      { id: "ev000001-0000-4000-8000-000000000005", eventType: "APPROVED", username: "admin", email: "admin@acme.eu", role: "COMPANY_ADMIN", createdAt: "2026-07-20T13:00:00Z", version: 1 },
      { id: "ev000001-0000-4000-8000-000000000006", eventType: "TX_HASH_ADDED", username: "treasury", email: "treasury@acme.eu", role: "COMPANY_MANAGER", createdAt: "2026-07-20T14:00:00Z", version: 2 },
      { id: "ev000001-0000-4000-8000-000000000007", eventType: "COMPLETED", username: "system", email: "system@venly.io", role: "COMPANY_ADMIN", createdAt: "2026-07-21T09:00:00Z", version: 3 },
    ],
    version: 3,
  },
  {
    id: "123e4567-e89b-12d3-a456-426614174003",
    companyId: "co000001-0000-4000-8000-000000000001",
    companyName: "Acme Corporation B.V.",
    rampType: "ON_RAMP",
    status: "REJECTED",
    fiatAmount: 750.0,
    fiatNetAmount: 742.5,
    cryptoAmount: 742.5,
    fiatFeeAmount: 7.5,
    exchangeRate: 1.0,
    feePercentage: 1.0,
    paymentReference: "PAY-2026-001237",
    paymentReceived: false,
    createdAt: "2026-07-18T10:05:00Z",
    fiatCurrency: fiatCurrencies[0],
    cryptoCurrency: cryptoCurrencies[1],
    companyWallet: companyWallets[0],
    events: [
      { id: "ev000001-0000-4000-8000-000000000008", eventType: "CREATED", username: "ops", email: "ops@acme.eu", role: "COMPANY_MANAGER", createdAt: "2026-07-18T10:05:00Z", version: 0 },
      { id: "ev000001-0000-4000-8000-000000000009", eventType: "REJECTED", username: "admin", email: "admin@acme.eu", role: "COMPANY_ADMIN", createdAt: "2026-07-18T11:00:00Z", version: 1 },
    ],
    version: 1,
  },
  {
    id: "123e4567-e89b-12d3-a456-426614174004",
    companyId: "co000001-0000-4000-8000-000000000001",
    companyName: "Acme Corporation B.V.",
    rampType: "OFF_RAMP",
    status: "PROCESSING",
    fiatAmount: 12000.0,
    fiatNetAmount: 11880.0,
    cryptoAmount: 12000.0,
    fiatFeeAmount: 120.0,
    exchangeRate: 1.0,
    feePercentage: 1.0,
    paymentReference: "PAY-2026-001238",
    paymentReceived: true,
    amountReceived: 12000.0,
    blockchainTransactionHash: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
    createdAt: "2026-07-25T07:45:00Z",
    fiatCurrency: fiatCurrencies[0],
    cryptoCurrency: cryptoCurrencies[0],
    companyBankAccount: bankAccountVerified as unknown as schemas["RampRequestDto"]["companyBankAccount"],
    depositWallet: depositWallets[0],
    events: [
      { id: "ev000001-0000-4000-8000-000000000010", eventType: "CREATED", username: "treasury", email: "treasury@acme.eu", role: "COMPANY_MANAGER", createdAt: "2026-07-25T07:45:00Z", version: 0 },
      { id: "ev000001-0000-4000-8000-000000000011", eventType: "APPROVED", username: "admin", email: "admin@acme.eu", role: "COMPANY_ADMIN", createdAt: "2026-07-25T08:30:00Z", version: 1 },
      { id: "ev000001-0000-4000-8000-000000000012", eventType: "TX_HASH_ADDED", username: "treasury", email: "treasury@acme.eu", role: "COMPANY_MANAGER", createdAt: "2026-07-25T09:00:00Z", version: 2 },
    ],
    version: 2,
  },
] satisfies schemas["RampRequestDto"][];

export const calculatedFee = {
  amount: 10.0,
  percentage: 1.0,
} satisfies schemas["CalculatedFeeDto"];

export const companyFees = [
  {
    id: "fe000001-0000-4000-8000-000000000001",
    companyId: "co000001-0000-4000-8000-000000000001",
    name: "on-ramp standard",
    percentage: 1.0,
    minVolume: 0,
    maxVolume: 2000000,
    version: 1,
  },
] satisfies schemas["FeeDto"][];

export const fundflowSeeds: FundflowSeeds = {
  rampRequests: rampRequestSeeds,
  createdBy: {
    "123e4567-e89b-12d3-a456-426614174000": "manager@acme.eu",
    "123e4567-e89b-12d3-a456-426614174001": "ops@acme.eu",
    "123e4567-e89b-12d3-a456-426614174002": "treasury@acme.eu",
    "123e4567-e89b-12d3-a456-426614174003": "ops@acme.eu",
    "123e4567-e89b-12d3-a456-426614174004": "treasury@acme.eu",
  },
  bankAccounts: [bankAccountVerified, bankAccountPending],
  companyWallets,
  depositWallets,
  fiatCurrencies,
  cryptoCurrencies,
  bankAccountConfig,
  feePercentage: 1.0,
};

function csv(store: FundflowMockStore): string {
  const header = "id,paymentReference,rampType,status,fiatAmount,fiatCurrency,cryptoAmount,cryptoCurrency,createdAt,createdBy";
  const rows = store.rampRequests.map((r) => {
    const item = store.toListItem(r);
    return [
      item.id,
      item.paymentReference,
      item.rampType,
      item.status,
      item.fiatAmount,
      item.fiatCurrency,
      item.cryptoAmount,
      item.cryptoCurrency,
      item.createdAt,
      item.createdBy,
    ].join(",");
  });
  return [header, ...rows].join("\n");
}

/** Route table over a stateful store: creates persist, transitions obey the state machine. */
export function createFundflowRoutes(store: FundflowMockStore): RouteTable {
  return {
    "GET /v1/ramp-requests": {
      kind: "handler",
      handle: (ctx) => listEnvelope(store.listRampRequests(ctx), ctx.query),
    },
    "POST /v1/ramp-requests": {
      kind: "handler",
      handle: (ctx) => itemEnvelope(store.createRampRequest(ctx)),
    },
    // Literal path shadows the {id} template, matching real router behavior.
    "GET /v1/ramp-requests/export": { kind: "handler", handle: () => csv(store) },
    "GET /v1/ramp-requests/on-ramp/pairs": {
      kind: "handler",
      handle: () => ({
        success: true,
        result: [
          { from: { currency: "EUR" }, to: { currency: "USDC", chain: "BASE" } },
          { from: { currency: "USD" }, to: { currency: "USDC", chain: "BASE" } },
        ],
      }),
    },
    "GET /v1/ramp-requests/off-ramp/pairs": {
      kind: "handler",
      handle: () => ({
        success: true,
        result: [{ from: { currency: "USDC", chain: "BASE" }, to: { currency: "EUR" } }],
      }),
    },
    "GET /v1/ramp-requests/{id}": {
      kind: "handler",
      handle: (ctx) => itemEnvelope(store.getRampRequest(ctx)),
    },
    "POST /v1/ramp-requests/{id}/approve": {
      kind: "handler",
      handle: (ctx) => itemEnvelope(store.approve(ctx)),
    },
    "POST /v1/ramp-requests/{id}/reject": {
      kind: "handler",
      handle: (ctx) => itemEnvelope(store.reject(ctx)),
    },
    "POST /v1/ramp-requests/{id}/cancel": {
      kind: "handler",
      handle: (ctx) => itemEnvelope(store.cancel(ctx)),
    },
    "PUT /v1/ramp-requests/{id}/amount": {
      kind: "handler",
      handle: (ctx) => itemEnvelope(store.setAmount(ctx)),
    },
    "PATCH /v1/ramp-requests/{id}/initiate": {
      kind: "handler",
      handle: (ctx) => itemEnvelope(store.setTxHash(ctx, true)),
    },
    "PATCH /v1/ramp-requests/{id}/tx-hash": {
      kind: "handler",
      handle: (ctx) => itemEnvelope(store.setTxHash(ctx, false)),
    },
    "POST /v1/fees/calculate": { kind: "item", result: calculatedFee },
    "GET /v1/fees": { kind: "array", items: companyFees },
    "GET /v1/fiat-currencies": { kind: "array", items: fiatCurrencies },
    "GET /v1/fiat-currencies/{id}": {
      kind: "handler",
      handle: (ctx) =>
        itemEnvelope(fiatCurrencies.find((c) => c.id === ctx.params.id) ?? fiatCurrencies[0]),
    },
    "GET /v1/crypto-currencies": { kind: "array", items: cryptoCurrencies },
    "GET /v1/crypto-currencies/{id}": {
      kind: "handler",
      handle: (ctx) =>
        itemEnvelope(cryptoCurrencies.find((c) => c.id === ctx.params.id) ?? cryptoCurrencies[0]),
    },
    "GET /v1/chains": { kind: "array", items: chains },
    "GET /v1/deposit-wallets": {
      kind: "handler",
      handle: (ctx) => ({
        success: true,
        result: store.depositWallets.filter(
          (w) => !ctx.query.chain || w.chain === ctx.query.chain,
        ),
      }),
    },
    "GET /v1/bank-accounts/config": {
      kind: "handler",
      handle: () => itemEnvelope(store.bankAccountConfig),
    },
    "GET /v1/company-bank-accounts": {
      kind: "handler",
      handle: (ctx) => listEnvelope(store.listBankAccounts(ctx), ctx.query),
    },
    "POST /v1/company-bank-accounts": {
      kind: "handler",
      handle: (ctx) => itemEnvelope(store.createBankAccount(ctx)),
    },
    "GET /v1/company-bank-accounts/{id}": {
      kind: "handler",
      handle: (ctx) => itemEnvelope(store.getBankAccount(ctx)),
    },
    "PATCH /v1/company-bank-accounts/{id}": {
      kind: "handler",
      handle: (ctx) => itemEnvelope(store.updateBankAccount(ctx)),
    },
    "GET /v1/company-wallets": {
      kind: "handler",
      handle: (ctx) => listEnvelope(store.listCompanyWallets(ctx), ctx.query),
    },
    "POST /v1/company-wallets": {
      kind: "handler",
      handle: (ctx) => itemEnvelope(store.createCompanyWallet(ctx)),
    },
    "GET /v1/company-wallets/{id}": {
      kind: "handler",
      handle: (ctx) => itemEnvelope(store.getCompanyWallet(ctx)),
    },
    "PATCH /v1/company-wallets/{id}": {
      kind: "handler",
      handle: (ctx) => itemEnvelope(store.updateCompanyWallet(ctx)),
    },
    // Company/user admin endpoints are deliberately not mocked: they manage
    // operator-console users, who authenticate against Venly's identity
    // platform rather than this API's whitelisting surface.
  };
}

/** Mock controls exposed as `client.mock` on mock-mode Fundflow clients. */
export interface VenlyFundflowMock extends VenlyMock {
  /**
   * Walk a ramp through the states only the platform (or arriving money)
   * can produce: "PAYMENT_RECEIVED" (ON_RAMP AWAITING_FUNDS → PROCESSING),
   * "SUCCEEDED" / "FAILED" (PROCESSING → terminal), "BLOCKED" / "DENIED".
   */
  advanceRamp(id: string, to: "PAYMENT_RECEIVED" | "SUCCEEDED" | "FAILED" | "BLOCKED" | "DENIED"): void;
  /** Complete (or deny) the whitelisting review a bank-account create started. */
  advanceBankAccountVerification(id: string, status?: "VERIFIED" | "DENIED"): void;
  /** Complete (or deny) the ownership proof a wallet create started. */
  advanceCompanyWalletVerification(id: string, status?: "VERIFIED" | "DENIED"): void;
  /** Restore the seed fixtures and clear the call log. */
  reset(): void;
}

/** Stateful fundflow mock transport wired to a fresh store per client. */
export class FundflowMockTransport extends MockTransport implements VenlyFundflowMock {
  private readonly store: FundflowMockStore;

  constructor() {
    const store = new FundflowMockStore(fundflowSeeds);
    super(createFundflowRoutes(store), fundflowErrorPresets);
    this.store = store;
  }

  advanceRamp(id: string, to: "PAYMENT_RECEIVED" | "SUCCEEDED" | "FAILED" | "BLOCKED" | "DENIED"): void {
    this.store.advanceRamp(id, to);
  }

  advanceBankAccountVerification(id: string, status?: "VERIFIED" | "DENIED"): void {
    this.store.advanceBankAccountVerification(id, status);
  }

  advanceCompanyWalletVerification(id: string, status?: "VERIFIED" | "DENIED"): void {
    this.store.advanceCompanyWalletVerification(id, status);
  }

  reset(): void {
    this.store.reset();
    this.clear();
  }
}

/** @deprecated Construct `FundflowMockTransport` instead; kept for 0.2.x compatibility. */
export const fundflowRoutes: RouteTable = createFundflowRoutes(new FundflowMockStore(fundflowSeeds));
