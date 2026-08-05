# Changelog

## 0.2.0 – 2026-08-04

Mock-fidelity release. An outside integrator built a six-journey reference app on
0.1.2 and audited both packages; every P0/P1 SDK finding from that report lands
here. The theme: **mock mode no longer teaches things that are not true.**

### Changed (mock behavior - the point of the release)

- **Verification starts pending.** `parties.create` returns
  `kycStatus: "VERIFICATION_PENDING"` (individuals) / `kybStatus: "PENDING"`
  (organisations), and `accounts.create` returns `VERIFICATION_PENDING` - matching
  the documented lifecycle where a Venly admin completes verification. Advance it
  deliberately with `mock.advanceVerification(id, status?)`.
- **Mock mode is stateful.** Creates mint real ids and persist; `get()`/`list()`
  return the records you created. Unknown ids return 404 with per-entity error
  codes instead of echoing a fixture.
- **Transfers start `PENDING`** with no `transactionHash`, and
  `mock.advanceTransfer(id, "COMPLETED" | "FAILED")` drives the status transition -
  so polling logic can finally be exercised in mock.
- **Request bodies are spec-validated.** Unknown top-level fields, unknown nested
  keys, and missing required fields are rejected with 400 `invalid-request` naming
  the offending field (generated from the vendored OpenAPI specs at build time).
  Party creation is `partyType`-aware: INDIVIDUAL requires `firstName`/`lastName`,
  ORGANISATION requires `name`, cross-type fields are rejected.
- **Fixture hygiene.** `transfers.list` filters by the path account and honors
  `accountRole`/`status`; vIBANs and wallets no longer leak across accounts (each
  seeded account has its own wallet); all seeded transfers carry
  `receiverAccountId`; create responses carry only fields the response schema
  declares (no more `inCurrency` or request-only echoes); a transfer to nobody -
  or to two receivers - is rejected (exactly one of `receiverAccountId` /
  `receiverExternalId`).
- **Account creation provisions a wallet** as a side effect, like the live API;
  a fresh wallet holds zero balances.

### Added

- `mock.advanceVerification(id, status?)`, `mock.advanceTransfer(id, status?)`,
  `mock.reset()` on the finance client's `mock` controls (`VenlyFinanceMock`).
- **Named domain types**: `Party`, `Account`, `Wallet`, `Transfer`,
  `VirtualBankAccount`, `PaymentRequest`, `CreateFiatTransferInput`, and friends
  are exported directly - no more `FinanceComponents["schemas"]["Party"]`.
- `"./package.json"` export, so tooling can read the SDK version.
- `VenlyEnvironment` (`"production" | "staging" | "mock"`); mock options now
  accept (and ignore) credential fields, so one options object varies only its
  `environment` string across all three environments.

### Fixed

- **One idempotency key per request.** On the ten endpoints whose bodies carry
  `idempotencyKey`, the body key and the auto-generated `Idempotency-Key` header
  are now always the same value (body wins; a missing body key is filled from the
  per-call option or a fresh UUID). Previously one request carried two different
  keys with undefined dedupe semantics.

### Compatibility

- Live-API behavior is unchanged. Code written against 0.1.x mock mode that
  relied on instant `VERIFIED`, terminal `COMPLETED` transfers, fixture-echoed
  ids, or unvalidated bodies will see the new honest behavior - that is the fix.
  The static `financeRoutes` export is deprecated; construct
  `FinanceMockTransport` instead.

## 0.1.2 – 2026-08-03

Compatible maintenance release supporting the Venly Finance MCP builder launch.

### Changed

- Corrected repository, homepage, and issue-tracker metadata to the public
  `Venly/venly-settlement-sdk` repository.
- Limited the published `specs/` payload to OpenAPI YAML contracts so internal feature
  planning documents do not enter the npm tarball.
- Repositioned the repository documentation around the SDK-backed Venly Finance builder
  journey while preserving the existing SDK API.

### Security

- Refreshed the OpenAPI generation toolchain lockfile to patched Redocly, `js-yaml`,
  and `brace-expansion` releases. The full development dependency audit reports zero
  findings.

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
