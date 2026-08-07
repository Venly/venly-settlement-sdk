# Changelog

## 0.1.0

Initial release.

- `<VenlyProvider>` for mock / staging / production, with a browser guard that refuses to construct credentialed clients in a bundle.
- Read hooks for parties, accounts, wallets, virtual bank accounts, transfers, ramp requests, reference data, and fee quotes; write hooks for the create operations; `venlyKeys` / `venlyQueries` factories underneath.
- Flow machines: `useStagedTransfer` (stage-then-confirm with the idempotency key pinned at staging), `useFourEyesApproval` (optimistic-locking version carried through, 409 → `"stale-version"`), `useRampLifecycle` (status descriptors answering must-I-act / waiting-on / what-still-works).
- `proxyClientOptions()` for the browser-safe production shape; its placeholder credential is the exported `VENLY_PROXY_SECRET_SENTINEL`, which the browser guard recognises as not-a-secret.
- The browser guard covers every path a secret can take into the provider: the top-level prop and both per-client options objects.
- 30 node:test cases against the SDK's mock transport; zero network.
