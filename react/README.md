# @venlyfinance/react

[![ci](https://github.com/Venly/venly-settlement-sdk/actions/workflows/ci.yml/badge.svg)](https://github.com/Venly/venly-settlement-sdk/actions/workflows/ci.yml)

Headless React layer for the [Venly Finance and Fundflow APIs](https://github.com/Venly/venly-settlement-sdk). Provider, TanStack Query hooks, and flow state machines for the lifecycles that make money movement different from CRUD: stage-then-confirm execution, four-eyes approval, and status models where "pending" has four different meanings.

No components, no CSS. This package owns data and state; your UI (or the one your coding agent assembles) owns the pixels. The full behaviour is covered by a node:test suite that runs with zero network.

Building with a coding agent? Start from [AGENTS.md](AGENTS.md).

## Try it in 0 minutes (mock mode)

```bash
npm install @venlyfinance/react @tanstack/react-query
```

```tsx
import { VenlyProvider, useAccounts } from "@venlyfinance/react";

function Accounts() {
  const { data } = useAccounts();
  return <ul>{data?.items.map((a) => <li key={a.id}>{a.name ?? a.id}</li>)}</ul>;
}

export default function App() {
  return (
    <VenlyProvider environment="mock">
      <Accounts />
    </VenlyProvider>
  );
}
```

Mock mode needs zero credentials and makes zero network calls: every hook answers from the SDK's stateful, spec-validated fixture store. Create a party, watch KYC advance, stage a transfer, approve a ramp request – the whole product works on your laptop before you have an API key.

## What's in the box

| Export | What it does |
|---|---|
| `<VenlyProvider>` | Constructs the Finance + Fundflow clients for `mock`, `staging`, or `production`; brings its own QueryClient if the app has none |
| `useParties` `useAccounts` `useWallets` `useSupportedAssets` `useAccountSupportedAssets` `useVirtualBankAccounts` `useTransfers` `useRampRequests` `useReferenceData` `useFeeQuote` … | Read hooks, one per API resource, cache keys managed for you |
| `useCreateParty` `useCreateAccount` `useCreateVirtualBankAccount` `useCreatePaymentSession` `useCreateRampRequest` | Write hooks with cache invalidation wired |
| `useStagedTransfer` | Stage-then-confirm machine: validate → freeze the exact request with a pinned idempotency key → execute once → poll to terminal |
| `useFourEyesApproval` | Approve/reject/cancel with the optimistic-locking `version` carried through; 409 surfaces as `"stale-version"` (refetch and re-decide, never auto-retry) |
| `useRampLifecycle` | One ramp request, polled until terminal, with a status descriptor answering: must I act, who is it waiting on, what still works |
| `venlyKeys` / `venlyQueries` | Query-key factory and pure `{queryKey, queryFn}` factories for prefetching, route loaders, and tests |
| `useVenlyMock` | The mock controls (call log, `failNext`, `respondNext`, `delayNext`, `advanceVerification`, `advanceTransfer`) – defined only in mock mode |
| `proxyClientOptions` | Browser-safe production wiring (below) |

## The flow machines

The hooks above the line are conveniences. These are the point:

```tsx
const t = useStagedTransfer();

// 1. Stage: validates and freezes the request. The idempotency key is pinned
//    HERE, so a double-clicked confirm can only ever execute once.
t.stage({ kind: "fiat", senderAccountId, body: { currency: "EUR", amount: 250 } });

// 2. Your review screen renders t.state.staged – the exact request that will run.
// 3. Confirm: executes, then polls the transfer to COMPLETED or FAILED.
await t.confirm();
```

```tsx
const approval = useFourEyesApproval(request, currentUserId);

approval.capability;        // { canApprove, canReject, canCancel, reason? }
                            // creators see canApprove: false – render the rule, not an error
await approval.approve();   // carries { version }; a 409 → failure "stale-version"
```

```tsx
const { descriptor } = useRampLifecycle(id);
descriptor.phase;        // "action-required" | "waiting" | "in-flight" | "terminal"
descriptor.waitingOn;    // "approver" | "counterparty-funds" | "venly" | null
descriptor.explanation;  // one sentence a support ticket would otherwise ask
```

## Going live: never put credentials in the browser

The Venly APIs use OAuth2 client-credentials. A `clientSecret` in a browser bundle is full API access for anyone who opens devtools, so the provider **throws** if it sees one in a browser outside mock mode.

Two supported production shapes:

**Server-rendered surfaces** (RSC, route handlers): build the clients server-side with real credentials and pass them in via the `finance` / `fundflow` props.

**Browser apps**: the browser talks to your backend; your backend holds the credentials.

```tsx
// client – no secrets anywhere in the bundle
const proxy = proxyClientOptions("/api/venly");
<VenlyProvider environment="production"
  financeOptions={proxy.finance} fundflowOptions={proxy.fundflow} />
```

```ts
// server – e.g. a Next.js catch-all route handler at /api/venly/finance/[...path]
// Authenticate YOUR user first; then forward with the SDK's credentials.
import { VenlyFinanceClient } from "@venlyfinance/sdk";
const venly = new VenlyFinanceClient({
  clientId: process.env.VENLY_CLIENT_ID!,
  clientSecret: process.env.VENLY_CLIENT_SECRET!,
  environment: "production",
});
export async function GET(req: Request, { params }: { params: { path: string[] } }) {
  const result = await venly.request("GET", "/" + params.path.join("/"));
  return Response.json(result);
}
```

The proxy inherits your app's session security, not Venly's – enforce your own authentication and per-user authorization in the handler.

## Design rules this package follows

- **Types derive from the OpenAPI-generated SDK types.** No hand-written API mirrors; a spec regeneration breaks this build instead of drifting silently.
- **TanStack retry is off by default.** The SDK already retries transient failures (429/5xx with backoff and `Retry-After`); a second retry layer multiplies latency and hides real errors.
- **Approvals never auto-retry.** A version conflict means the world changed; the operator re-decides against the new state.
- **Mock affordances cannot fire in production.** `useVenlyMock()` returns `undefined` handles outside mock mode.

## Development

```bash
npm install
npm run typecheck && npm run typecheck:test
npm test          # node:test, zero network
npm run build
```

See it assembled end to end: [`examples/mock-bank`](../examples/mock-bank/) runs a full account experience on these hooks in mock mode – `npm install && npm run dev`, fake data, zero credentials.

MIT. Part of the [venly-settlement-sdk](https://github.com/Venly/venly-settlement-sdk) monorepo alongside `@venlyfinance/sdk` and `@venlyfinance/settlement-mcp`.
