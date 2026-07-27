# Changelog

## 0.1.2 – unreleased

Metadata only, no functional change: `homepage` now points at https://docs.venlyfinance.com (was the GitHub repo URL, which npm surfaced prominently).

## 0.1.1 – 2026-07-25

Full realignment to the **live published OpenAPI specs** (Finance v1.1.0, Fundflow v1.7.0, both vendored from docs.venlyfinance.com). v0.1.0's finance types were generated from a stale spec snapshot; a routine cross-check against the published docs caught the drift before any integrator did. Mock mode was unaffected in spirit but its fixtures now match the live schemas exactly.

### Fixed (live-path breaking in 0.1.0)

- **Base URL**: finance requests now target `https://api.venlyfinance.com/v1` (was `/api/v1`, which 404s on every call).
- **Staging auth host**: `login-staging.venly.io` (was `login-sandbox.venly.io`).
- **Error presets**: the Finance API emits kebab-case error codes (`invalid-request`, `concurrent-modification`, `insufficient-funds`, …). Preset *names* are unchanged; the thrown `code` values now match each API.

### Added

- `paymentRequests.settle(id, body)` / `settleByReference(body)` – settlement moves escrow to the settlement wallet (`202`, `SETTLING` → `SETTLED`).
- `paymentRequests.reverse(id, body)` / `reverseByReference(body)` – void/refund with a typed `ReversalReason`.
- `paymentRequests.update(id, body)` – adjust a reservation before settlement.
- `paymentSessions.create(accountId, body)` – hosted fiat-to-crypto pay-in sessions (replaces payment links).
- Error presets `INSUFFICIENT_FUNDS` (402) and `IDEMPOTENCY_CONFLICT` (422) for the finance mock.

### Changed

- `PaymentRequest.amount` is now the documented `{ fiat, crypto }` object (was a plain number), plus `originalAmount`, `settlementAmount`, `executions[]` with on-chain transaction hashes.
- `Wallet` now carries `type`, `amlStatus` and per-asset `balances[].amount.{total, available, reserved}`.
- `Account` gained `name`, `kycStatus`, `version`; `parties.update` requires the optimistic-locking `version`.
- Virtual bank accounts are EUR SEPA (`bankAccountType: "EUR_SEPA"`) per the live spec.

### Removed (absent from the live Finance API)

- `paymentLinks` (superseded by `paymentSessions`), `accountToAccountTransfers`, `accounts.update/delete/suspend/reactivate`, `wallets.create/get` (wallets are auto-provisioned with the account and read via `wallets.list`), `parties.listAccounts`.
- Anything removed here is still reachable via the `request()` escape hatch if your tenant has access to an undocumented endpoint.

## 0.1.0 – 2026-07-25

First public release: typed Finance + Fundflow clients, OAuth2 client-credentials auth with single-flight refresh, auto idempotency keys, retries with `Retry-After`, pagination iterators, dual ESM/CJS build, and a zero-network mock mode (`environment: "mock"`) with call log and error injection.
