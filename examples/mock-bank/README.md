# Mock Bank

A runnable international-account experience assembled from [`@venlyfinance/react`](../../react/README.md) and the [ui kit](../../ui/README.md): balances, activity ledger with a detail panel, stage-then-confirm sending, and a receive surface with mandatory-reference enforcement.

**Everything here is fake and local.** The app runs on `<VenlyProvider environment="mock">`: zero credentials, zero network calls, seeded fixture data from the SDK's mock store. Nothing you do in it touches any real system. The same code flips to staging or production by changing the provider's environment and supplying credentials server-side – see the react README's "Going live".

```bash
npm install
npm run dev     # opens on http://localhost:4310
```

Things to try:

- **Activity** – click a row: the detail panel opens beside the table (never navigates); the failed transfer's panel carries the failure reason on its timeline.
- **Send** – fill the form, review the staged request (the button restates the amount), confirm once; the transfer appears in Activity as Pending. Double-clicking confirm cannot double-spend – the idempotency key is pinned at the review step.
- **Receive** – the payment reference row carries the Required pill; every copy names the field it copied.
- **Team** – member statuses as word + glyph, role changes in the row, your own row's controls locked with the reason; invites mint a display-only link (the mock never claims an email went out).
- **Bank accounts** – the whitelist withdrawals depend on: rows carry their verification status verbatim; the add form asks exactly the fields the chosen account type requires and makes you re-enter the identifier.
- **Withdraw** – pick a verified destination (unverified ones are disabled with the reason), type an amount and watch the fee quote compute from it, review only the figures that exist, create, then approve as a second pair of eyes; the created record carries the full fiat arithmetic.

The UI files are imported straight from [`ui/registry/`](../../ui/registry/) – the copy-owned kit, used in place. `npm run typecheck` and `npm run build` verify the app against the published packages.
