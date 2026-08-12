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
} satisfies schemas["Address"];

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
] satisfies schemas["Party"][];

export const partyRole = {
  partyId: parties[0].id,
  roleType: "ACCOUNT_HOLDER",
  status: "ACTIVE",
} satisfies schemas["PartyRole"];

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
] satisfies schemas["Account"][];

export const wallet = {
  id: "w1f3a8c2-3333-4c30-9d74-000000000001",
  chain: "BASE",
  type: "VENLY_MANAGED",
  address: "0x9f8b2ca4df2f3cbb3a2f6dc38c1ef4d1b6c1e8a2",
  amlStatus: "APPROVED",
  balances: [
    {
      asset: "USDC",
      contractAddress: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
      amount: { total: "15230.500000", available: "15100.500000", reserved: "130.000000" },
    },
    {
      asset: "EURC",
      contractAddress: "0x60a3e35cc302bfa44cb288bc5a4f316fdb1adb42",
      amount: { total: "8020.000000", available: "8020.000000", reserved: "0.000000" },
    },
  ],
} satisfies schemas["Wallet"];

/** Each seeded account has its own wallet – no cross-account leakage. */
const walletSeeds: Record<string, schemas["Wallet"][]> = {
  [accounts[0].id]: [wallet],
  [accounts[1].id]: [
    {
      id: "w1f3a8c2-3333-4c30-9d74-000000000002",
      chain: "BASE",
      type: "VENLY_MANAGED",
      address: "0x1b6c1e8a29f8b2ca4df2f3cbb3a2f6dc38c1ef4d",
      amlStatus: "APPROVED",
      balances: [
        {
          asset: "USDC",
          contractAddress: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
          amount: { total: "2500.000000", available: "2500.000000", reserved: "0.000000" },
        },
      ],
    },
  ],
  [accounts[2].id]: [
    {
      id: "w1f3a8c2-3333-4c30-9d74-000000000003",
      chain: "AVALANCHE",
      type: "VENLY_MANAGED",
      address: "0x2f6dc38c1ef4d1b6c1e8a29f8b2ca4df2f3cbb3a",
      amlStatus: "APPROVED",
      balances: [
        {
          asset: "EURC",
          contractAddress: "0x60a3e35cc302bfa44cb288bc5a4f316fdb1adb42",
          amount: { total: "12000.000000", available: "12000.000000", reserved: "0.000000" },
        },
      ],
    },
  ],
  // accounts[3] (suspended) has no wallet yet.
  // accounts[5] is the dangerous state: every unit reserved, nothing
  // spendable. UIs must render available 0 honestly (not as "no money").
  [accounts[5].id]: [
    {
      id: "w1f3a8c2-3333-4c30-9d74-000000000006",
      chain: "BASE",
      type: "VENLY_MANAGED",
      address: "0xef4d1b6c1e8a29f8b2ca4df2f3cbb3a2f6dc38c1",
      amlStatus: "APPROVED",
      balances: [
        {
          asset: "USDC",
          contractAddress: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
          amount: { total: "4200.000000", available: "0.000000", reserved: "4200.000000" },
        },
      ],
    },
  ],
  [accounts[4].id]: [
    {
      id: "w1f3a8c2-3333-4c30-9d74-000000000005",
      chain: "BASE",
      type: "VENLY_MANAGED",
      address: "0x38c1ef4d1b6c1e8a29f8b2ca4df2f3cbb3a2f6dc",
      amlStatus: "APPROVED",
      balances: [
        {
          asset: "USDT",
          contractAddress: "0xfde4c96c8593536e31f229ea8f37b2ada2699bb2",
          amount: { total: "500.000000", available: "500.000000", reserved: "0.000000" },
        },
      ],
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
] satisfies schemas["VirtualBankAccount"][];

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
} satisfies schemas["PaymentSession"];

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
} satisfies schemas["PaymentExecution"];

export const paymentRequest = {
  id: "pr3c6a47-6666-4f60-8aa7-000000000001",
  accountId: accounts[0].id,
  amount: { fiat: 25, crypto: "25.000000" },
  originalAmount: { fiat: 25, crypto: "25.000000" },
  currency: "USD",
  externalId: "auth-67890",
  description: "Card authorization #67890",
  status: "RESERVED",
  executions: [paymentExecution],
  createdAt: "2026-07-20T10:00:00Z",
  updatedAt: "2026-07-20T10:00:02Z",
} satisfies schemas["PaymentRequest"];

/** Settlement response: 202 with SETTLING and a pending SETTLEMENT execution. */
export const paymentRequestSettling = {
  ...paymentRequest,
  status: "SETTLING",
  settlementAmount: { fiat: 25, crypto: "25.000000" },
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
} satisfies schemas["PaymentRequest"];

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
} satisfies schemas["PaymentRequest"];

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
] satisfies schemas["Transfer"][];

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
] satisfies schemas["PermitMessage"][];

export const permitResult = {
  id: "pe6a3f88-aaaa-4da0-cee1-000000000001",
  supportedAssetId: permitMessages[0].supportedAssetId,
  asset: "USDC",
  contractAddress: permitMessages[0].contractAddress,
  status: "SUBMITTED",
  permitTxId: "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
} satisfies schemas["PermitResult"];

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
] satisfies schemas["Allowance"][];

export const financeSeeds: FinanceSeeds = {
  parties,
  accounts,
  wallets: walletSeeds,
  partyRole,
  virtualBankAccounts,
  transfers,
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
    "POST /accounts/{accountId}/payment-requests": { kind: "item", result: paymentRequest },
    "POST /payment-requests": { kind: "item", result: paymentRequest },
    "PATCH /payment-requests/{paymentRequestId}": { kind: "item", result: paymentRequest },
    "POST /payment-requests/{paymentRequestId}/settlements": {
      kind: "item",
      result: paymentRequestSettling,
    },
    "POST /payment-requests/settlements": { kind: "item", result: paymentRequestSettling },
    "POST /payment-requests/{paymentRequestId}/reversal": {
      kind: "item",
      result: paymentRequestReversing,
    },
    "POST /payment-requests/reversals": { kind: "item", result: paymentRequestReversing },
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
    // Permits + allowances
    "GET /accounts/{accountId}/wallets/{walletId}/permits": { kind: "array", items: permitMessages },
    "POST /accounts/{accountId}/wallets/{walletId}/permits": { kind: "create", base: permitResult },
    "GET /accounts/{accountId}/wallets/{walletId}/allowances": { kind: "array", items: allowances },
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
    to: schemas["PaymentSessionStatus"],
  ): schemas["PaymentSession"];
  /** Mock-only: simulate an inbound bank credit arriving on a VBA (not real API surface). */
  simulateInboundCredit(vbaId: string, amount: number, referenceCode?: string | null): MockInboundCredit;
  /** Mock-only: list inbound credits, optionally filtered by VBA and newest first. */
  listInboundCredits(vbaId?: string): MockInboundCredit[];
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
    to: schemas["PaymentSessionStatus"],
  ): schemas["PaymentSession"] {
    return this.store.advancePaymentSession(id, to);
  }

  simulateInboundCredit(vbaId: string, amount: number, referenceCode?: string | null): MockInboundCredit {
    return this.store.simulateInboundCredit(vbaId, amount, referenceCode);
  }

  listInboundCredits(vbaId?: string): MockInboundCredit[] {
    return this.store.listInboundCredits(vbaId);
  }

  reset(): void {
    this.store.reset();
    this.clear();
  }
}

/** @deprecated Construct `FinanceMockTransport` instead; kept for 0.1.x compatibility. */
export const financeRoutes: RouteTable = createFinanceRoutes(new FinanceMockStore(financeSeeds));
