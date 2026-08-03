# Changelog

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
  fields into the current Finance transfer contract. New integrations should use
  `create_fiat_transfer`.

### Safety and product boundaries

- Live writes remain dry-run unless confirmation, credentials, and the environment
  flags are present; production requires an additional explicit flag.
- Creating a party does not complete KYC/KYB. Live EUR receiving-account provisioning
  requires an eligible verified account.
- The MCP does not imply universal bank-account coverage, a bank charter, card issuing,
  external-bank payouts, or autonomous production money movement.

### Security

- Runtime dependency audits report zero findings after the MCP SDK/Hono upgrade.
