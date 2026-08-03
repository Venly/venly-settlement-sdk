# Venly Finance MCP

Build and operate international money-product experiences over the Venly Finance
and Fundflow APIs. The server exposes atomic financial tools, contract-backed
product resources and a `build_international_account` prompt to MCP clients and
coding agents.

**Tools expose financial capabilities. Prompts and skills assemble products. The
host coding agent builds the interface.** This is one expanded implementation of
the original Settlement MCP, not a second server.

Start in explicit mock mode with no credentials or network. Move the same SDK
business logic to staging only after reviewing capabilities, compliance state and
the normalized write requests. Staging and production writes fail closed.

The published baseline is v0.1.1. The Finance builder surface documented here is
the next 0.x release line.

## What it is

- Built on the official MCP TypeScript SDK (`@modelcontextprotocol/sdk`), Node
  >= 18, stdio transport.
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

### 2. Write tools (present, DISARMED by default)

Builder writes: `create_party`, `create_account`,
`create_virtual_bank_account`, `create_fiat_transfer`,
`create_crypto_transfer`, `create_payment_session`.

Operator writes: `approve_ramp_request`, `reject_ramp_request`. The legacy
`stage_transfer` name remains as a compatibility tool; new builds use
`create_fiat_transfer` and its current OpenAPI field names.

Each is dry-run by default and returns the exact request it would send. See the
safety model below.

### 3. x402 tool (position + stub)

`quote_x402_payment` returns an HTTP-402-shaped quote (price, asset, payTo,
chain) for a settlement action, following the x402 `PaymentRequirements` model.
It documents the machine-to-machine rail. It never executes a payment, never
calls a facilitator, and never moves funds. Production x402 settlement needs a
facilitator decision and live rails.

## Safety model (fail closed)

Outside explicit mock mode, read-only/dry-run is the default posture. A staging
write executes a live call only when all three hold:

1. the tool argument `confirm === true`, and
2. the environment flag `VENLY_MCP_LIVE === "1"`, and
3. credentials are present (`VENLY_CLIENT_ID` and `VENLY_CLIENT_SECRET`).

If any leg is missing, the tool returns a dry-run object describing the request
it would have sent and never touches the transport. This is proven by
`test/write-tools.test.ts`, including the critical case: `confirm:true` with
`VENLY_MCP_LIVE` unset still dry-runs and does not call the live client.

Production additionally requires `VENLY_ENV=production` and
`VENLY_MCP_PRODUCTION=1`. There is no implicit fallback from a live environment
to mock data.

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

The server speaks MCP over stdio. On start it logs to stderr whether writes are
armed or disarmed (stdout is the MCP channel, no credentials are logged).

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
| `VENLY_ENV` | `staging` for 0.x compatibility; set `mock` explicitly for fixtures |
| `VENLY_FINANCE_BASE_URL` | `https://api-staging.venlyfinance.com/v1` |
| `VENLY_FUNDFLOW_BASE_URL` | `https://api-fundflow-staging.venly.io` |
| `VENLY_TOKEN_URL` | `https://login-staging.venly.io/auth/realms/VenlyFinance/protocol/openid-connect/token` (staging; use `login.venly.io` for production) |
| `VENLY_CLIENT_ID` | unset (read-only until set) |
| `VENLY_CLIENT_SECRET` | unset |
| `VENLY_MCP_LIVE` | unset (writes disarmed) |
| `VENLY_MCP_PRODUCTION` | unset (production writes disarmed) |

Fundflow also exposes a QA sandbox (`https://api-fundflow-qa.venly.io`). If your
tenant uses different endpoints, override them via the env vars above.

## Enabling live writes (a deliberate operator decision)

Live writes are OFF. To arm them, the operator must:

1. set `VENLY_MCP_LIVE=1`, and
2. provide sandbox credentials `VENLY_CLIENT_ID` and `VENLY_CLIENT_SECRET`, and
3. pass `confirm: true` on the specific write tool call.

Until all three are set, every write tool dry-runs. Arming the flag and
provisioning credentials is a deliberate, human decision, not a default.

Production also requires `VENLY_MCP_PRODUCTION=1` on the server. Mock mode does
not use these flags because it cannot reach the network; results remain clearly
labelled synthetic.

## x402 position

The machine-to-machine agent-payments rail is consolidating on x402 (Cloudflare
plus the Coinbase x402 Foundation; MCP tools return HTTP 402). Venly's stance:
the MCP is the human-gated operator surface; x402 is the machine-to-machine rail.
This ship states the position and ships a well-formed 402 quote stub. It does not
ship a production x402 settlement engine, that needs a facilitator decision and
live rails.

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
    types.ts              VenlyClient interface + domain types
    safety.ts             the write-gate (confirm + env + creds)
    reconcile.ts          pure reconciliation logic
    resources.ts          capability, safety and workflow resources
    prompts.ts            build_international_account prompt
    results.ts            text + structured output and error redaction
    client/
      sdk-client.ts       Adapter over @venlyfinance/sdk
    tools/
      read-tools.ts       tier 1
      write-tools.ts      tier 2 (fail closed)
      x402-tools.ts       tier 3 (stub)
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
