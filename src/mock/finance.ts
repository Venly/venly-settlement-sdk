import type { components } from "../generated/finance.js";
import { financeRequestShapes } from "../generated/finance-shapes.js";
import {
  itemEnvelope,
  listEnvelope,
  MockTransport,
  type RouteTable,
  type VenlyMock,
} from "./transport.js";
import { errorPresets } from "./errors.js";
import { FinanceMockStore, type FinanceSeeds, type VerificationStatusInput, type MockInboundCredit } from "./store.js";

type schemas = components["schemas"];

/**
 * Finance API fixtures for `environment: "mock"`. Every entity `satisfies`
 * the generated OpenAPI schema type, so a spec regeneration that changes a
 * shape breaks this file at compile time instead of teaching wrong shapes.
 * Seed lineage: the specs' request examples + the settlement-mcp mock corpus.
 *
 * These are SEEDS: mock mode is stateful. Creates mint new ids and are
 * readable back; verification starts pending; transfers start PENDING.
 * `client.mock.reset()` returns to exactly this data.
 */

const address = {
  addressLine1: "Prinsengracht 263",
  city: "Amsterdam",
  postalCode: "1016 GV",
  country: "NL",
} satisfies schemas["AddressDto"];

export const parties = [
  {
    id: "0b54e9f1-1111-4a10-9b52-000000000001",
    externalId: "customer-42",
    partyType: "INDIVIDUAL",
    status: "ACTIVE",
    firstName: "Ada",
    lastName: "Lovelace",
    kycStatus: "VERIFIED",
    address,
  },
  {
    id: "0b54e9f1-1111-4a10-9b52-000000000002",
    externalId: "customer-43",
    partyType: "ORGANISATION",
    status: "ACTIVE",
    name: "Acme Corporation B.V.",
    vatNumber: "NL123456789B01",
    kybStatus: "VERIFIED",
    address,
  },
  {
    id: "0b54e9f1-1111-4a10-9b52-000000000003",
    externalId: "customer-44",
    partyType: "INDIVIDUAL",
    status: "ACTIVE",
    firstName: "Grace",
    lastName: "Hopper",
    kycStatus: "VERIFICATION_PENDING",
    address,
  },
  {
    id: "0b54e9f1-1111-4a10-9b52-000000000004",
    externalId: "customer-45",
    partyType: "ORGANISATION",
    status: "SUSPENDED",
    name: "Borealis Payments Ltd",
    kybStatus: "PENDING",
    address,
  },
  {
    id: "0b54e9f1-1111-4a10-9b52-000000000005",
    externalId: "customer-46",
    partyType: "INDIVIDUAL",
    status: "ACTIVE",
    firstName: "Satoshi",
    lastName: "Nakamura",
    kycStatus: "REJECTED",
    address,
  },
] satisfies schemas["PartyDto"][];

export const partyRole = {
  partyId: parties[0].id,
  roleType: "ACCOUNT_HOLDER",
  status: "ACTIVE",
} satisfies schemas["PartyRoleDto"];

export const accounts = [
  {
    id: "a10c2d31-2222-4b20-8c63-000000000001",
    externalId: "acct-main-eur",
    name: "Acme – Main EUR",
    kycStatus: "VERIFIED",
    status: "ACTIVE",
    createdAt: "2026-05-02T10:00:00Z",
    version: 0,
  },
  {
    id: "a10c2d31-2222-4b20-8c63-000000000002",
    externalId: "acct-ops-usd",
    name: "Acme – Ops USD",
    kycStatus: "VERIFIED",
    status: "ACTIVE",
    createdAt: "2026-05-02T10:05:00Z",
    version: 0,
  },
  {
    id: "a10c2d31-2222-4b20-8c63-000000000003",
    externalId: "acct-treasury",
    name: "Acme – Treasury",
    kycStatus: "VERIFIED",
    status: "ACTIVE",
    createdAt: "2026-05-10T08:30:00Z",
    version: 0,
  },
  {
    id: "a10c2d31-2222-4b20-8c63-000000000004",
    externalId: "acct-suspended",
    name: "Borealis – Frozen",
    kycStatus: "VERIFICATION_PENDING",
    status: "SUSPENDED",
    createdAt: "2026-06-01T12:00:00Z",
    version: 2,
  },
  {
    id: "a10c2d31-2222-4b20-8c63-000000000005",
    externalId: "acct-payouts",
    name: "Acme – Payouts",
    kycStatus: "VERIFIED",
    status: "ACTIVE",
    createdAt: "2026-06-15T09:45:00Z",
    version: 0,
  },
  {
    id: "a10c2d31-2222-4b20-8c63-000000000006",
    externalId: "acct-escrow",
    name: "Acme – Escrow",
    kycStatus: "VERIFIED",
    status: "ACTIVE",
    createdAt: "2026-07-01T10:00:00Z",
    version: 0,
  },
  {
    id: "a10c2d31-2222-4b20-8c63-000000000007",
    externalId: "acct-status-unavailable",
    name: "Status unavailable",
    status: "ACTIVE",
    createdAt: "2026-07-02T10:00:00Z",
    version: 0,
  },
] satisfies schemas["AccountListItemDto"][];

// Contract 1.3.0: `listWallets` returns per-asset balance rows only. The
// wallet wrapper (id/chain/address/amlStatus) is no longer part of the public
// read surface — see the gap register (wallet identity is unobtainable while
// the permit endpoints still key on {walletId}).
export const wallet = [
  {
    asset: "USDC",
    contractAddress: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    amount: { total: 15230.5, available: 15100.5, reserved: 130 },
  },
  {
    asset: "EURC",
    contractAddress: "0x60a3e35cc302bfa44cb288bc5a4f316fdb1adb42",
    // Sub-cent dust on a 6-decimal asset: a render that assumes two decimals
    // shows this as 8,020.00 and the row stops reconciling with the total.
    amount: { total: 8020.000875, available: 8020.000875, reserved: 0 },
  },
] satisfies schemas["WalletBalanceDto"][];

/** Each seeded account has its own balances – no cross-account leakage. */
const walletSeeds: Record<string, schemas["WalletBalanceDto"][]> = {
  [accounts[0].id]: wallet,
  [accounts[1].id]: [
    {
      asset: "USDC",
      contractAddress: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
      amount: { total: 2500, available: 2500, reserved: 0 },
    },
  ],
  [accounts[2].id]: [
    {
      asset: "EURC",
      contractAddress: "0x60a3e35cc302bfa44cb288bc5a4f316fdb1adb42",
      amount: { total: 12000, available: 12000, reserved: 0 },
    },
  ],
  // accounts[3] (suspended) has no wallet yet.
  // accounts[5] is the dangerous state: every unit reserved, nothing
  // spendable. UIs must render available 0 honestly (not as "no money").
  [accounts[5].id]: [
    {
      asset: "USDC",
      contractAddress: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
      amount: { total: 4200, available: 0, reserved: 4200 },
    },
  ],
  [accounts[4].id]: [
    {
      asset: "USDT",
      contractAddress: "0xfde4c96c8593536e31f229ea8f37b2ada2699bb2",
      amount: { total: 500, available: 500, reserved: 0 },
    },
  ],
};

export const virtualBankAccounts = [
  {
    id: "vb7e5f19-4444-4d40-ae85-000000000001",
    accountId: accounts[0].id,
    bankAccountType: "EUR_SEPA",
    name: "My EUR Deposit Account",
    status: "ACTIVE",
    currency: "EUR",
    targetCryptocurrency: "USDC",
    iban: "DE89370400440532013000",
    bic: "DEUTDEDBFRA",
    bankName: "Example Bank N.V.",
    beneficiaryName: "Acme Corporation B.V.",
    referenceCode: "REF-ABC-123",
    createdAt: "2026-06-01T09:15:00Z",
  },
  {
    id: "vb7e5f19-4444-4d40-ae85-000000000002",
    accountId: accounts[2].id,
    bankAccountType: "EUR_SEPA",
    name: "Treasury EUR Collections",
    status: "ACTIVE",
    currency: "EUR",
    targetCryptocurrency: "EURC",
    iban: "NL91ABNA0417164300",
    bic: "ABNANL2A",
    bankName: "Example Bank N.V.",
    beneficiaryName: "Acme Corporation B.V.",
    referenceCode: "REF-DEF-456",
    createdAt: "2026-06-12T14:40:00Z",
    updatedAt: "2026-06-12T14:40:00Z",
  },
  {
    id: "vb7e5f19-4444-4d40-ae85-000000000003",
    accountId: accounts[1].id,
    bankAccountType: "EUR_SEPA",
    name: "Operations EUR",
    status: "ACTIVE",
    currency: "EUR",
    targetCryptocurrency: "USDC",
    iban: "BE68539007547034",
    bic: "KREDBEBB",
    bankName: "Example Bank N.V.",
    beneficiaryName: "Acme Corporation B.V.",
    createdAt: "2026-06-14T09:00:00Z",
  },
  {
    id: "vb7e5f19-4444-4d40-ae85-000000000004",
    accountId: accounts[2].id,
    bankAccountType: "EUR_SEPA",
    status: "ACTIVE",
    currency: "EUR",
    targetCryptocurrency: "USDC",
    iban: "FR7630006000011234567890189",
    bic: "AGRIFRPP",
    bankName: "Example Bank N.V.",
    beneficiaryName: "Acme Corporation B.V.",
    referenceCode: "REF-GHI-789",
  },
  {
    id: "vb7e5f19-4444-4d40-ae85-000000000005",
    accountId: accounts[4].id,
    bankAccountType: "EUR_SEPA",
    name: "Former collections account",
    status: "CLOSED",
    currency: "EUR",
    targetCryptocurrency: "USDC",
    iban: "LU280019400644750000",
    bic: "BCEELULL",
    bankName: "Example Bank N.V.",
    beneficiaryName: "Acme Corporation B.V.",
    referenceCode: "REF-CLOSED-001",
    createdAt: "2026-05-20T11:00:00Z",
    updatedAt: "2026-07-30T16:00:00Z",
  },
  {
    accountId: accounts[2].id,
    name: "Identity unavailable",
    currency: "EUR",
  },
] satisfies schemas["VirtualBankAccountResponse"][];

export const paymentSession = {
  id: "ps9d7b28-5555-4e50-bf96-000000000001",
  accountId: accounts[0].id,
  status: "CREATED",
  inAmount: 100,
  inCurrency: "EUR",
  outCryptocurrency: "USDC",
  paymentUrl: "https://pay.venlyfinance.com/s/ps9d7b28",
  externalRef: "order-2026-0715",
  walletId: "w1f3a8c2-3333-4c30-9d74-000000000001",
  cancellable: true,
  expiresAt: "2026-08-01T00:00:00Z",
  idempotencyKey: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  createdAt: "2026-07-20T10:00:00Z",
  updatedAt: "2026-07-20T10:00:00Z",
} satisfies schemas["PayInSessionDto"];

const paymentExecution = {
  id: "pe5f6a7b-c9d0-4123-9456-000000000001",
  walletPairId: "wp6a7b8c-d0e1-4234-a567-000000000001",
  type: "AUTHORIZATION",
  chain: "BASE",
  asset: "USDC",
  amount: 25,
  exchangeRate: 1,
  status: "RESERVED",
  transactionHash: "0xa1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2",
  createdAt: "2026-07-20T10:00:00Z",
  updatedAt: "2026-07-20T10:00:02Z",
} satisfies schemas["PaymentExecutionDto"];

export const paymentRequest = {
  id: "pr3c6a47-6666-4f60-8aa7-000000000001",
  accountId: accounts[0].id,
  amount: { fiat: 25, crypto: 25 },
  originalAmount: { fiat: 25, crypto: 25 },
  currency: "USD",
  externalId: "auth-67890",
  description: "Card authorization #67890",
  status: "RESERVED",
  executions: [paymentExecution],
  createdAt: "2026-07-20T10:00:00Z",
  updatedAt: "2026-07-20T10:00:02Z",
} satisfies schemas["PaymentRequestDto"];

/** Settlement response: 202 with SETTLING and a pending SETTLEMENT execution. */
export const paymentRequestSettling = {
  ...paymentRequest,
  status: "SETTLING",
  settlementAmount: { fiat: 25, crypto: 25 },
  executions: [
    paymentExecution,
    {
      ...paymentExecution,
      id: "pe5f6a7b-c9d0-4123-9456-000000000002",
      type: "SETTLEMENT",
      status: "PENDING",
      transactionHash: undefined,
      createdAt: "2026-07-20T11:00:00Z",
      updatedAt: "2026-07-20T11:00:00Z",
    },
  ],
  updatedAt: "2026-07-20T11:00:00Z",
} satisfies schemas["PaymentRequestDto"];

/** Reversal response: 202 with REVERSING and a pending REFUND execution. */
export const paymentRequestReversing = {
  ...paymentRequest,
  status: "REVERSING",
  reversalReason: "MERCHANT_VOID",
  executions: [
    paymentExecution,
    {
      ...paymentExecution,
      id: "pe5f6a7b-c9d0-4123-9456-000000000003",
      type: "REFUND",
      status: "PENDING",
      transactionHash: undefined,
      createdAt: "2026-07-20T11:30:00Z",
      updatedAt: "2026-07-20T11:30:00Z",
    },
  ],
  updatedAt: "2026-07-20T11:30:00Z",
} satisfies schemas["PaymentRequestDto"];

/** Contract 1.3.0 idempotent-response wrapper around a mutation fixture. */
function idempotent<T extends { id?: string }>(resource: T): { createdResourceId?: string; response: T } {
  return { createdResourceId: resource.id, response: resource };
}

/**
 * Long-list batch (30 rows): a feed must exceed one screen to prove
 * count + pagination behaviour, and five rows never will. Generated
 * deterministically at module init (fixed base dates, no runtime clocks)
 * so reset() and tests stay reproducible.
 */
const transferBatch = Array.from({ length: 30 }, (_, i) => {
  const day = String((i % 28) + 1).padStart(2, "0");
  const hour = String((i * 7) % 24).padStart(2, "0");
  return {
    id: `tr5e8c66-7777-4a70-9bb8-0000000001${String(i).padStart(2, "0")}`,
    senderAccountId: i % 3 === 0 ? accounts[1].id : accounts[0].id,
    receiverAccountId: i % 3 === 0 ? accounts[0].id : accounts[1].id,
    chain: "BASE" as const,
    asset: i % 4 === 0 ? "EURC" : "USDC",
    amount: 25 + i * 13.5,
    description: `Invoice ${2600 + i}`,
    status: "COMPLETED" as const,
    createdAt: `2026-06-${day}T${hour}:15:00Z`,
  };
});

export const transfers = [
  ...transferBatch,
  {
    id: "tr5e8c66-7777-4a70-9bb8-000000000001",
    senderAccountId: accounts[0].id,
    receiverAccountId: accounts[1].id,
    chain: "BASE",
    asset: "USDC",
    amount: 1000.0,
    fiatOrigin: { amount: 1000.0, currency: "EUR" },
    description: "Supplier settlement",
    merchantReference: "PAY-2026-001234",
    status: "COMPLETED",
    transactionHash: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
    createdAt: "2026-07-18T08:30:00Z",
  },
  {
    id: "tr5e8c66-7777-4a70-9bb8-000000000002",
    senderAccountId: accounts[0].id,
    receiverAccountId: accounts[2].id,
    chain: "BASE",
    asset: "USDC",
    amount: 420.5,
    status: "PENDING",
    createdAt: "2026-07-24T16:05:00Z",
  },
  {
    id: "tr5e8c66-7777-4a70-9bb8-000000000003",
    senderAccountId: accounts[2].id,
    receiverAccountId: accounts[0].id,
    chain: "AVALANCHE",
    asset: "EURC",
    amount: 9800.0,
    status: "COMPLETED",
    createdAt: "2026-07-10T11:45:00Z",
  },
  {
    id: "tr5e8c66-7777-4a70-9bb8-000000000004",
    senderAccountId: accounts[0].id,
    receiverAccountId: accounts[1].id,
    chain: "BASE",
    asset: "USDC",
    amount: 55.25,
    status: "FAILED",
    errorMessage: "Insufficient available balance",
    createdAt: "2026-07-22T09:12:00Z",
  },
  {
    id: "tr5e8c66-7777-4a70-9bb8-000000000005",
    senderAccountId: accounts[4].id,
    receiverAccountId: accounts[2].id,
    chain: "BASE",
    asset: "USDT",
    amount: 12000.0,
    status: "COMPLETED",
    createdAt: "2026-07-01T07:00:00Z",
  },
] satisfies schemas["TransferRequestDto"][];

// ── Supported assets (contract 1.3.0) ────────────────────────────────────
// `decimals` values are each asset's REAL on-chain precision (USDC, EURC and
// USDT mint with 6 decimals on every chain below; DAI mints with 18). A
// wrong-decimals fixture teaches integrators a falsehood about how to render
// money, so these values are load-bearing – verify against the token
// contract before ever changing one.
export const supportedAssets = [
  {
    chain: "BASE",
    cryptoCurrency: "USDC",
    decimals: 6,
    contractAddress: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  },
  {
    chain: "BASE",
    cryptoCurrency: "EURC",
    decimals: 6,
    contractAddress: "0x60a3e35cc302bfa44cb288bc5a4f316fdb1adb42",
  },
  {
    chain: "BASE",
    cryptoCurrency: "USDT",
    decimals: 6,
    contractAddress: "0xfde4c96c8593536e31f229ea8f37b2ada2699bb2",
  },
  {
    chain: "ETHEREUM",
    cryptoCurrency: "USDC",
    decimals: 6,
    contractAddress: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
  },
  {
    // The one non-6-decimals row: proves consumers read `decimals` per asset
    // instead of hard-coding a constant that happens to fit stablecoins.
    chain: "ETHEREUM",
    cryptoCurrency: "DAI",
    decimals: 18,
    contractAddress: "0x6b175474e89094c44da98b954eedeac495271d0f",
  },
  {
    chain: "SOLANA",
    cryptoCurrency: "USDC",
    decimals: 6,
    contractAddress: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  },
] satisfies schemas["SupportedAssetView"][];

/**
 * Account-scoped rows add `permitStatus`. The main account is fully READY on
 * the assets it holds and ACTION_REQUIRED on one it doesn't – the state a
 * permit surface must render as "you have something to do", not hide.
 * Unseeded accounts fall back to the store's derived default (NO_WALLET /
 * PENDING by wallet presence).
 */
export const accountSupportedAssets: Record<string, schemas["AccountSupportedAssetView"][]> = {
  [accounts[0].id]: [
    { ...supportedAssets[0], permitStatus: "READY" },
    { ...supportedAssets[1], permitStatus: "READY" },
    { ...supportedAssets[2], permitStatus: "ACTION_REQUIRED" },
  ],
  [accounts[4].id]: [
    { ...supportedAssets[2], permitStatus: "READY" },
    { ...supportedAssets[0], permitStatus: "ACTIVATING" },
  ],
  // Suspended account, no wallet provisioned.
  [accounts[3].id]: [{ ...supportedAssets[0], permitStatus: "NO_WALLET" }],
};

export const permitMessages = [
  {
    supportedAssetId: "sa1b4e77-9999-4c90-bdd0-000000000001",
    asset: "USDC",
    contractAddress: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    status: "PENDING",
    typedData: {
      primaryType: "Permit",
      domain: { name: "USD Coin", version: "2", chainId: 8453 },
    },
  },
] satisfies schemas["PermitMessageDto"][];

export const permitResult = {
  id: "pe6a3f88-aaaa-4da0-cee1-000000000001",
  supportedAssetId: permitMessages[0].supportedAssetId,
  asset: "USDC",
  contractAddress: permitMessages[0].contractAddress,
  status: "SUBMITTED",
  permitTxId: "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
} satisfies schemas["PermitResultDto"];

export const allowances = [
  {
    asset: {
      name: "USDC",
      contractAddress: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
      decimals: 6,
    },
    allowance: "115792089237316195423570985008687907853269984665640564039457.584007913129639935",
    orchestrationWallet: "0x1e8a2b6c1d4f38c1ef4d1b6c1e8a29f8b2ca4df2",
  },
] satisfies schemas["AllowanceInfo"][];

// ── Payout surface seeds (contract 1.3.0) ────────────────────────────────
// Beneficiary bank accounts live on the PARTY. The org party (Acme) carries
// one ACTIVE SEPA account and one PENDING US_ACH account, so both the usable
// and the still-under-review states render.
export const payoutBankAccounts = [
  {
    id: "pb8f2a10-bbbb-4e10-9cf2-000000000001",
    partyId: parties[1].id,
    rail: "SEPA",
    fiatCurrency: "EUR",
    label: "Acme supplier account",
    accountHolderName: "Acme Corporation B.V.",
    details: { ibanLast4: "3000", bic: "DEUTDEDBFRA" },
    bankName: "Example Bank N.V.",
    status: "ACTIVE",
    createdAt: "2026-07-05T09:00:00Z",
  },
  {
    id: "pb8f2a10-bbbb-4e10-9cf2-000000000002",
    partyId: parties[1].id,
    rail: "US_ACH",
    fiatCurrency: "USD",
    label: "US contractor account",
    accountHolderName: "Acme Corporation B.V.",
    details: { accountNumberLast4: "6789", abaRoutingNumber: "021000021", accountType: "CHECKING" },
    bankName: "Example Bank USA Inc.",
    status: "PENDING",
    createdAt: "2026-08-01T14:30:00Z",
  },
] satisfies schemas["PayoutBankAccountDto"][];

// Routes bind a bank account to an ACCOUNT and a deposit asset. The payouts
// account carries one ACTIVE route (usable) and one still awaiting proof.
export const payoutRoutes = [
  {
    id: "pr9e3b21-cccc-4f20-8da3-000000000001",
    status: "ACTIVE",
    depositAsset: { chain: "BASE", name: "USDC" },
    fiatCurrency: "EUR",
    depositAddress: "0x4df2f3cbb3a2f6dc38c1ef4d1b6c1e8a29f8b2ca",
    createdAt: "2026-07-06T10:00:00Z",
    updatedAt: "2026-07-06T10:20:00Z",
  },
  {
    id: "pr9e3b21-cccc-4f20-8da3-000000000002",
    status: "AWAITING_OWNERSHIP_PROOF",
    depositAsset: { chain: "BASE", name: "USDT" },
    fiatCurrency: "EUR",
    depositAddress: "0xb3a2f6dc38c1ef4d1b6c1e8a29f8b2ca4df2f3cb",
    createdAt: "2026-08-02T08:00:00Z",
  },
] satisfies schemas["PayoutRouteDto"][];

const payoutRouteSeeds: Record<string, schemas["PayoutRouteDto"][]> = {
  [accounts[4].id]: payoutRoutes,
};

const seededBeneficiary = {
  id: payoutBankAccounts[0].id,
  partyId: payoutBankAccounts[0].partyId,
  rail: payoutBankAccounts[0].rail,
  label: payoutBankAccounts[0].label,
  accountHolderName: payoutBankAccounts[0].accountHolderName,
  bankName: payoutBankAccounts[0].bankName,
  details: payoutBankAccounts[0].details,
} satisfies schemas["PayoutBeneficiaryDto"];

// Payout history on the payouts account: the happy end, an in-flight state a
// UI must poll, and the state integrators forget – money that came BACK.
export const payouts = [
  {
    id: "po1d4c32-dddd-4a30-9eb4-000000000001",
    accountId: accounts[4].id,
    payoutRoute: {
      id: payoutRoutes[0].id,
      depositAsset: payoutRoutes[0].depositAsset,
      fiatCurrency: payoutRoutes[0].fiatCurrency,
      depositAddress: payoutRoutes[0].depositAddress,
      beneficiary: seededBeneficiary,
    },
    rail: "SEPA",
    cryptoAmount: 1500,
    settledFiatAmount: 1500,
    fundingMode: "PULL",
    status: "COMPLETED",
    sendTxHash: "0x7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2a1b2c3d4e5f6a",
    requestedAt: "2026-07-15T09:30:00Z",
    completedAt: "2026-07-15T11:02:00Z",
  },
  {
    id: "po1d4c32-dddd-4a30-9eb4-000000000002",
    accountId: accounts[4].id,
    payoutRoute: {
      id: payoutRoutes[0].id,
      depositAsset: payoutRoutes[0].depositAsset,
      fiatCurrency: payoutRoutes[0].fiatCurrency,
      depositAddress: payoutRoutes[0].depositAddress,
      beneficiary: seededBeneficiary,
    },
    rail: "SEPA",
    cryptoAmount: 820.5,
    fundingMode: "PULL",
    status: "PROVIDER_PROCESSING",
    sendTxHash: "0x9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2a1b2c3d4e5f6a7b8c",
    requestedAt: "2026-08-11T16:45:00Z",
  },
  {
    id: "po1d4c32-dddd-4a30-9eb4-000000000003",
    accountId: accounts[4].id,
    payoutRoute: {
      id: payoutRoutes[0].id,
      depositAsset: payoutRoutes[0].depositAsset,
      fiatCurrency: payoutRoutes[0].fiatCurrency,
      depositAddress: payoutRoutes[0].depositAddress,
      beneficiary: seededBeneficiary,
    },
    rail: "SEPA",
    cryptoAmount: 300,
    fundingMode: "PULL",
    status: "RETURNED",
    sendTxHash: "0x0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2a1b2c3d4e5f6a7b8c9d",
    failureReason: "Returned by the receiving bank: account closed",
    requestedAt: "2026-07-28T10:15:00Z",
  },
] satisfies schemas["PayoutDto"][];

export const financeSeeds: FinanceSeeds = {
  parties,
  accounts,
  wallets: walletSeeds,
  partyRole,
  virtualBankAccounts,
  transfers,
  payoutBankAccounts,
  payoutRoutes: payoutRouteSeeds,
  payouts,
  supportedAssets,
  accountSupportedAssets,
};

/** Route table over a stateful store: creates persist, gets read back. */
export function createFinanceRoutes(store: FinanceMockStore): RouteTable {
  return {
    // Parties
    "GET /parties": {
      kind: "handler",
      handle: (ctx) => listEnvelope(store.listParties(ctx), ctx.query),
    },
    "POST /parties": { kind: "handler", handle: (ctx) => itemEnvelope(store.createParty(ctx)) },
    "GET /parties/{partyId}": {
      kind: "handler",
      handle: (ctx) => itemEnvelope(store.getParty(ctx)),
    },
    "PATCH /parties/{partyId}": {
      kind: "handler",
      handle: (ctx) => itemEnvelope(store.updateParty(ctx)),
    },
    "DELETE /parties/{partyId}": {
      kind: "handler",
      handle: (ctx) => store.deleteParty(ctx),
    },
    // Accounts
    "GET /accounts": {
      kind: "handler",
      handle: (ctx) => listEnvelope(store.listAccounts(ctx), ctx.query),
    },
    "POST /accounts": { kind: "handler", handle: (ctx) => itemEnvelope(store.createAccount(ctx)) },
    "GET /accounts/{accountId}": {
      kind: "handler",
      handle: (ctx) => itemEnvelope(store.getAccount(ctx)),
    },
    "GET /accounts/{accountId}/party-roles": {
      kind: "handler",
      handle: (ctx) => listEnvelope(store.listPartyRoles(ctx), ctx.query),
    },
    "POST /accounts/{accountId}/party-roles": {
      kind: "handler",
      handle: (ctx) => itemEnvelope(store.addPartyRole(ctx)),
    },
    "DELETE /accounts/{accountId}/party-roles/{partyId}": {
      kind: "handler",
      handle: (ctx) => store.removePartyRole(ctx),
    },
    // Wallets (read-only in the live API: auto-provisioned with the account)
    "GET /accounts/{accountId}/wallets": {
      kind: "handler",
      handle: (ctx) => listEnvelope(store.listWallets(ctx), ctx.query),
    },
    // Virtual bank accounts
    "GET /accounts/{accountId}/virtual-bank-accounts": {
      kind: "handler",
      handle: (ctx) => listEnvelope(store.listVirtualBankAccounts(ctx), ctx.query),
    },
    "POST /accounts/{accountId}/virtual-bank-accounts": {
      kind: "handler",
      handle: (ctx) => itemEnvelope(store.createVirtualBankAccount(ctx)),
    },
    "GET /accounts/{accountId}/virtual-bank-accounts/{virtualBankAccountId}": {
      kind: "handler",
      handle: (ctx) => itemEnvelope(store.getVirtualBankAccount(ctx)),
    },
    // Payment sessions + payment requests. These stay static fixtures ("item",
    // not "create"): the request bodies carry `amount` as a plain number while
    // the responses type `amount` as {fiat, crypto} – a body echo would corrupt
    // the response shape. Their request bodies are still spec-validated.
    "POST /accounts/{accountId}/fiat-to-crypto/payment-sessions": {
     kind: "handler",
     handle: (ctx) => itemEnvelope(store.createPaymentSession(ctx)),
    },
    // Contract 1.3.0: payment-request mutations return the idempotent wrapper.
    "POST /accounts/{accountId}/payment-requests": { kind: "item", result: idempotent(paymentRequest) },
    "POST /payment-requests": { kind: "item", result: idempotent(paymentRequest) },
    "PATCH /payment-requests/{paymentRequestId}": { kind: "item", result: idempotent(paymentRequest) },
    "POST /payment-requests/{paymentRequestId}/settlements": {
      kind: "item",
      result: idempotent(paymentRequestSettling),
    },
    "POST /payment-requests/settlements": { kind: "item", result: idempotent(paymentRequestSettling) },
    "POST /payment-requests/{paymentRequestId}/reversal": {
      kind: "item",
      result: idempotent(paymentRequestReversing),
    },
    "POST /payment-requests/reversals": { kind: "item", result: idempotent(paymentRequestReversing) },
    // Transfers
    "POST /accounts/{senderAccountId}/transfers/fiat": {
      kind: "handler",
      handle: (ctx) => itemEnvelope(store.createFiatTransfer(ctx)),
    },
    "POST /accounts/{senderAccountId}/transfers/crypto": {
      kind: "handler",
      handle: (ctx) => itemEnvelope(store.createCryptoTransfer(ctx)),
    },
    "GET /accounts/{accountId}/transfers": {
      kind: "handler",
      handle: (ctx) => listEnvelope(store.listTransfers(ctx), ctx.query),
    },
    "GET /accounts/{accountId}/transfers/{transferId}": {
      kind: "handler",
      handle: (ctx) => itemEnvelope(store.getTransfer(ctx)),
    },
    // Supported assets. The wire shape is a bare array envelope – no
    // pagination – so these answer through itemEnvelope, not listEnvelope.
    "GET /supported-assets": {
      kind: "handler",
      handle: () => itemEnvelope(store.listSupportedAssets()),
    },
    "GET /accounts/{accountId}/supported-assets": {
      kind: "handler",
      handle: (ctx) => itemEnvelope(store.listAccountSupportedAssets(ctx)),
    },
    // Permits + allowances
    "GET /accounts/{accountId}/wallets/{walletId}/permits": { kind: "array", items: permitMessages },
    "POST /accounts/{accountId}/wallets/{walletId}/permits": { kind: "create", base: permitResult },
    "GET /accounts/{accountId}/wallets/{walletId}/allowances": { kind: "array", items: allowances },
    // Payout surface (contract 1.3.0)
    "GET /parties/{partyId}/payout-bank-accounts": {
      kind: "handler",
      handle: (ctx) => listEnvelope(store.listPayoutBankAccounts(ctx), ctx.query),
    },
    "POST /parties/{partyId}/payout-bank-accounts": {
      kind: "handler",
      handle: (ctx) => itemEnvelope(store.registerPayoutBankAccount(ctx)),
    },
    "GET /parties/{partyId}/payout-bank-accounts/{id}": {
      kind: "handler",
      handle: (ctx) => itemEnvelope(store.getPayoutBankAccount(ctx)),
    },
    "GET /accounts/{accountId}/payout-routes": {
      kind: "handler",
      handle: (ctx) => listEnvelope(store.listPayoutRoutes(ctx), ctx.query),
    },
    "POST /accounts/{accountId}/payout-routes": {
      kind: "handler",
      handle: (ctx) => itemEnvelope(store.createPayoutRoute(ctx)),
    },
    "POST /accounts/{accountId}/payout-routes/{routeId}/ownership-proof/prepare": {
      kind: "handler",
      handle: (ctx) => itemEnvelope(store.preparePayoutOwnershipProof(ctx)),
    },
    "POST /accounts/{accountId}/payout-routes/{routeId}/ownership-proof/complete": {
      kind: "handler",
      handle: (ctx) => itemEnvelope(store.completePayoutOwnershipProof(ctx)),
    },
    "GET /accounts/{accountId}/payouts": {
      kind: "handler",
      handle: (ctx) => listEnvelope(store.listPayouts(ctx), ctx.query),
    },
    "POST /accounts/{accountId}/payouts": {
      kind: "handler",
      handle: (ctx) => itemEnvelope(store.requestPayout(ctx)),
    },
    "GET /accounts/{accountId}/payouts/{payoutId}": {
      kind: "handler",
      handle: (ctx) => itemEnvelope(store.getPayout(ctx)),
    },
  };
}

/** Finance mock controls: base controls plus lifecycle advancement. */
export interface VenlyFinanceMock extends VenlyMock {
  /**
   * Complete (or reject) the verification that `create` started: sets
   * `kycStatus` on individuals/accounts, `kybStatus` on organisations.
   * Default target: "VERIFIED".
   */
  advanceVerification(id: string, status?: VerificationStatusInput): void;
  /**
   * Move a PENDING transfer to "COMPLETED" (sets a transactionHash) or
   * "FAILED" (sets an errorMessage), so status polling can be exercised.
   */
  advanceTransfer(id: string, status?: "COMPLETED" | "FAILED"): void;
  /** Walk a payment session to any documented status, so pay-in can complete. */
  advancePaymentSession(
    id: string,
    to: NonNullable<schemas["PayInSessionDto"]["status"]>,
  ): schemas["PayInSessionDto"];
  /** Mock-only: simulate an inbound bank credit arriving on a VBA (not real API surface). */
  simulateInboundCredit(vbaId: string, amount: number, referenceCode?: string | null): MockInboundCredit;
  /** Mock-only: list inbound credits, optionally filtered by VBA and newest first. */
  listInboundCredits(vbaId?: string): MockInboundCredit[];
  /** Walk a payout to any documented status (COMPLETED stamps settlement fields). */
  advancePayout(
    id: string,
    to: NonNullable<schemas["PayoutDto"]["status"]>,
    opts?: { settledFiatAmount?: number; failureReason?: string; sendTxHash?: string },
  ): schemas["PayoutDto"];
  /** Activate or disable a beneficiary bank account (operator action). */
  advancePayoutBankAccount(
    id: string,
    to?: NonNullable<schemas["PayoutBankAccountDto"]["status"]>,
  ): schemas["PayoutBankAccountDto"];
  /** Walk a payout route to any documented status. */
  advancePayoutRoute(
    id: string,
    to: NonNullable<schemas["PayoutRouteDto"]["status"]>,
  ): schemas["PayoutRouteDto"];
  /** Restore the seed fixtures and clear the call log. */
  reset(): void;
}

/** Stateful finance mock transport wired to a fresh store per client. */
export class FinanceMockTransport extends MockTransport implements VenlyFinanceMock {
  private readonly store: FinanceMockStore;

  constructor() {
    const store = new FinanceMockStore(financeSeeds);
    super(createFinanceRoutes(store), errorPresets, financeRequestShapes);
    this.store = store;
  }

  advanceVerification(id: string, status?: VerificationStatusInput): void {
    this.store.advanceVerification(id, status);
  }

  advanceTransfer(id: string, status?: "COMPLETED" | "FAILED"): void {
    this.store.advanceTransfer(id, status);
  }
  advancePaymentSession(
    id: string,
    to: NonNullable<schemas["PayInSessionDto"]["status"]>,
  ): schemas["PayInSessionDto"] {
    return this.store.advancePaymentSession(id, to);
  }

  simulateInboundCredit(vbaId: string, amount: number, referenceCode?: string | null): MockInboundCredit {
    return this.store.simulateInboundCredit(vbaId, amount, referenceCode);
  }

  listInboundCredits(vbaId?: string): MockInboundCredit[] {
    return this.store.listInboundCredits(vbaId);
  }

  advancePayout(
    id: string,
    to: NonNullable<schemas["PayoutDto"]["status"]>,
    opts?: { settledFiatAmount?: number; failureReason?: string; sendTxHash?: string },
  ): schemas["PayoutDto"] {
    return this.store.advancePayout(id, to, opts);
  }

  advancePayoutBankAccount(
    id: string,
    to: NonNullable<schemas["PayoutBankAccountDto"]["status"]> = "ACTIVE",
  ): schemas["PayoutBankAccountDto"] {
    return this.store.advancePayoutBankAccount(id, to);
  }

  advancePayoutRoute(
    id: string,
    to: NonNullable<schemas["PayoutRouteDto"]["status"]>,
  ): schemas["PayoutRouteDto"] {
    return this.store.advancePayoutRoute(id, to);
  }

  reset(): void {
    this.store.reset();
    this.clear();
  }
}

/** @deprecated Construct `FinanceMockTransport` instead; kept for 0.1.x compatibility. */
export const financeRoutes: RouteTable = createFinanceRoutes(new FinanceMockStore(financeSeeds));
