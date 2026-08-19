# Changelog

## 0.7.0 – 2026-08-19

The MCP now pushes a machine-checkable runtime contract instead of relying on
agents to discover composition guidance through optional pull surfaces.

- The initialize response carries server instructions that establish
  `@venlyfinance/react` hooks and flow machines as the browser data plane,
  `@venlyfinance/sdk` as the server data plane, and the shadcn registry as the
  UI installation path.
- Every `get_journey_blueprint` response keeps its prose blueprint and adds the
  same `runtime_contract` as fenced JSON and `structuredContent`: exact registry
  dependencies, qualified hook imports, provider configuration, forbidden
  hand-rolled patterns, install commands, and completion gates.
- New deterministic `verify` CLI and `verify_runtime_contract` MCP tool with
  auto-detected `direct-sdk` and `backend-proxy` profiles. Exit codes match the
  `review` CLI (0 clean, 1 on errors, 2 on usage/no-match), and
  `venly-allow:<rule-id>` suppressions work on verifier findings.
- Money-route-without-SDK, in-memory-money-store, and direct-profile missing
  React checks remain warning-only pending a false-positive-boundary ruling.
- Requires `@venlyfinance/sdk` ^0.5.0.

## 0.3.0 – 2026-08-04

Wording-is-the-safety-surface release. An outside integrator audit (2026-08-04) found the server's words disagreeing with its behavior in three
places; all fixed, plus the SDK under the mock now teaches the documented
lifecycle (see @venlyfinance/sdk 0.2.0).

### Changed

- **Default environment is `mock`** (was `staging`). A mock-first product must
  not point at real infrastructure when unconfigured. Set `VENLY_ENV=staging`
  or `production` explicitly for real calls; the safety resource and README
  say so.
- **State-accurate startup banner.** Mock: "writes execute against local
  fixtures - no network, no credentials, nothing real". Staging/production
  disarmed: "mutations return dry-run previews". Armed: "confirmed writes hit
  the live API". No more "DISARMED" next to a write that visibly executes.
- **Explicit `dryRun: true|false` on every mutation result** - agents no longer
  infer persistence from `mode`.
- **`reconcile_by_reference_code` reads real remittance text**: matching is
  case- and separator-insensitive, transactions match by containment
  ("invoice ref abc 123 ty" finds REF-ABC-123), and codes under 4 alphanumeric
  characters are refused.
- **Receiver XOR enforced**: `create_fiat_transfer` / `create_crypto_transfer`
  reject a transfer with zero or two receivers (exactly one of
  `receiverAccountId` / `receiverExternalId`), stated in the tool schema.
- Requires `@venlyfinance/sdk` ^0.2.0: in mock mode, created parties/accounts
  start verification-pending (`mock.advanceVerification`), transfers start
  `PENDING` (`mock.advanceTransfer`), and request bodies are spec-validated.

### Deprecated

- **`stage_transfer`** is now plainly marked deprecated (legacy alias of
  `create_fiat_transfer`); it will be removed in 0.4.0.

## 0.2.0 – 2026-08-03

The Settlement MCP becomes the SDK-backed **Venly Finance MCP** builder while retaining
its package name and compatibility binary throughout the 0.x line.

### Added

- 23 atomic read, write, reconciliation, and quote tools covering the first
  international-account builder journey.
- Explicit `mock`, `staging`, and `production` environments with synthetic mock writes
  and a separate production-write flag.
- Discoverable capability, safety, international-account, and mock-to-staging
  resources.
- The `build_international_account` MCP prompt and matching portable workflow skills.
- Machine-readable structured tool results with credential and token redaction.
- `createServer` refuses to start when an injected client declares an environment that
  disagrees with `VENLY_ENV`: the mock gate auto-arms writes, so the two must never
  diverge.
- A zero-network golden journey covering party, account, wallet, EUR receiving account,
  transfer, history, and reconciliation behavior.
- Compile-time assertions that MCP payload types remain exact aliases of the generated
  Finance and Fundflow SDK contracts.

### Changed

- Finance and Fundflow execution now uses `@venlyfinance/sdk`; the duplicate HTTP,
  OAuth, retry, and hand-written API type implementation was removed.
- `venly-finance-mcp` is the preferred binary. `venly-settlement-mcp` remains an alias
  to the same server.
- The minimum Node.js version is 20.
- The official MCP SDK is upgraded to 1.30.0 and resolves Hono 2.0.12.

### Deprecated

- `stage_transfer` remains available for 0.x compatibility but normalizes its legacy
  fields into the current Finance transfer contract. Its dry-run now previews the exact
  normalized request a live call sends, a caller-supplied idempotency key survives
  normalization, and the retired `cryptocurrency` field is rejected with guidance
  instead of silently dropped. New integrations should use `create_fiat_transfer`.

### Safety and product boundaries

- Live writes remain dry-run unless confirmation, credentials, and the environment
  flags are present; production requires an additional explicit flag.
- Creating a party does not complete KYC/KYB. Live EUR receiving-account provisioning
  requires an eligible verified account.
- The MCP does not imply universal bank-account coverage, a bank charter, card issuing,
  external-bank payouts, or autonomous production money movement.

### Security

- Runtime dependency audits report zero findings after the MCP SDK/Hono upgrade.

## 0.4.0 – 2026-08-07

Frontend toolset: the judgment layer for interface assembly.

- `get_journey_blueprint` – screen inventory, required states, registry items and binding hooks for eight money-product journeys.
- `review_screen` – deterministic design audit (raw colours, hyphen-minus amounts, success styling on cancelled steps, masked review values, zebra striping, off-token shadows, gradients, colour-only state). Findings, not a score.
- `venly://frontend/agents` resource – composition rules plus the @venlyfinance shadcn-registry wiring (delivery of UI source rides the registry standard; these tools carry what a registry cannot).
- `build_international_account` prompt now assembles the interface from the registry and gates every screen on `review_screen`.

### Removed

- **`stage_transfer`**, as promised in 0.3.0's deprecation: use `create_fiat_transfer`, whose inputs match the OpenAPI contract directly. The skills pack is updated accordingly.

## 0.4.1 – 2026-08-07

- `venly://frontend/agents` now carries the full cold-start recipe, learned from a fresh-agent build run: Tailwind + path-alias prerequisites before `shadcn init`, the non-interactive `-y -b radix -p nova` flags, that blocks land under `components/venly/` at the project root (relative imports, not the `@/` alias), that `shadcn add` auto-installs the npm dependencies, and the `.js`-extension bundler note.

## 0.5.0 – 2026-08-14 (backfill; published 2026-08-15)

Entry added retroactively in 0.6.0 – the publish predates it.

- Nine payout tools over the re-vendored finance contract (payouts, payout routes +
  ownership proof, party payout bank accounts), fail-closed writes.
- Corrected capabilities text; react/ui alignment with the 0.4.0 SDK line.

## 0.6.0 – 2026-08-18

`review_screen` grows teeth: five new rule classes, a suppression hatch, and a CI-runnable command.

- New error rules: `invented-timing-claim` (copy promising durations, settlement windows
  or custody behaviour no API in this stack returns), `intl-currency-crypto`
  (`Intl.NumberFormat` + `style:"currency"` + a crypto code throws `RangeError` at render;
  a variable-fed `currency:` in the same call is a warn), `required-rendered-optional`
  (the payment reference labelled "(not required)"), `parity-fixture` (seeded 1:1
  exchange rates).
- New warn rules: `blueprint-state-missing` (pass the new optional `journey` argument to
  `review_screen` and the audit lists blueprint-named states not found in the source) and
  `round-number-coincidence` (three or more `x.00` amounts seeded in one source).
- Suppression hatch on every rule, old and new: `venly-allow:<rule-id>` on the offending
  line or the line above drops the finding silently.
- Copy-judging rules skip comment lines – a comment documenting a rule must not trip it.
- Findings now carry a 1-based `line`.
- New `review` CLI over the same audit: `npx @venlyfinance/settlement-mcp review "src/**/*.tsx"`
  exits 1 on any error-severity finding (0 otherwise, 2 on usage errors/no matches), with
  self-expanded globs and zero dependencies. Added a `settlement-mcp` bin alias so the
  npx form resolves under npm's unscoped-name rule. This repo's CI now runs the command
  over its own registry and example sources.
