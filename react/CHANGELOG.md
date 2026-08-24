# Changelog

## 0.1.0

Initial release.

- `<VenlyProvider>` for mock / staging / production, with a browser guard that refuses to construct credentialed clients in a bundle.
- Read hooks for parties, accounts, wallets, virtual bank accounts, transfers, ramp requests, reference data, and fee quotes; write hooks for the create operations; `venlyKeys` / `venlyQueries` factories underneath.
- Flow machines: `useStagedTransfer` (stage-then-confirm with the idempotency key pinned at staging), `useFourEyesApproval` (optimistic-locking version carried through, 409 → `"stale-version"`), `useRampLifecycle` (status descriptors answering must-I-act / waiting-on / what-still-works).
- `proxyClientOptions()` for the browser-safe production shape; its placeholder credential is the exported `VENLY_PROXY_SECRET_SENTINEL`, which the browser guard recognises as not-a-secret.
- The browser guard covers every path a secret can take into the provider: the top-level prop and both per-client options objects.
- 30 node:test cases against the SDK's mock transport; zero network.

## 0.1.1

- Fix: `useStagedTransfer` stuck in "submitting" under React StrictMode – the hook cleanup's `dispose()` left the controller permanently dead for the remount, so `confirm()`'s continuation dropped its state updates. A new subscription now revives the controller. Found by driving the flow in a real browser; regression test added.

## 0.2.0 – 2026-08-07

*(Entry backfilled 2026-08-15 – this release shipped without a changelog note.)*

- Read hooks for the fundflow company surface: `useCompanyBankAccounts`,
  `useCompanyBankAccount`, `useCompanyWallets`, `useBankAccountConfig`,
  `useDepositWallets`, `useRampPairs`, `useCompanyFees`.
- Write hooks with cache invalidation: `useCreateCompanyBankAccount`,
  `useCreateCompanyWallet`, `useSetRampAmount`, `useInitiateRamp`.
- Matching `venlyKeys` / `venlyQueries` factories for every new read.

## 0.3.0 – 2026-08-14

*(Entry backfilled 2026-08-15 – this release shipped without a changelog note.)*

- **BREAKING (inherited from `@venlyfinance/sdk` 0.4.0 / contract 1.3.0):**
  the `Wallet` type no longer exists – `wallets.list` returns per-asset
  `WalletBalance` rows and this package re-exports `WalletBalance` instead.
  Monetary amounts are JSON numbers.
- Re-exports the payout types (`Payout`, `PayoutRoute`, `PayoutBankAccount`)
  shipped by sdk 0.4.0.
- Requires `@venlyfinance/sdk` ^0.4.0.

## 0.4.0 – 2026-08-15

- New read hooks: `useSupportedAssets()` (tenant-wide assets, each with its
  on-chain `decimals` – the render contract for amounts; cached hard) and
  `useAccountSupportedAssets(accountId)` (adds per-asset `permitStatus`,
  not frozen because status moves while an asset activates).
- `venlyKeys.supportedAssets()` / `venlyKeys.accountSupportedAssets(id)` and
  matching `venlyQueries` factories; the account-scoped key shares the
  `["venly", "account", id]` prefix so account invalidations reach it.
- Requires `@venlyfinance/sdk` ^0.5.0 (the `supportedAssets` resource).

## 0.5.0 – 2026-08-21

*(Entry backfilled 2026-08-21 – this release shipped without a changelog note.)*

- `useTransfersForPeriod(accountId, period)`: every transfer whose `createdAt`
  falls in the period, plus the account's full ledger after paging to
  completion (the list contract has no date filter), so opening/closing
  balances can be walked from the current wallet total. Backed by the exported
  `collectTransfersForPeriod` helper and the `venlyKeys.transfersForPeriod`
  key.
- New exported types: `TransferPeriod`, `TransfersForPeriodPage`.

## 0.6.0 – 2026-08-21

- `usePartyIvVerification(partyId)`: the party's identity-verification state,
  read off the contract operation (`getPartyIvVerification`, sdk 0.7.0).
  `NOT_LINKED` resolves like any other state.
- Payout read hooks over client methods that already existed but had no hook:
  `usePayouts(accountId, query?)`, `usePayout(accountId, payoutId)`,
  `usePayoutRoutes(accountId, query?)`, `usePayoutBankAccounts(partyId, query?)`.
- Matching `venlyKeys` / `venlyQueries` factories; the party-scoped keys share
  the `["venly", "party", id]` prefix and the account-scoped keys the
  `["venly", "account", id]` prefix, so existing invalidations reach the new
  reads.
- New exported types: `PartyIvVerification`, `PayoutsQuery`,
  `PayoutRoutesQuery`, `PayoutBankAccountsQuery`.
- Write hooks for the send surface: `useCreateFiatTransfer` and
  `useCreateCryptoTransfer` (typed entries into the staged-transfer machine –
  the idempotency key is minted once per staged draft, so a retry replays the
  same record), `useRequestPayout`, `useRegisterPayoutBankAccount`,
  `useCreatePayoutRoute`, `usePreparePayoutOwnershipProof`,
  `useCompletePayoutOwnershipProof`, `useAddPartyRole`; plus the
  `usePartyRoles(accountId, query?)` read with its `venlyKeys` /
  `venlyQueries` factory. New exported types: `PartyRolesQuery`,
  `FiatTransferDraft`, `CryptoTransferDraft`.
- Requires `@venlyfinance/sdk` ^0.7.0 (the `parties.ivVerification` method).
  The manifest range moves with the publish, alongside the lockfile
  regeneration, per this repo's publish sequencing.

## 0.6.1 – 2026-08-24

- The runtime `@venlyfinance/sdk` range moves to `^0.8.0` so an app on the
  current sdk installs one flat copy (a `^0.7.0` range beside an app's
  `^0.8.0` pin nests a second sdk under this package and splits the mock
  world). No code change.
