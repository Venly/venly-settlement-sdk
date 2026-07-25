# Venly Finance TypeScript SDK

TypeScript SDK for the [Venly Finance](https://docs.venlyfinance.com) and Fundflow APIs. Types are generated from the OpenAPI specs in [`specs/`](specs/); the runtime layer is hand-written and has **zero runtime dependencies** (Node ≥ 18, or any environment with `fetch`).

> **Status: v0.1.1.** MIT licensed. Built on the roadmap commitment "[TypeScript SDK on npm](https://github.com/timdierckxsens/venly-roadmap)" (Q3 2026). v0.1.1 regenerates every type and endpoint from the live published OpenAPI specs, fixing the base URL and operation set v0.1.0 inherited from a stale spec snapshot – see [CHANGELOG](CHANGELOG.md).

## Packages in this repository

| Package | What it is |
|---|---|
| [`@venlyfinance/sdk`](.) (root) | The TypeScript SDK: typed client for every Finance + Fundflow operation |
| [`@venlyfinance/settlement-mcp`](settlement-mcp/) | Settlement MCP server: a human-gated operator surface over the same APIs for MCP clients and agents. Read-only by default, write tools fail closed, x402 quote stub included. MIT licensed. |

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

No signup, no credentials, no network. Every method returns realistic fixtures
typed against the OpenAPI schemas:

```ts
import { VenlyFinanceClient } from "@venlyfinance/sdk";

const venly = new VenlyFinanceClient({ environment: "mock" });

const party = await venly.parties.create({
  partyType: "INDIVIDUAL", firstName: "Ada", lastName: "Lovelace",
});
const accounts = await venly.accounts.list();          // paginated fixtures
const vibans = await venly.virtualBankAccounts.list(accounts.items[0].id!);

venly.mock!.failNext("NOT_FOUND");                     // simulate an API error
venly.mock!.calls;                                     // inspect everything your code sent
```

Error simulation throws the same `VenlyApiError` the live API produces
(`failNext("OPTIMISTIC_LOCK_EXCEPTION")`, or a custom `{status, code, message}`;
add a route filter like `failNext("VALIDATION_ERROR", "POST /parties")`).
Ready for real calls? Swap the options for
`{ clientId, clientSecret, environment: "staging" }` - nothing else changes.

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
