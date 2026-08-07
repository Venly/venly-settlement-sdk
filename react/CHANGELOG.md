# Changelog

## 0.1.0

Initial release.

- `<VenlyProvider>` for mock / staging / production, with a browser guard that refuses to construct credentialed clients in a bundle.
- Read hooks for parties, accounts, wallets, virtual bank accounts, transfers, ramp requests, reference data, and fee quotes; write hooks for the create operations; `venlyKeys` / `venlyQueries` factories underneath.
- Flow machines: `useStagedTransfer` (stage-then-confirm with the idempotency key pinned at staging), `useFourEyesApproval` (optimistic-locking version carried through, 409 → `"stale-version"`), `useRampLifecycle` (status descriptors answering must-I-act / waiting-on / what-still-works).
- `proxyClientOptions()` for the browser-safe production shape.
- 28 node:test cases against the SDK's mock transport; zero network.
