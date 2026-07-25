import type { components } from "../generated/finance.js";
import type { RouteTable } from "./transport.js";

type schemas = components["schemas"];

/**
 * Finance API fixtures for `environment: "mock"`. Every entity `satisfies`
 * the generated OpenAPI schema type, so a spec regeneration that changes a
 * shape breaks this file at compile time instead of teaching wrong shapes.
 * Seed lineage: the specs' request examples + the settlement-mcp mock corpus.
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
    name: "Acme — Main EUR",
    kycStatus: "VERIFIED",
    status: "ACTIVE",
    createdAt: "2026-05-02T10:00:00Z",
    version: 0,
  },
  {
    id: "a10c2d31-2222-4b20-8c63-000000000002",
    externalId: "acct-ops-usd",
    name: "Acme — Ops USD",
    kycStatus: "VERIFIED",
    status: "ACTIVE",
    createdAt: "2026-05-02T10:05:00Z",
    version: 0,
  },
  {
    id: "a10c2d31-2222-4b20-8c63-000000000003",
    externalId: "acct-treasury",
    name: "Acme — Treasury",
    kycStatus: "VERIFIED",
    status: "ACTIVE",
    createdAt: "2026-05-10T08:30:00Z",
    version: 0,
  },
  {
    id: "a10c2d31-2222-4b20-8c63-000000000004",
    externalId: "acct-suspended",
    name: "Borealis — Frozen",
    kycStatus: "VERIFICATION_PENDING",
    status: "SUSPENDED",
    createdAt: "2026-06-01T12:00:00Z",
    version: 2,
  },
  {
    id: "a10c2d31-2222-4b20-8c63-000000000005",
    externalId: "acct-payouts",
    name: "Acme — Payouts",
    kycStatus: "VERIFIED",
    status: "ACTIVE",
    createdAt: "2026-06-15T09:45:00Z",
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

export const transfers = [
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
    chain: "BASE",
    asset: "USDC",
    amount: 420.5,
    status: "PENDING",
    createdAt: "2026-07-24T16:05:00Z",
  },
  {
    id: "tr5e8c66-7777-4a70-9bb8-000000000003",
    senderAccountId: accounts[2].id,
    chain: "AVALANCHE",
    asset: "EURC",
    amount: 9800.0,
    status: "COMPLETED",
    createdAt: "2026-07-10T11:45:00Z",
  },
  {
    id: "tr5e8c66-7777-4a70-9bb8-000000000004",
    senderAccountId: accounts[0].id,
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

export const financeRoutes: RouteTable = {
  // Parties
  "GET /parties": { kind: "list", items: parties },
  "POST /parties": { kind: "create", base: parties[0] },
  "GET /parties/{partyId}": { kind: "item", result: parties[0] },
  "PATCH /parties/{partyId}": { kind: "update", base: parties[0] },
  "DELETE /parties/{partyId}": { kind: "none" },
  // Accounts
  "GET /accounts": { kind: "list", items: accounts },
  "POST /accounts": { kind: "create", base: accounts[0] },
  "GET /accounts/{accountId}": { kind: "item", result: accounts[0] },
  "GET /accounts/{accountId}/party-roles": { kind: "list", items: [partyRole] },
  "POST /accounts/{accountId}/party-roles": { kind: "create", base: partyRole },
  "DELETE /accounts/{accountId}/party-roles/{partyId}": { kind: "none" },
  // Wallets (read-only in the live API: auto-provisioned with the account)
  "GET /accounts/{accountId}/wallets": { kind: "list", items: [wallet] },
  // Virtual bank accounts
  "GET /accounts/{accountId}/virtual-bank-accounts": { kind: "list", items: virtualBankAccounts },
  "POST /accounts/{accountId}/virtual-bank-accounts": {
    kind: "create",
    base: virtualBankAccounts[0],
  },
  "GET /accounts/{accountId}/virtual-bank-accounts/{virtualBankAccountId}": {
    kind: "item",
    result: virtualBankAccounts[0],
  },
  // Payment sessions + payment requests. All of these use kind "item", not
  // "create": the request bodies carry `amount` as a plain number (and fields
  // like callbackUrl) while the responses type `amount` as {fiat, crypto} —
  // a body echo would corrupt the response shape.
  "POST /accounts/{accountId}/fiat-to-crypto/payment-sessions": {
    kind: "item",
    result: paymentSession,
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
  "POST /accounts/{senderAccountId}/transfers/fiat": { kind: "create", base: transfers[0] },
  "POST /accounts/{senderAccountId}/transfers/crypto": { kind: "create", base: transfers[0] },
  "GET /accounts/{accountId}/transfers": { kind: "list", items: transfers },
  "GET /accounts/{accountId}/transfers/{transferId}": { kind: "item", result: transfers[0] },
  // Permits + allowances
  "GET /accounts/{accountId}/wallets/{walletId}/permits": { kind: "array", items: permitMessages },
  "POST /accounts/{accountId}/wallets/{walletId}/permits": { kind: "create", base: permitResult },
  "GET /accounts/{accountId}/wallets/{walletId}/allowances": { kind: "array", items: allowances },
};
