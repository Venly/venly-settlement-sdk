# Changelog

## 0.3.4 – 2026-08-10

- **Unified activity.** New `UnifiedActivityBlock` in the `activity` registry
  item: one date-sorted feed over BOTH money rails – the account's transfers
  and the company's ramp requests (withdrawals, add money). A labelled Scope
  column names the account on transfer rows and says "Company-wide" on ramp
  rows (the API models ramps at company level; the feed says so instead of
  inventing linkage). Three bands – In progress (incl. on-hold) / Completed /
  Didn't complete – so a failed or refused movement never sits under a
  success header; the withdrawals table adopts the same three bands. Rejected
  renders negative and counts toward Failed; cancelled stays a neutral
  terminal. Crypto amounts are signed (settled credits carry an explicit +);
  the fiat side renders unsigned as "Converted amount" (gross – the net the
  bank receives lives on the withdrawal detail). Ramp side panel from list
  fields with a "View withdrawal" drill, type filter, unified CSV export
  (crypto and converted-amount columns), empty/filtered-empty states, and
  keyboard row stepping across the merged feed. `ActivityBlock`
  (transfers-only) remains for consumers that want a single-ledger view.
- **Long-list transfer seed batch.** The finance mock now seeds 30 additional
  completed transfers (deterministic ids and dates, generated at module init),
  so a feed built on the mock exceeds one screen and count/pagination
  behaviour is demonstrable. Existing seeds and drivers are unchanged.
- **Mock pagination default now matches the spec.** Both APIs document
  `size` defaulting to 100; the mock's list envelope defaulted to 20, which
  silently truncated any list past 20 rows (surfaced by the new seed batch).

## 0.3.3 – 2026-08-10

- **Non-parity exchange rates in the fundflow mock.** Every seed and every
  created ramp now converts at a per-pair rate (`USDC/EUR 0.92`,
  `USDC/USD 0.9996`, `EURC/EUR 0.999`) instead of 1.0. A parity rate made the
  crypto and fiat sides numerically identical and hid the unit distinction a
  money UI exists to keep visible: 1,000 USDC is not €1,000. `OFF_RAMP`
  requests convert `fiatAmount = cryptoAmount × rate`; `ON_RAMP` requests buy
  `cryptoAmount = fiatNetAmount ÷ rate`; fees stay on the fiat side; amount
  edits recompute at the rate captured on creation. Invariant tests assert the
  identities and that no seed ships a parity rate. Seed figures changed
  accordingly (e.g. the awaiting-approval withdraw seed is now 800 USDC →
  €736.00 gross − €7.36 fee = €728.64 net at 0.92).
- **Withdraw amount step names its units.** The amount field now states, at
  the field, that the entered amount is the crypto asset you send and that
  your bank receives the payout currency, with the exact amount confirmed on
  creation.

## 0.3.2 – 2026-08-09

- **Fee quotes compute from the request.** The `fees/calculate` mock returned a
  static figure regardless of the amount quoted; it now computes
  `amount × percentage` from the request (with a 400 on invalid amounts), so a
  quote-driven UI reconciles for any input. The fee amount's unit is the unit
  of the amount you quote.
- **New ramp seed:** an OFF_RAMP request awaiting its second approver,
  carrying the bank destination and deposit wallet – the opening state of a
  withdraw surface, previously undemonstrable without creating one first.

## 0.3.1 – 2026-08-09

- **New finance mock seed:** `acct-escrow` – an account whose entire balance is
  reserved (`available: 0`). The dangerous composition a balance UI must render
  honestly: zero spendable is not "no money".

## 0.3.0 – 2026-08-07

Fundflow surface release: the whitelisting-and-ramp lifecycle becomes typed and
honest in mock mode.

- **New resources on `FundflowClient`:** `bankAccounts` (list/create/get/update
  over the 7 bank-account variants; created `PENDING`, verified before use) and
  `companyWallets` (same whitelisting lifecycle). `referenceData` gains
  `depositWallets`, `bankAccountConfig`, and by-id currency lookups.
- **Stateful fundflow mock.** The ramp lifecycle now behaves like the documented
  state machine instead of echoing fixtures: approve/reject/cancel are legal only
  from `AWAITING_APPROVAL`, every mutating call carries the optimistic-locking
  `version` (stale → real 409 `OPTIMISTIC_LOCK_EXCEPTION`), amount edits recompute
  the outgoing side and record `AMOUNT_CHANGED` events, and the off-ramp tx-hash
  leg advances `AWAITING_FUNDS → PROCESSING`. Event history accretes on the
  request, so timelines render real history.
- **New mock drivers** on `client.mock`: `advanceRamp(id, to)` for the states only
  the platform can produce (`PAYMENT_RECEIVED`, `SUCCEEDED`, `FAILED`, `BLOCKED`,
  `DENIED`), `advanceBankAccountVerification(id)`, and
  `advanceCompanyWalletVerification(id)`, plus `reset()`.
- Query params now accept arrays (repeated keys), e.g. `supportedRampTypes`.
- Known contract note: the spec's bank-account `oneOf` discriminator maps DTO type
  names instead of the `bankAccountType` enum the wire sends; the SDK types
  detail responses as the base DTO plus variant fields until the spec is fixed.

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
