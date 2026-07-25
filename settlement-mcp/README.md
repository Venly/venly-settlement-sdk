# Venly Settlement MCP server

A human-gated operator surface for Venly settlement, exposed as a Model Context
Protocol (MCP) server over stdio. An operator, or a supervised agent, can check a
ramp's four-eyes approval state, reconcile a EUR vIBAN by referenceCode, or stage
a transfer, without hand-writing API calls. It pairs that with a position on
x402, the machine-to-machine agent-payments rail.

The differentiator: the MCP is the human-gated operator surface; x402 is the
machine-to-machine rail. Read-only by default, write tools fail closed.

Status: v0.1.0. Read tools work against staging out of the box once credentials
are set; write tools are shipped disarmed and fail closed (see the safety model).
The x402 tool is a stub that states a position, it moves no funds.

## What it is

- Built on the official MCP TypeScript SDK (`@modelcontextprotocol/sdk`), Node
  >= 18, stdio transport.
- A thin layer over the Venly Finance API (`finance.yaml`, servers
  `https://api.venlyfinance.com/api/v1`) and the Fundflow API (`fundflow.yaml`,
  servers `https://api-fundflow.venly.io`). Endpoint truth is the published API
  reference at [docs.venlyfinance.com](https://docs.venlyfinance.com/api-reference).
- Transport is injected through the `VenlyClient` interface (`src/types.ts`).
  `HttpVenlyClient` is a minimal fetch-based implementation; tests inject a mock.

### Transport note

The built-in HTTP transport is minimal by design (OAuth2 client credentials,
lazy token fetch, no logging of secrets) and is fully covered by the test
suite. A future release adopts [`@venlyfinance/sdk`](../) as the transport
layer, with no change to the tool interface.

## The three tool tiers

### 1. Read tools (always on)

Call GETs only. No mutation, safe by default.

| Tool | Maps to |
|---|---|
| `list_ramp_requests` | fundflow `GET /v1/ramp-requests` |
| `get_ramp_request` | fundflow `GET /v1/ramp-requests/{id}` |
| `get_account` | finance `GET /accounts/{accountId}` |
| `list_virtual_bank_accounts` | finance `GET /accounts/{accountId}/virtual-bank-accounts` |
| `reconcile_by_reference_code` | composite: lists vIBANs, matches supplied transactions by referenceCode |
| `get_transfer` | finance `GET /accounts/{accountId}/transfers/{transferId}` |
| `list_parties` | finance `GET /parties` |
| `get_reference_data` | fundflow chains / fiat-currencies / crypto-currencies / fees |

`reconcile_by_reference_code` is the EUR vIBAN reconciliation: a customer sends
EUR to a vIBAN including a reference code in the payment; this tool fetches the
account's vIBANs and matches the observed incoming bank transactions (operator-
or feed-supplied) to the vIBAN carrying that referenceCode. It returns the
matched vIBAN, the matched transactions, and the total amount.

### 2. Write tools (present, DISARMED by default)

`stage_transfer`, `approve_ramp_request`, `reject_ramp_request`,
`create_payment_link`.

Each is dry-run by default and returns the exact request it would send. See the
safety model below.

### 3. x402 tool (position + stub)

`quote_x402_payment` returns an HTTP-402-shaped quote (price, asset, payTo,
chain) for a settlement action, following the x402 `PaymentRequirements` model.
It documents the machine-to-machine rail. It never executes a payment, never
calls a facilitator, and never moves funds. Production x402 settlement needs a
facilitator decision and live rails.

## Safety model (fail closed)

Read-only is the default posture. A write tool executes a live call ONLY when
ALL THREE hold:

1. the tool argument `confirm === true`, and
2. the environment flag `VENLY_MCP_LIVE === "1"`, and
3. credentials are present (`VENLY_CLIENT_ID` and `VENLY_CLIENT_SECRET`).

If any leg is missing, the tool returns a dry-run object describing the request
it would have sent and never touches the transport. This is proven by
`test/write-tools.test.ts`, including the critical case: `confirm:true` with
`VENLY_MCP_LIVE` unset still dry-runs and does not call the live client.

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
    "venly-settlement": {
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
    "venly-settlement": {
      "command": "node",
      "args": ["/absolute/path/to/settlement-mcp/dist/index.js"],
      "env": {
        "VENLY_FINANCE_BASE_URL": "https://api-staging.venlyfinance.com/api/v1",
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
| `VENLY_FINANCE_BASE_URL` | `https://api-staging.venlyfinance.com/api/v1` |
| `VENLY_FUNDFLOW_BASE_URL` | `https://api-fundflow-staging.venly.io` |
| `VENLY_TOKEN_URL` | `https://login.venly.io/auth/realms/VenlyFinance/protocol/openid-connect/token` |
| `VENLY_CLIENT_ID` | unset (read-only until set) |
| `VENLY_CLIENT_SECRET` | unset |
| `VENLY_MCP_LIVE` | unset (writes disarmed) |

Fundflow also exposes a QA sandbox (`https://api-fundflow-qa.venly.io`). If your
tenant uses different endpoints, override them via the env vars above.

## Enabling live writes (a deliberate operator decision)

Live writes are OFF. To arm them, the operator must:

1. set `VENLY_MCP_LIVE=1`, and
2. provide sandbox credentials `VENLY_CLIENT_ID` and `VENLY_CLIENT_SECRET`, and
3. pass `confirm: true` on the specific write tool call.

Until all three are set, every write tool dry-runs. Arming the flag and
provisioning credentials is a deliberate, human decision, not a default.

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
- `payment-link-lifecycle.md`
- `x402-quote-walkthrough.md`

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
    client/
      http-client.ts      HttpVenlyClient (fetch, OAuth, vendored transport)
    tools/
      read-tools.ts       tier 1
      write-tools.ts      tier 2 (fail closed)
      x402-tools.ts       tier 3 (stub)
  skills/
    reconcile-by-reference-code.md
    four-eyes-approval.md
    stage-and-confirm-transfer.md
    payment-link-lifecycle.md
    x402-quote-walkthrough.md
    four-eyes-approval.md
    stage-and-confirm-transfer.md
  test/
    helpers.ts            in-memory MCP harness + mock client
    read-tools.test.ts
    write-tools.test.ts   includes the critical fail-closed test
    reconcile.test.ts
    x402.test.ts
```
