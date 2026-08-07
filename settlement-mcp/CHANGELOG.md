# Changelog

## 0.3.0 – 2026-08-04

Wording-is-the-safety-surface release. An outside integrator audit (Report 1,
2026-08-04) found the server's words disagreeing with its behavior in three
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
