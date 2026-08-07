# Venly Finance TypeScript SDK

TypeScript SDK for the [Venly Finance](https://docs.venlyfinance.com) and Fundflow APIs. Types are generated from the OpenAPI specs in [`specs/`](specs/); the runtime layer is hand-written and has **zero runtime dependencies** (Node ≥ 18, or any environment with `fetch`).

> **Status: v0.2.0.** MIT licensed. See the [CHANGELOG](CHANGELOG.md) for what each release added.

## Packages in this repository

| Package | What it is |
|---|---|
| [`@venlyfinance/sdk`](.) (root) | The TypeScript SDK: typed client for every Finance + Fundflow operation |
| [`@venlyfinance/settlement-mcp`](settlement-mcp/) | Venly Finance MCP: SDK-backed tools, product resources and prompts for building and operating international money experiences. Mock-first; live writes fail closed. |

## Build an international account experience with an AI agent

The MCP extends this SDK rather than maintaining a second API client. In explicit
mock mode it gives a coding agent atomic party, account, wallet/balance, EUR receiving
account and transfer tools without credentials or network access. It also publishes a
`build_international_account` prompt plus capability and safety resources.

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
venly.mock!.calls;                                     // inspect everything your code sent
venly.mock!.reset();                                   // back to the seed fixtures
```

Error simulation throws the same `VenlyApiError` the live API produces
(`failNext("OPTIMISTIC_LOCK_EXCEPTION")`, or a custom `{status, code, message}`;
add a route filter like `failNext("VALIDATION_ERROR", "POST /parties")`).
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
