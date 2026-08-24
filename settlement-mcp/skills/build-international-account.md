# Build an international account experience

Use this skill when a user asks an AI coding agent to build an international account,
stablecoin account or neobank-like customer experience with Venly Finance.

## Rules

1. Read `venly://capabilities`, `venly://safety` and
   `venly://workflows/international-account` when MCP resources are supported.
2. Start with `VENLY_ENV=mock`; label every simulated state.
3. Use `@venlyfinance/sdk` only in server-side application code. Never expose Venly
   credentials or access tokens to the browser.
4. Assemble atomic capabilities: party, account, auto-provisioned wallet/balances, EUR
   receiving account, transfer, status and reconciliation.
5. Creating a party does not complete KYC/KYB. Show returned compliance states.
6. Venly provides infrastructure through regulated partners. Do not imply a bank
   charter, deposit insurance or unsupported geographic/currency coverage.
7. Card issuing is not exposed by the current Finance OpenAPI contract.
8. Ask for an explicit decision before moving to staging. This MCP's write/prepare
   tools stay sandbox-only in every environment (refused in code against a
   non-mock base URL); live mutations belong to the app's own reviewed
   integration over `@venlyfinance/sdk`.

## Outcome

Produce a credible customer-facing money-product experience and a README documenting
the mock setup and explicit staging transition. Do not build a generic infrastructure
dashboard or hide financial mutations inside one autonomous operation.
