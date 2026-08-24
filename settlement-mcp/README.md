# Venly Finance MCP

**Every write/prepare tool in this MCP refuses any non-sandbox base URL and any
credential-shaped parameter – enforced in code with a test per tool, not a
policy note.** Reads work in every environment; mutations and preparation tools
execute only against the mock sandbox (zero credentials, zero network). Live
mutations belong to your own reviewed integration over `@venlyfinance/sdk`.

Build and operate international money-product experiences over the Venly Finance
and Fundflow APIs. The server exposes atomic financial tools, contract-backed
product resources and a `build_international_account` prompt to MCP clients and
coding agents.

**Tools expose financial capabilities. Prompts and skills assemble products. The
host coding agent builds the interface.** This is one expanded implementation of
the original Settlement MCP, not a second server.

The Venly Finance builder surface documented here is the v0.9.0 release line.

Building with a coding agent? Start from [AGENTS.md](AGENTS.md) - the MCP also serves it as the `venly://frontend/agents` resource and pushes the core runtime doctrine in its initialize response.

## What it is

- Built on the official MCP TypeScript SDK (`@modelcontextprotocol/sdk`), Node
  >= 20, stdio transport.
- A thin layer over the Venly Finance API (`finance.yaml`, servers
  `https://api.venlyfinance.com/v1`) and the Fundflow API (`fundflow.yaml`,
  servers `https://api-fundflow.venly.io`). Endpoint truth is the published API
  reference at [docs.venlyfinance.com](https://docs.venlyfinance.com/api-reference).
- Transport is injected through the `VenlyClient` interface (`src/types.ts`).
  `SdkVenlyClient` delegates to the published `@venlyfinance/sdk`; tests inject
  a lightweight mock.

### Transport

The MCP uses [`@venlyfinance/sdk`](../) for OAuth2 client credentials, token
caching/refresh, retries, idempotency and normalized API errors. It does not
maintain a second HTTP or authentication implementation.

## Try the builder in mock mode

```json
{
  "mcpServers": {
    "venly-finance": {
      "command": "npx",
      "args": ["-y", "@venlyfinance/settlement-mcp"],
      "env": { "VENLY_ENV": "mock" }
    }
  }
}
```

Then select the `build_international_account` prompt or ask the agent to read:

- `venly://capabilities`
- `venly://safety`
- `venly://workflows/international-account`
- `venly://workflows/mock-to-staging`

Mock mutations execute against SDK fixtures, are labelled `mode: "mock"`, use no
credentials and make no network requests.

## Tool tiers

### 1. Read tools (always on)

Call GETs only. No mutation, safe by default.

| Tool | Maps to |
|---|---|
| `list_ramp_requests` | fundflow `GET /v1/ramp-requests` |
| `get_ramp_request` | fundflow `GET /v1/ramp-requests/{id}` |
| `list_accounts` | finance `GET /accounts` |
| `get_account` | finance `GET /accounts/{accountId}` |
| `list_wallets` | finance `GET /accounts/{accountId}/wallets` (including token balances) |
| `list_virtual_bank_accounts` | finance `GET /accounts/{accountId}/virtual-bank-accounts` |
| `get_virtual_bank_account` | finance `GET /accounts/{accountId}/virtual-bank-accounts/{id}` |
| `reconcile_by_reference_code` | composite: lists vIBANs, matches supplied transactions by referenceCode |
| `list_transfers` | finance `GET /accounts/{accountId}/transfers` |
| `get_transfer` | finance `GET /accounts/{accountId}/transfers/{transferId}` |
| `list_parties` | finance `GET /parties` |
| `get_party` | finance `GET /parties/{partyId}` |
| `get_reference_data` | fundflow chains / fiat-currencies / crypto-currencies / fees |

`reconcile_by_reference_code` is the EUR vIBAN reconciliation: a customer sends
EUR to a vIBAN including a reference code in the payment; this tool fetches the
account's vIBANs and matches the observed incoming bank transactions (operator-
or feed-supplied) to the vIBAN carrying that referenceCode. It returns the
matched vIBAN, the matched transactions, and the total amount.

### 2. Write tools (mock sandbox only)

Builder writes: `create_party`, `create_account`,
`create_virtual_bank_account`, `create_fiat_transfer`,
`create_crypto_transfer`, `create_payment_session`.

Operator writes: `approve_ramp_request`, `reject_ramp_request`. The legacy
`stage_transfer` alias was removed in 0.4.0 as deprecated in 0.3.0; use
`create_fiat_transfer` and its current OpenAPI field names.

Each executes against the mock fixtures in mock mode, and refuses any
non-sandbox base URL with a message stating the boundary. See the safety model
below.

### Payout tools (since 0.5.0)

The payout surface of the finance contract, same tiering as above. Reads:
`list_payouts`, `get_payout`, `list_payout_routes`, `list_payout_bank_accounts`.
Writes (mock sandbox only, fail-closed like every write):
`register_payout_bank_account`, `create_payout_route`,
`prepare_payout_ownership_proof`, `complete_payout_ownership_proof`,
`request_payout`.

### `prepare_decision` (agent as maker, human as checker)

`prepare_decision` attaches an agent-prepared decision draft to a record in
the mock sandbox: `recordType` (`verification` · `reconciliation` ·
`payout_exception`), `recordId`, a `proposal`, the `reason`, and
`evidenceRefs` into the evidence the agent read. The draft **never applies
anything** – it is stored on the mock world, emits `decision.prepared`, and
renders in the console decision panel visually distinct from the operator's
own register, badged as a sandbox agent draft. The human decides through the
existing ceremony (approve/reject, confirm/return); that decision marks the
draft superseded, and the trail then carries both actors with both real
timestamps.

Two authority models, deliberately distinct:

- **Maker/checker** governs business-judgment decisions about other parties'
  state – KYC verifications, reconciliation matches, payout exceptions. The
  agent may only PREPARE; the checker's click in the console is the only
  mutation.
- **Delegated payment authority** governs the x402 flow below – the payer's
  own pre-authorized quote-and-pay call, scoped like an API key, on the
  payer's own account. The agent executes its principal's own spend; it never
  judges anyone else's state.

### 3. x402 tools (the agent-payment rail)

`quote_x402_payment` returns an HTTP-402-shaped quote (price, asset, payTo,
chain) for a settlement action, following the x402 `PaymentRequirements`
model. The quote itself moves nothing and calls no facilitator; in the mock
sandbox the full agent-payment flow then RUNS end to end:

```text
1. quote_x402_payment            -> the payment_required envelope
2. create_fiat_transfer          -> carry the quote's reference in
   (or create_crypto_transfer)      merchantReference
3. list_transfers / activity UI  -> the transfer renders like ANY transfer
4. simulations.events / console  -> the event trail attributes the session
5. simulations.ledger.verify()   -> the books still balance; the debit is
                                    visible on the payer's balance
```

No agent badge on the activity row **by design** – the ledger contract has no
initiator field, so we didn't invent one; the agent is attributed in the
event trail. (An initiator/channel field on transfers is an open ask.)
Production x402 settlement needs a facilitator decision and live rails; per
the sandbox boundary above, this server never executes it.

## Frontend toolset (interface assembly)

Delivery of UI source rides the shadcn registry standard – add
`{ "registries": { "@venlyfinance": "https://raw.githubusercontent.com/Venly/venly-settlement-sdk/main/ui/r/{name}.json" } }`
to `components.json`, then `npx shadcn@latest add @venlyfinance/receive`. The MCP carries
what a registry cannot:

- `get_journey_blueprint` – screen inventory and required states for seventeen
  money-product journeys (including `agent-payment`, the runnable x402
  sequence above), plus a machine-readable `runtime_contract` containing
  exact package versions, qualified hooks, provider setup, forbidden patterns,
  install commands and completion checks.
- `verify_runtime_contract` – deterministic runtime-contract checks over supplied
  source and package metadata, using the same profiles and rules as the CLI.
- `review_screen` – deterministic design audit of a screen's source (raw colours,
  hyphen-minus amounts, success styling on cancelled steps, masked review values,
  invented timing/custody copy, crypto codes inside `Intl.NumberFormat` currency
  formatting, required fields rendered optional, parity and round-number fixtures,
  zebra striping, off-token shadows, colour-only state). Pass the optional `journey`
  key to also check that every state the journey blueprint names appears in the
  source. Findings, not a score.
- `venly://frontend/agents` – the composition rules an agent should read before building.

The `build_international_account` prompt assembles the interface from the registry and
gates every finished screen on `review_screen`. See [`ui/`](../ui/README.md) for the kit itself.

### Design-audit CLI

The same audit runs as a command, so a generated app can gate itself in CI:

```bash
npx @venlyfinance/settlement-mcp review "src/**/*.tsx"
```

Exit `1` on any error-severity finding, `0` otherwise (warnings print either way),
`2` on usage errors or a pattern that matches nothing. Suppress a deliberate,
justified exception with `venly-allow:<rule-id>` on the offending line or the line
above – the finding is dropped silently. This repo runs the same command over its
own registry sources in CI.

Scope the glob to component source, never to token or theme files: the
`raw-colour` rule fires on any hex/rgba literal by design, and a tokens/theme
css file is the one legitimate home of raw colour values (theming stays a
one-file edit). `"src/**/*.tsx"` is the right default.

### Runtime-contract CLI

Gate the data-plane composition alongside the screen audit:

```bash
npx @venlyfinance/settlement-mcp verify "src/**/*.{ts,tsx}"
```

The verifier auto-detects `direct-sdk` (browser provider + hooks) or
`backend-proxy` (browser proxy options + SDK-backed server routes). Override
with `--profile direct-sdk` or `--profile backend-proxy`. Exit codes are `0`
when no error findings exist, `1` when any error exists, and `2` for usage or
no-match failures; warnings print but do not fail. The same
`venly-allow:<rule-id>` token suppresses a deliberate finding on its line or
the line above.

## Safety model (fail closed, enforced in code)

Every write/prepare tool refuses, before validation and before any client
access:

1. **any non-mock base URL** – a session resolving to `VENLY_ENV=qa`, `staging`
   or `production`, or carrying a base-URL override, is refused with a message
   stating the sandbox boundary. There is no arming flag and no confirm
   combination that opens a live write from this server.
2. **any credential-shaped parameter** – argument keys that name a secret, API
   key, token, password or private key, and argument values shaped like one
   (Bearer header, JWT, prefixed API key, PEM block), are refused outright.
   Credentials never belong in tool arguments; the sandbox needs none.

Both rules are proven per tool by `test/sandbox-boundary.test.ts`, alongside an
end-to-end mock-session test as the positive control. Reads are unaffected:
staging/production credentials enable the read tier only.

Other invariants:

- Credentials are read from env, never logged, never returned in tool output.
- No tool broadens an allowlist, changes credentials, or deletes production data.
- Four-eyes approval semantics are preserved. The Fundflow API enforces that an
  identity cannot approve a request it created; this server surfaces that state,
  it does not bypass it. `approve_ramp_request` / `reject_ramp_request` carry the
  optimistic-locking `version` (read it from `get_ramp_request`).

## Install, build, test

```bash
npm install
npm run build     # tsc -> dist/, entry dist/index.js
npm test          # node:test via tsx, mocked client, no network
```

## Run

The fastest path once published to npm - one line in any MCP client config:

```json
{
  "mcpServers": {
    "venly-finance": {
      "command": "npx",
      "args": ["-y", "@venlyfinance/settlement-mcp"]
    }
  }
}
```

Or from a clone:

```bash
node dist/index.js
```

The server speaks MCP over stdio. On start it logs to stderr whether
write/prepare tools execute (mock) or refuse (any non-sandbox target) in this
environment (stdout is the MCP channel, no credentials are logged).

MCP client config example:

```json
{
  "mcpServers": {
    "venly-finance": {
      "command": "node",
      "args": ["/absolute/path/to/settlement-mcp/dist/index.js"],
      "env": {
        "VENLY_ENV": "staging",
        "VENLY_FINANCE_BASE_URL": "https://api-staging.venlyfinance.com/v1",
        "VENLY_FUNDFLOW_BASE_URL": "https://api-fundflow-staging.venly.io"
      }
    }
  }
}
```

## Point it at sandbox

Defaults already point at STAGING so an accidental run never touches production.
Override via env:

| Env var | Default (staging) |
|---|---|
| `VENLY_ENV` | Defaults to `mock` (since 0.3.0): an unconfigured server never points at real infrastructure. Set `staging` or `production` explicitly |
| `VENLY_FINANCE_BASE_URL` | `https://api-staging.venlyfinance.com/v1` |
| `VENLY_FUNDFLOW_BASE_URL` | `https://api-fundflow-staging.venly.io` |
| `VENLY_TOKEN_URL` | `https://login-staging.venly.io/auth/realms/VenlyFinance/protocol/openid-connect/token` (staging; use `login.venly.io` for production) |
| `VENLY_CLIENT_ID` | unset (reads need it outside mock) |
| `VENLY_CLIENT_SECRET` | unset |

Credentials enable the read tier only: write/prepare tools refuse any non-mock
base URL regardless of credentials or `confirm`.

Fundflow also exposes a QA sandbox (`https://api-fundflow-qa.venly.io`). If your
tenant uses different endpoints, override them via the env vars above.

## Safe staging smoke

Build the server and verify its complete discovery surface, credentialled staging
reads, and fail-closed write gate without mutating staging:

```bash
VENLY_CLIENT_ID=... VENLY_CLIENT_SECRET=... npm run smoke:staging
```

The command starts the MCP with `VENLY_ENV=staging`, verifies the discovery
surface against the exact tool/resource/prompt inventory pinned in the smoke
script itself, then reads parties, accounts, and reference data. It closes by
submitting one confirmed `create_party` request and requires it to be REFUSED
with the sandbox-boundary message – the write guarantee observed from the
outside. Output contains counts and status only – not party/account payloads,
credentials, or tokens.

## Live writes: not from this server

There is no way to execute a staging or production mutation through this MCP –
no flag, no confirm argument, no credential set opens one. That is the point:
an agent session holding this server can prepare, simulate and read, and the
blast radius of anything it does wrong is a local fixture store. When your app
is ready for live mutations, implement them in your own reviewed integration
over [`@venlyfinance/sdk`](../), behind your own review-and-confirm ceremony.

## x402 position

The machine-to-machine agent-payments rail is consolidating on x402 (Cloudflare
plus the Coinbase x402 Foundation; MCP tools return HTTP 402). Venly's stance,
in the two authority models above: business-judgment decisions stay
maker/checker (the agent prepares, the human's click is the mutation), while
x402 is delegated payment authority – the payer's own pre-authorized spend.
This ship makes the quote-and-pay sequence runnable in the mock sandbox and
documents it as the `agent-payment` journey blueprint. It does not ship a
production x402 settlement engine; that needs a facilitator decision and live
rails, and per the sandbox boundary it would live in your own integration,
not this server.

## Skills pack

MCP-consumable workflow docs under `skills/`:

- `reconcile-by-reference-code.md`
- `four-eyes-approval.md`
- `stage-and-confirm-transfer.md`
- `payment-session-lifecycle.md`
- `x402-quote-walkthrough.md`
- `build-international-account.md`
- `mock-to-staging.md`

## Layout

```
settlement-mcp/
  package.json
  tsconfig.json
  README.md
  src/
    index.ts              entry, stdio transport
    server.ts             createServer(client, env), registers all tiers
    constants.ts
    types.ts              Generated SDK aliases + MCP-owned compatibility types
    safety.ts             the sandbox boundary (refuses non-sandbox base URLs and credential-shaped params)
    reconcile.ts          pure reconciliation logic
    resources.ts          capability, safety and workflow resources
    prompts.ts            build_international_account prompt
    results.ts            text + structured output and error redaction
    verify-cli.ts         runtime-contract profiles, checks and CLI
    staging-smoke.ts      safe discovery/read/refusal staging verification
    client/
      sdk-client.ts       Adapter over @venlyfinance/sdk
    tools/
      read-tools.ts       tier 1
      write-tools.ts      tier 2 (fail closed)
      x402-tools.ts       tier 3 (quote + sandbox settle; live settlement stays outside this server)
  skills/
    reconcile-by-reference-code.md
    four-eyes-approval.md
    stage-and-confirm-transfer.md
    payment-session-lifecycle.md
    x402-quote-walkthrough.md
    build-international-account.md
    mock-to-staging.md
  test/
    helpers.ts            in-memory MCP harness + mock client
    read-tools.test.ts
    write-tools.test.ts   includes the critical fail-closed test
    reconcile.test.ts
    x402.test.ts
```
