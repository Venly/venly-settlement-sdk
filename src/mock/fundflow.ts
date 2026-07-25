import type { components } from "../generated/fundflow.js";
import type { RouteTable } from "./transport.js";

type schemas = components["schemas"];

/**
 * Fundflow API fixtures for `environment: "mock"`. Same contract as the
 * finance fixtures: every entity `satisfies` its generated schema type.
 * The ramp-request corpus mirrors the settlement-mcp mock data (four-eyes
 * approval states, optimistic-locking versions, referenceCode payments).
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

export const rampRequestListItems = [
  {
    id: "123e4567-e89b-12d3-a456-426614174000",
    paymentReference: "PAY-2024-001234",
    rampType: "ON_RAMP",
    status: "AWAITING_APPROVAL",
    fiatAmount: 1000.0,
    fiatCurrency: "EUR",
    cryptoAmount: 990.0,
    cryptoCurrency: "USDC",
    createdAt: "2026-07-24T09:00:00Z",
    createdBy: "manager@acme.eu",
  },
  {
    id: "123e4567-e89b-12d3-a456-426614174001",
    paymentReference: "PAY-2024-001235",
    rampType: "ON_RAMP",
    status: "AWAITING_FUNDS",
    fiatAmount: 5000.0,
    fiatCurrency: "EUR",
    cryptoAmount: 4950.0,
    cryptoCurrency: "USDC",
    createdAt: "2026-07-23T15:20:00Z",
    createdBy: "ops@acme.eu",
  },
  {
    id: "123e4567-e89b-12d3-a456-426614174002",
    paymentReference: "PAY-2024-001236",
    rampType: "OFF_RAMP",
    status: "SUCCEEDED",
    fiatAmount: 2500.0,
    fiatCurrency: "USD",
    cryptoAmount: 2502.5,
    cryptoCurrency: "USDC",
    createdAt: "2026-07-20T12:10:00Z",
    createdBy: "treasury@acme.eu",
  },
  {
    id: "123e4567-e89b-12d3-a456-426614174003",
    paymentReference: "PAY-2024-001237",
    rampType: "ON_RAMP",
    status: "REJECTED",
    fiatAmount: 750.0,
    fiatCurrency: "EUR",
    cryptoAmount: 742.5,
    cryptoCurrency: "EURC",
    createdAt: "2026-07-18T10:05:00Z",
    createdBy: "ops@acme.eu",
  },
  {
    id: "123e4567-e89b-12d3-a456-426614174004",
    paymentReference: "PAY-2024-001238",
    rampType: "OFF_RAMP",
    status: "PROCESSING",
    fiatAmount: 12000.0,
    fiatCurrency: "EUR",
    cryptoAmount: 11940.0,
    cryptoCurrency: "USDC",
    createdAt: "2026-07-25T07:45:00Z",
    createdBy: "treasury@acme.eu",
  },
] satisfies schemas["RampRequestListItem"][];

export const rampRequest = {
  id: "123e4567-e89b-12d3-a456-426614174000",
  companyId: "co000001-0000-4000-8000-000000000001",
  companyName: "Acme Corporation B.V.",
  rampType: "ON_RAMP",
  status: "AWAITING_APPROVAL",
  amount: 990.0,
  netAmount: 990.0,
  fiatAmount: 1000.0,
  fiatNetAmount: 990.0,
  fiatFeeAmount: 10.0,
  exchangeRate: 1.0,
  feePercentage: 1.0,
  paymentReference: "PAY-2024-001234",
  paymentReceived: false,
  createdAt: "2026-07-24T09:00:00Z",
  fiatCurrency: fiatCurrencies[0],
  cryptoCurrency: cryptoCurrencies[0],
  version: 3,
} satisfies schemas["RampRequestDto"];

export const onRampPairs = [
  { from: { currency: "EUR" }, to: { currency: "USDC", chain: "BASE" } },
  { from: { currency: "USD" }, to: { currency: "USDC", chain: "BASE" } },
] satisfies schemas["OnRampPair"][];

export const offRampPairs = [
  { from: { currency: "USDC", chain: "BASE" }, to: { currency: "EUR" } },
] satisfies schemas["OffRampPair"][];

export const calculatedFee = {
  amount: 10.0,
  percentage: 1.0,
} satisfies schemas["CalculatedFeeDto"];

export const companyFees = [
  {
    id: "fe000001-0000-4000-8000-000000000001",
    companyId: rampRequest.companyId,
    name: "on-ramp standard",
    percentage: 1.0,
    minVolume: 0,
    maxVolume: 2000000,
    version: 1,
  },
] satisfies schemas["FeeDto"][];

export const rampRequestsCsv = [
  "id,paymentReference,rampType,status,fiatAmount,fiatCurrency,cryptoAmount,cryptoCurrency,createdAt,createdBy",
  '123e4567-e89b-12d3-a456-426614174000,PAY-2024-001234,ON_RAMP,AWAITING_APPROVAL,1000.00,EUR,990.000000,USDC,2026-07-24T09:00:00Z,manager@acme.eu',
  '123e4567-e89b-12d3-a456-426614174002,PAY-2024-001236,OFF_RAMP,SUCCEEDED,2500.00,USD,2502.500000,USDC,2026-07-20T12:10:00Z,treasury@acme.eu',
].join("\n");

export const fundflowRoutes: RouteTable = {
  "GET /v1/ramp-requests": { kind: "list", items: rampRequestListItems },
  "POST /v1/ramp-requests": { kind: "create", base: rampRequest },
  "GET /v1/ramp-requests/{id}": { kind: "item", result: rampRequest },
  // Four-eyes actions move the request one state forward with the version
  // bumped. "item", not "update": the request body is the optimistic-locking
  // token {version}, which must never echo over the response's new version.
  "POST /v1/ramp-requests/{id}/approve": {
    kind: "item",
    result: { ...rampRequest, status: "AWAITING_FUNDS", version: rampRequest.version + 1 },
  },
  "POST /v1/ramp-requests/{id}/reject": {
    kind: "item",
    result: { ...rampRequest, status: "REJECTED", version: rampRequest.version + 1 },
  },
  "POST /v1/ramp-requests/{id}/cancel": {
    kind: "item",
    result: { ...rampRequest, status: "CANCELLED", version: rampRequest.version + 1 },
  },
  "PUT /v1/ramp-requests/{id}/amount": { kind: "update", base: rampRequest },
  "PATCH /v1/ramp-requests/{id}/initiate": {
    kind: "update",
    base: { ...rampRequest, status: "PROCESSING", version: rampRequest.version + 1 },
  },
  "PATCH /v1/ramp-requests/{id}/tx-hash": {
    kind: "update",
    base: {
      ...rampRequest,
      blockchainTransactionHash:
        "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
    },
  },
  "GET /v1/ramp-requests/on-ramp/pairs": { kind: "array", items: onRampPairs },
  "GET /v1/ramp-requests/off-ramp/pairs": { kind: "array", items: offRampPairs },
  "GET /v1/ramp-requests/export": { kind: "text", body: rampRequestsCsv },
  // "item", not "create": echoing the request body would overwrite the fee.
  "POST /v1/fees/calculate": { kind: "item", result: calculatedFee },
  "GET /v1/fees": { kind: "array", items: companyFees },
  "GET /v1/fiat-currencies": { kind: "array", items: fiatCurrencies },
  "GET /v1/crypto-currencies": { kind: "array", items: cryptoCurrencies },
  "GET /v1/chains": { kind: "array", items: chains },
};
