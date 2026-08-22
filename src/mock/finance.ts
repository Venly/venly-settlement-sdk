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
import {
  FinanceMockStore,
  type FinanceSeeds,
  type VerificationStatusInput,
  type MockInboundCredit,
  type MockPayoutManagementTwin,
  type MockPayoutRow,
} from "./store.js";
import {
  broadcastChannel,
  memoryChannel,
  type MockChannelMessage,
  type MockStateChannel,
} from "./channel.js";
import {
  EventLog,
  deterministicClock,
  systemClock,
  type MockClock,
  type MockEvent,
  type MockIdSource,
} from "./runtime.js";
import type { RequestOptions } from "../core/http.js";
import type { LedgerSnapshot } from "./ledger.js";
import type { SeedProfile } from "./seed-profiles.js";

/** Options for a mock transport. Every default preserves today's behaviour. */
export interface FinanceMockOptions {
  /** Contexts sharing a sessionId and a channel share one world. */
  sessionId?: string;
  channel?: "memory" | "broadcast" | MockStateChannel;
  /** Fixed clock + counter ids, so a scripted run replays deep-equal. */
  deterministic?: boolean;
  clock?: MockClock;
  ids?: MockIdSource;
  eventBufferSize?: number;
  onHandlerError?: (error: unknown) => void;
}

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
// read surface (wallet identity is unobtainable while
// the permit endpoints still key on {walletId}).
export const wallet = [
  {
    asset: "USDC",
    contractAddress: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    // reserved backs transfers[31], the seeded PENDING 420.5 USDC send. It is
    // not a round 130 because a reserve with no hold behind it is money the
    // fixtures cannot account for. `available` is
    // untouched: that is the number a UI renders as spendable.
    amount: { total: 15521.0, available: 15100.5, reserved: 420.5 },
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
      // The payouts account funds USDC payout routes, so it has to hold USDC.
      // Without this row every payout on the seeded route fails for want of
      // funds - the routes deposit USDC while the wallet held only USDT, a
      // mismatch that was invisible while payouts moved no money at all.
      asset: "USDC",
      contractAddress: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
      amount: { total: 6000, available: 6000, reserved: 0 },
    },
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
    // The hold behind acct-escrow's fully-reserved wallet: every unit of its
    // 4200 USDC is committed to this send, which is why `available` is 0 and
    // why a UI that renders `total` as spendable is lying.
    id: "tr5e8c66-7777-4a70-9bb8-000000000006",
    senderAccountId: accounts[5].id,
    receiverAccountId: accounts[1].id,
    chain: "BASE",
    asset: "USDC",
    amount: 4200.0,
    description: "Escrow release",
    status: "PENDING",
    createdAt: "2026-08-14T09:20:00Z",
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
    // 1500 USDC × 0.92 EUR (the seeded rate): the settled fiat side must
    // never coincide numerically with the crypto side.
    settledFiatAmount: 1380,
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
    "GET /parties/{partyId}/iv-verification": {
      kind: "handler",
      handle: (ctx) => itemEnvelope(store.getIvVerification(ctx)),
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
  /**
   * Mock-only drivers, separated from the transport controls above. Present
   * only on a mock transport: a credential-configured client has no `mock`
   * object at all, so there is nothing to reach this through.
   */
  simulations: VenlyFinanceSimulations;
}

export interface ChannelInfo {
  adapter: "memory" | "broadcast" | "custom";
  sessionId: string;
  originId: string;
  origin?: string;
  peers: number;
  epoch: number;
  revision: number;
}

/**
 * Drivers that change the simulated world: advance a verification, land an
 * inbound payment, walk a payout to its next status, load a seed profile.
 *
 * Separate from the transport controls (`failNext`, `respondNext`, `calls`,
 * `clear`), which change how the mock TRANSPORT behaves rather than what
 * happens in the world it simulates.
 */
export interface VenlyFinanceSimulations {
  reset(): void;
  /**
   * Load a profile over the seeds and check every balance rule.
   *
   * Each top-level key in `profile.seeds` REPLACES the seeded one wholesale
   * rather than merging, so a profile supplying `wallets` must also supply the
   * `transfers` and `payouts` that reserve against them — otherwise those
   * reserves have nothing behind them and the profile is refused.
   */
  seed(profile: SeedProfile): void;
  channelInfo(): ChannelInfo;
  events: {
    subscribe(handler: (e: MockEvent) => void, opts?: { since?: string }): () => void;
    list(opts?: { since?: string; accountId?: string }): MockEvent[];
  };
  ledger: {
    snapshot(): LedgerSnapshot;
    /**
     * Throws `MockLedgerError` if any balance stops adding up: total not equal
     * to available + reserved, a negative amount, or money reserved with no
     * pending operation behind it. To check that the system-wide total only
     * moved on money entering or leaving, compare two `snapshot()` calls.
     */
    verify(): void;
  };
  inbound: {
    credit(vbaId: string, amount: number, referenceCode?: string | null): MockInboundCredit;
    list(vbaId?: string): MockInboundCredit[];
  };
  verification: {
    advance(id: string, status?: VerificationStatusInput): void;
    advanceIv(
      partyId: string,
      status: NonNullable<schemas["PartyIvVerificationDto"]["status"]>,
    ): schemas["PartyIvVerificationDto"];
  };
  /**
   * Account-level drivers. `setStatus` writes a field NO contract operation
   * writes on either plane - it exists so the frozen state is demonstrable
   * while the real write op stays an open ask. A surface rendering it must
   * badge it as a driver, never as a contract operation.
   */
  account: {
    setStatus(
      accountId: string,
      status: NonNullable<schemas["AccountListItemDto"]["status"]>,
    ): schemas["AccountListItemDto"];
  };
  /** Party-level drivers. Same driver-not-contract-op rule as accounts. */
  party: {
    setStatus(
      partyId: string,
      status: NonNullable<schemas["PartyDto"]["status"]>,
    ): schemas["PartyDto"];
  };
  transfer: { advance(id: string, status?: "COMPLETED" | "FAILED"): void };
  paymentSession: {
    advance(id: string, to: NonNullable<schemas["PayInSessionDto"]["status"]>): schemas["PayInSessionDto"];
  };
  payout: {
    /**
     * Walk a payout to any documented status. Beyond the lifecycle opts, the
     * driver accepts the management-ceremony fields the finance plane cannot
     * carry (`note`, `fiatReference`, `dakotaOfframpTxId` on confirm;
     * `providerReference` on return) and `reconciliationState` - computed by
     * the management plane in production, so the mock stores only what a
     * driver asserts and never defaults it.
     */
    advance(
      id: string,
      to: NonNullable<schemas["PayoutDto"]["status"]>,
      opts?: {
        settledFiatAmount?: number;
        failureReason?: string;
        sendTxHash?: string;
        note?: string;
        fiatReference?: string;
        dakotaOfframpTxId?: string;
        providerReference?: string;
        reconciliationState?: MockPayoutManagementTwin["reconciliationState"];
      },
    ): MockPayoutRow;
    /**
     * Mock-only read: payout rows WITH their management twin, for surfaces
     * that render the reconciliation axis. The finance routes never serve
     * these fields; this is the honest place to read them in a demo.
     */
    list(accountId?: string): MockPayoutRow[];
  };
  payoutRoute: {
    advance(id: string, to: NonNullable<schemas["PayoutRouteDto"]["status"]>): schemas["PayoutRouteDto"];
  };
  payoutBankAccount: {
    advance(
      id: string,
      to?: NonNullable<schemas["PayoutBankAccountDto"]["status"]>,
    ): schemas["PayoutBankAccountDto"];
  };
}

function createSimulations(transport: FinanceMockTransport): VenlyFinanceSimulations {
  const store = () => transport.$store;
  // Every driver replicates what it changed, the same way the request path
  // does, so a console driving the mock is visible in the consumer tab.
  const driven = <T>(run: () => T): T => {
    const cursor = store().events.list().at(-1)?.id;
    const result = run();
    transport.$afterDriver(cursor);
    return result;
  };
  return {
    reset: () => transport.reset(),
    seed: (profile) =>
      driven(() => {
        store().applyProfile(profile.seeds);
        // Transitions that must be driven rather than seeded, so states which
        // carry a decision also carry its event.
        profile.after?.(transport.simulations);
      }),
    channelInfo: () => transport.$channelInfo(),
    events: {
      subscribe: (handler, opts) => store().events.subscribe(handler, opts),
      list: (opts) => store().events.list(opts),
    },
    ledger: {
      snapshot: () => store().ledger.snapshot(),
      verify: () => store().ledger.verify(),
    },
    inbound: {
      credit: (vbaId, amount, referenceCode) =>
        driven(() => store().simulateInboundCredit(vbaId, amount, referenceCode)),
      list: (vbaId) => store().listInboundCredits(vbaId),
    },
    verification: {
      advance: (id, status) => driven(() => store().advanceVerification(id, status)),
      advanceIv: (partyId, status) => driven(() => store().advanceIvVerification(partyId, status)),
    },
    account: {
      setStatus: (accountId, status) => driven(() => store().setAccountStatus(accountId, status)),
    },
    party: {
      setStatus: (partyId, status) => driven(() => store().setPartyStatus(partyId, status)),
    },
    transfer: { advance: (id, status) => driven(() => store().advanceTransfer(id, status)) },
    paymentSession: { advance: (id, to) => driven(() => store().advancePaymentSession(id, to)) },
    payout: {
      advance: (id, to, opts) => driven(() => store().advancePayout(id, to, opts)),
      list: (accountId) => store().listMockPayouts(accountId),
    },
    payoutRoute: { advance: (id, to) => driven(() => store().advancePayoutRoute(id, to)) },
    payoutBankAccount: {
      advance: (id, to) => driven(() => store().advancePayoutBankAccount(id, to)),
    },
  };
}

/** Stateful finance mock transport wired to a fresh store per client. */
export class FinanceMockTransport extends MockTransport implements VenlyFinanceMock {
  private readonly store: FinanceMockStore;
  private readonly channel: MockStateChannel;
  private readonly sessionId: string;
  private revision = 0;
  /** Highest (revision, originId) this replica has adopted or produced. */
  private highWater = { epoch: 0, revision: 0, originId: "" };
  readonly simulations: VenlyFinanceSimulations;

  constructor(options: FinanceMockOptions = {}) {
    const merged = { ...defaultMockOptions, ...options };
    const sessionId = merged.sessionId ?? "default";
    const channel =
      typeof merged.channel === "object"
        ? merged.channel
        : merged.channel === "broadcast"
          ? broadcastChannel(sessionId)
          : memoryChannel();
    const clock =
      merged.clock ?? (merged.deterministic ? deterministicClock() : systemClock);
    const events = new EventLog(
      channel.originId,
      () => clock,
      merged.eventBufferSize ?? 500,
      merged.onHandlerError ?? (() => {}),
    );
    const store = new FinanceMockStore(financeSeeds, {
      deterministic: merged.deterministic,
      clock,
      ids: merged.ids,
      events,
    });
    super(createFinanceRoutes(store), errorPresets, financeRequestShapes);
    this.store = store;
    this.channel = channel;
    this.sessionId = sessionId;
    this.highWater = { epoch: 0, revision: 0, originId: channel.originId };
    this.simulations = createSimulations(this);
    transportsConstructed += 1;

    channel.subscribe((message) => this.receive(message));
    if (channel.adapter !== "memory") channel.post({ kind: "hello", originId: channel.originId });
  }

  /**
   * Every mutating call replicates itself once it has succeeded. Hooking the
   * request path rather than each handler means a new route cannot forget to.
   */
  override async request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
    const before = this.store.events.list().at(-1)?.id;
    const result = await super.request<T>(method, path, options);
    if (method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE") {
      this.broadcast(this.newEventsSince(before));
    }
    return result;
  }

  /** Events this replica minted during the call that just completed. */
  private newEventsSince(cursor: string | undefined): MockEvent[] {
    return cursor === undefined ? this.store.events.list() : this.store.events.list({ since: cursor });
  }

  /** Replicate after a simulation driver mutated the world. */
  $afterDriver(cursor: string | undefined): void {
    this.broadcast(this.newEventsSince(cursor));
  }

  /** Internal: the store, for the simulations namespace. */
  get $store(): FinanceMockStore {
    return this.store;
  }

  get $channel(): MockStateChannel {
    return this.channel;
  }

  $channelInfo(): ChannelInfo {
    return {
      adapter: this.channel.adapter,
      sessionId: this.sessionId,
      originId: this.channel.originId,
      origin: globalThis.location?.origin,
      peers: this.channel.peers(),
      epoch: this.store.events.epoch,
      revision: this.revision,
    };
  }

  private broadcast(events: MockEvent[] = []): void {
    if (this.channel.adapter === "memory") return;
    this.revision += 1;
    this.highWater = {
      epoch: this.store.events.epoch,
      revision: this.revision,
      originId: this.channel.originId,
    };
    this.channel.post({
      kind: "snapshot",
      epoch: this.store.events.epoch,
      revision: this.revision,
      originId: this.channel.originId,
      state: this.store.snapshotState(),
      events,
    });
  }

  private receive(message: MockChannelMessage): void {
    if (message.kind === "hello") {
      // Answer with state only. A `hello` answer never replays a tail, which
      // is why a late joiner gets store.resync rather than history it missed.
      if (this.revision > 0) this.broadcast();
      return;
    }
    const mine = this.highWater;
    const theirs = { epoch: message.epoch, revision: message.revision, originId: message.originId };
    // The full triple, in order. A peer that reset has a higher epoch and may
    // legitimately carry a LOWER revision, so comparing revision alone would
    // reject the reset and leave this replica holding a world that no longer
    // exists.
    const newer =
      theirs.epoch > mine.epoch ||
      (theirs.epoch === mine.epoch &&
        (theirs.revision > mine.revision ||
          (theirs.revision === mine.revision && theirs.originId > mine.originId)));
    if (!newer) return;
    this.store.restoreState(message.state);
    this.revision = message.revision;
    this.highWater = theirs;
    // Adopt the peer's epoch before ingesting, so this replica's own sequence
    // restarts at 1 for the new (originId, epoch) pair as the contract says.
    if (message.epoch !== this.store.events.epoch) this.store.events.rollEpoch(message.epoch);
    for (const event of message.events) this.store.events.ingest(event);
    // The view was replaced wholesale, including state whose events this
    // replica already delivered. Say so rather than let a subscriber diverge.
    this.store.events.resync(`adopted revision ${message.revision} from ${message.originId}`);
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
    this.broadcast();
  }
}

/** Module-level defaults for transports the caller cannot pass options to. */
let defaultMockOptions: FinanceMockOptions = {};
/** Counted so late configuration can warn instead of failing silently. */
let transportsConstructed = 0;

/**
 * Set the options a later `new FinanceMockTransport()` uses when given none.
 * This exists because `new VenlyFinanceClient({ environment: "mock" })`
 * constructs the transport with no arguments, so a browser app that only
 * reaches the client constructor has no other way to ask for a shared channel.
 *
 * Two hazards, both real:
 *  - ORDER: call it before constructing any client, or that client keeps the
 *    defaults in force at its own construction time.
 *  - MODULE IDENTITY: the package ships dual ESM/CJS builds and
 *    `@venlyfinance/react` is a separate package, so a bundler resolving two
 *    module instances gives you two of these objects and one client silently
 *    falls back to `memory`. `simulations.channelInfo()` is how you catch it -
 *    check `adapter` and `peers` rather than assuming the call took.
 */
export function configureFinanceMockDefaults(options: FinanceMockOptions): void {
  if (transportsConstructed > 0 && typeof console !== "undefined") {
    console.warn(
      `[venly mock] configureFinanceMockDefaults() was called after ${transportsConstructed} ` +
        `mock client(s) had already been created. Those clients keep the settings that were in ` +
        `force when they were built, so they will not share state with clients created from ` +
        `now on. Call this once at startup, before creating any client, and check ` +
        `client.mock.simulations.channelInfo() to confirm what a given client actually joined.`,
    );
  }
  defaultMockOptions = { ...options };
}

/** Clear the module-level defaults (mostly for tests). */
export function resetFinanceMockDefaults(): void {
  defaultMockOptions = {};
  transportsConstructed = 0;
}

/** @deprecated Construct `FinanceMockTransport` instead; kept for 0.1.x compatibility. */
export const financeRoutes: RouteTable = createFinanceRoutes(new FinanceMockStore(financeSeeds));
