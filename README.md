# Venly Finance TypeScript SDK

TypeScript SDK for the [Venly Finance](https://docs.venlyfinance.com) and Fundflow APIs. Types are generated from the OpenAPI specs in [`specs/`](specs/); the runtime layer is hand-written and has **zero runtime dependencies** (Node ≥ 18, or any environment with `fetch`).

> MIT licensed. See the [CHANGELOG](CHANGELOG.md) for the current version and what each release added.

Building with a coding agent? Start from [AGENTS.md](AGENTS.md).

## Packages in this repository

| Package | What it is |
|---|---|
| [`@venlyfinance/sdk`](.) (root) | The TypeScript SDK: typed client for every Finance + Fundflow operation |
| [`@venlyfinance/settlement-mcp`](settlement-mcp/) | Venly Finance MCP: SDK-backed tools, runtime-contract blueprints and deterministic review/verify gates for building international money experiences. Mock-first; live writes fail closed. |
| [`@venlyfinance/react`](react/) | Headless React layer: provider, TanStack Query hooks, and flow state machines for staged transfers, four-eyes approval, and ramp lifecycles |
| [`@venlyfinance/ui`](ui/) | Copy-owned UI kit: design tokens (the white-label contract) plus components encoding fintech density, money typography, and state-legibility rules. Not npm-published |
| [`examples/mock-bank`](examples/mock-bank/) | Runnable example assembling the two: a full account experience in mock mode – fake data, zero credentials. `npm install && npm run dev` |

## Build an international account experience with an AI agent

The MCP extends this SDK rather than maintaining a second API client. In explicit
mock mode it gives a coding agent atomic party, account, wallet/balance, EUR receiving
account and transfer tools without credentials or network access. It also publishes a
`build_international_account` prompt plus capability and safety resources. Its
initialize response and journey blueprints push the package/provider/hook
contract, while the `review` and `verify` CLIs gate screen and runtime
composition in generated apps.

The product boundary is deliberate: Venly supplies financial infrastructure through
regulated partners. Creating a party does not complete KYC/KYB; the current public
contract documents EUR/SEPA virtual bank accounts and does not expose card issuing.

See the [Venly Finance MCP quickstart](settlement-mcp/README.md#try-the-builder-in-mock-mode).

## What the SDK handles for you

| Concern | Behaviour |
|---|---|
| Auth | OAuth2 client credentials. Tokens expire after ~5 min; cached, refreshed 30 s early, single-flighted, transparently re-fetched on a 401. |
| Idempotency | Every mutating request (POST/PUT/PATCH) gets an auto-generated UUID `Idempotency-Key` (pass your own to override). This is what makes retries safe. |
| Retries | Exponential backoff + jitter on 429/502/503/504 and network errors, `Retry-After` respected, 3 attempts by default. |
| Errors | Non-2xx throws `VenlyApiError` with `status`, `errors[]` and the `traceCode` to quote at support. |
| Envelope | `{success, errors[], result}` is unwrapped – methods return `result` directly. |
| Pagination | `list()` returns `{items, pagination}`; `iterate()` walks all pages as an async iterator. |

## Try it in 0 minutes (mock mode)

No signup, no credentials, no network. Mock mode is a **stateful, spec-validated
simulation of the documented lifecycle**: creates mint real ids and read back,
verification starts pending (exactly as the docs describe - creating a party
starts KYC/KYB, it does not complete it), transfers start `PENDING`, and request
bodies are validated against the vendored OpenAPI specs so an invented field
fails here instead of in staging.

```ts
import { VenlyFinanceClient } from "@venlyfinance/sdk";

const venly = new VenlyFinanceClient({ environment: "mock" });

const party = await venly.parties.create({
  partyType: "INDIVIDUAL", firstName: "Ada", lastName: "Lovelace",
});
party.kycStatus;                                       // "VERIFICATION_PENDING" - honest
venly.mock!.advanceVerification(party.id!);            // play the Venly admin
(await venly.parties.get(party.id!)).kycStatus;        // "VERIFIED"

const transfer = await venly.transfers.createFiat(accountId, {
  receiverAccountId, currency: "EUR", amount: 25, idempotencyKey: crypto.randomUUID(),
});
transfer.status;                                       // "PENDING" - poll it like production
venly.mock!.advanceTransfer(transfer.id!);             // → COMPLETED, with a transactionHash
venly.mock!.advanceTransfer(other.id!, "FAILED");      // exercise the failure path

venly.mock!.failNext("NOT_FOUND");                     // simulate an API error
venly.mock!.respondNext({ success: true }, "GET /accounts/{accountId}/virtual-bank-accounts");
venly.mock!.delayNext(1500, "GET /accounts/{accountId}/virtual-bank-accounts");
venly.mock!.calls;                                     // inspect everything your code sent
venly.mock!.reset();                                   // back to the seed fixtures
```

Error simulation throws the same `VenlyApiError` the live API produces
(`failNext("OPTIMISTIC_LOCK_EXCEPTION")`, or a custom `{status, code, message}`;
add a route filter like `failNext("VALIDATION_ERROR", "POST /parties")`).
`respondNext` and `delayNext` accept the same exact route filter, so sparse
response envelopes and loading states can be exercised without network calls.
Paginated SDK results include `resultPresent`; it is `false` when a response
omits `result`, which lets applications distinguish malformed data from a
genuine empty list.
Ready for real calls? Change `environment` to `"staging"` and add
`clientId`/`clientSecret` - nothing else changes, and the same options object
type-checks in all three environments.

## Quickstart

```ts
import { VenlyFinanceClient } from "@venlyfinance/sdk";

const venly = new VenlyFinanceClient({
  clientId: process.env.VENLY_CLIENT_ID!,
  clientSecret: process.env.VENLY_CLIENT_SECRET!,
  environment: "staging", // or "production" (default)
});

// Onboard a party, open an account (its wallet is auto-provisioned), assign an IBAN
const party = await venly.parties.create({
  partyType: "INDIVIDUAL",
  firstName: "Ada",
  lastName: "Lovelace",
});

const account = await venly.accounts.create({
  externalId: "customer-42",
  chain: "BASE",
  partyId: party.id,
});

const wallets = await venly.wallets.list(account.id!);

// vIBANs require a KYC-VERIFIED account. Live, a Venly admin verifies it;
// in mock mode play the operator: venly.mock?.advanceVerification(account.id!)
const iban = await venly.virtualBankAccounts.create(account.id!, {
  name: "EUR Payouts",
  inCurrency: "EUR",
  targetCryptocurrency: "USDC",
  idempotencyKey: crypto.randomUUID(),
});
```

### Card settlement lifecycle

```ts
// Reserve funds for an authorization, then settle (or reverse) it.
const pr = await venly.paymentRequests.create(account.id!, {
  amount: 25, currency: "USD", idempotencyKey: crypto.randomUUID(),
});

await venly.paymentRequests.settle(pr.id!, {
  amount: 25, currency: "USD", idempotencyKey: crypto.randomUUID(),
}); // 202 → status SETTLING, then SETTLED once on-chain transfers confirm

// or void it:
await venly.paymentRequests.reverse(pr.id!, {
  reason: "MERCHANT_VOID", idempotencyKey: crypto.randomUUID(),
});
```

### Third-party payouts (contract 1.3.0)

Crypto leaves the account; fiat lands in a registered beneficiary bank
account. Three resources deep: a bank account on the party, a route on the
account (activated by wallet-ownership proof), payouts against the route.

```ts
// Payouts require a VERIFIED account. In mock mode, play the operator for
// both pending states: account KYC and the beneficiary bank account below.
venly.mock?.advanceVerification(account.id!);

const beneficiary = await venly.payoutBankAccounts.register(party.id!, {
  rail: "SEPA", fiatCurrency: "EUR", accountHolderName: "Supplier GmbH",
  railDetails: { iban: "DE89...", bic: "DEUTDEDBFRA" },
}); // starts PENDING; an operator activates it
venly.mock?.advancePayoutBankAccount(beneficiary.id!, "ACTIVE");

const route = await venly.payoutRoutes.create(account.id!, {
  payoutBankAccountId: beneficiary.id!,
  depositAsset: { chain: "BASE", name: "USDC" },
}); // AWAITING_OWNERSHIP_PROOF until the funding wallet signs

// No body: the server derives the funding wallet and chain from the route.
const proof = await venly.payoutRoutes.prepareOwnershipProof(account.id!, route.id!);
await venly.payoutRoutes.completeOwnershipProof(account.id!, route.id!, {
  message: proof.message!, signature: "0x...",
}); // route ACTIVE

const payout = await venly.payouts.request(account.id!, {
  payoutRouteId: route.id!, cryptoAmount: 250.5,
  idempotencyKey: crypto.randomUUID(),
}); // REQUESTED → SENDING → PROVIDER_PROCESSING → COMPLETED | REJECTED | FAILED | RETURNED

// Mock drivers walk the lifecycle: venly.mock.advancePayout(payout.id!, "COMPLETED")
```

### Supported assets and decimals

Every asset carries its on-chain `decimals` – the render contract for
amounts. A UI that assumes two decimals shows a 6-decimal asset's sub-cent
balance as `0.00`, and its totals stop reconciling with the rows.

```ts
const assets = await venly.supportedAssets.list(); // tenant-wide, with decimals
const decimals = new Map(assets.items.map((a) => [a.contractAddress, a.decimals]));

// Per account: the same rows plus permitStatus (READY, ACTIVATING,
// ACTION_REQUIRED, PENDING, FAILED, NO_WALLET).
const mine = await venly.supportedAssets.listForAccount(account.id!);
```

### Pagination

```ts
for await (const party of venly.parties.iterate({ status: "ACTIVE" })) {
  console.log(party.id);
}
```

### Errors

```ts
import { VenlyApiError } from "@venlyfinance/sdk";

try {
  await venly.transfers.createFiat(accountId, body);
} catch (err) {
  if (err instanceof VenlyApiError) {
    console.error(err.status, err.traceCode, err.errors);
  }
}
```

### Fundflow (on/off-ramps with four-eyes approvals)

```ts
import { FundflowClient } from "@venlyfinance/sdk";

const fundflow = new FundflowClient({ clientId, clientSecret, environment: "staging" });

const ramp = await fundflow.rampRequests.create({ /* ... */ });
// maker-checker: the API rejects self-approval server-side, and approvals
// carry the optimistic-locking version of the request you reviewed
await fundflow.rampRequests.approve(ramp.id!, { version: ramp.version! });
```

### Escape hatch

Any endpoint without a named wrapper is still reachable with auth, retries and idempotency applied:

```ts
const user = await fundflow.request("GET", "/v1/auth/user");
```

## Development

```bash
npm install
npm run generate   # regenerate src/generated/ from specs/*.yaml
npm run build      # ESM + CJS + d.ts into dist/
npm test           # build + node:test suite (mocked fetch, no network)
```

The vendored specs in `specs/` are the source of truth for the generated types. When the API changes, update the spec, run `npm run generate`, and the compiler surfaces every affected call site.
