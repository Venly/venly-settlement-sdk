# Composition rules for coding agents

You are building a financial product UI on `@venlyfinance/react`. These rules exist because the failure modes of money UIs are specific; follow them over generic dashboard instincts.

## Non-negotiable

1. **Never hand-roll API calls, auth, retries, or transfer state.** Every read is a hook (`useAccounts`, `useTransfers`, `useRampRequests`, …); every regulated lifecycle is a flow machine (`useStagedTransfer`, `useFourEyesApproval`, `useRampLifecycle`). If you are writing `fetch` or a `useEffect` polling loop, stop – the hook exists.
2. **Wrap the tree once** in `<VenlyProvider environment="mock">`. Mock mode needs zero credentials and zero network; it is the correct default for any demo, test, or first build. Going live is a constructor change, not a rewrite.
3. **Never place `clientSecret` in browser code.** The provider throws if you try. For browser apps use `proxyClientOptions()` against your own backend route.
4. **Money movement is stage-then-confirm.** Render a review step showing `state.staged` (the exact request) before calling `confirm()`. Never wire a form submit directly to execution.
5. **Approval UIs render the rule, not the error.** Use `capability` from `useFourEyesApproval`: when `reason` is `"actor-is-creator"`, say that a second person must approve – do not show buttons that will be refused. On failure `"stale-version"`, refetch and let the operator re-decide; never auto-retry an approval.
6. **Gate both the screen and its runtime contract, and wire both into CI.** Run `npx @venlyfinance/settlement-mcp review "src/**/*.tsx"` for the design contract and `npx @venlyfinance/settlement-mcp verify "src/**/*.{ts,tsx}"` for package/provider/hook/proxy composition. Each fails (exit 1) on any error-severity finding. A deliberate, justified exception carries `venly-allow:<rule-id>` on the offending line or the line above.

## Rendering money states

- Use `descriptor` from `useRampLifecycle` for status pills and timelines: `intent` gives the semantic colour, but always pair colour with a glyph or label – state is never carried by colour alone.
- A waiting state must answer: must I act, who is it waiting on, what still works. `descriptor.waitingOn` and `descriptor.explanation` carry this; render them instead of a bare "Pending".
- Amounts: tabular figures, currency code after the amount, and never render a debit in red as the only signal. Empty numeric cells are an em dash, not 0.
- Terminal failure states show the reason from the record; the status field is the explanation field.

## Bring your own auth

The Venly APIs authenticate machines (OAuth2 client credentials), not people: there is no end-user login, sign-up, session, password, or MFA endpoint in either API, by design. **The Venly APIs never see end-user credentials.** End-user auth is your identity layer's job; the sanctioned browser shape is a backend proxy that inherits YOUR app's session (`proxyClientOptions()`), never Venly's.

The UI kit's auth and team blocks therefore render against two adapter interfaces, `AuthAdapter` and `TeamAdapter`, instead of an SDK client:

- **Real implementations** wrap what you already run: OAuth/OIDC, Better Auth, Auth0, Clerk, Keycloak, or a plain session cookie. Implement `signIn`/`verifyTotp`/`signUp`/`session`/`signOut` (and the team CRUD) over your provider's SDK.
- **Session-expiry contract:** `session()` returns `null` once the session has expired for any reason. The shell treats null as signed-out and redirects to sign-in; no other expiry signal exists in the interface.
- **Mock adapters ship with the blocks** (`createMockAuthAdapter`, `createMockTeamAdapter`): zero credentials, deterministic 2FA code `000000`, an `expireSession()` driver, and invites that mint a display-only link – the mock never claims an email was sent.
- Password reset, SSO buttons, and passkeys are provider features: point users at your provider's flow rather than rebuilding it behind the adapter.

## Demo choreography (mock mode)

`useVenlyMock()` exposes the store controls. A credible end-to-end demo:
create party → `advanceVerification(id)` → create account → virtual bank account (note its `referenceCode`) → **fund it: `simulations.inbound.credit(vbaId, 500)`** (a new account holds nothing, as in production; an unfunded transfer is refused with `402 insufficient-funds`) → stage + confirm a transfer → `advanceTransfer(id)` → show the ledger, and `simulations.ledger.verify()` to prove it balances. Inject failures with `failNext("CONFLICT")` to show the stale-version approval path – error states are part of the product.

## Agent-operable choreography (mock mode)

Two authority models, never blurred:

- **Business-judgment decisions are maker/checker.** An agent (any MCP client on `@venlyfinance/settlement-mcp`) prepares a decision draft with `prepare_decision` – or the simulator plays that seat with `simulations.decision.prepare({ recordType, recordId, proposal, reason, evidenceRefs })`. The draft renders in the console decision panel badged as a sandbox agent draft; nothing changes until the human decides through the existing ceremony, which marks the draft superseded. Drafts never auto-apply.
- **The x402 agent payment is delegated payment authority** – the payer's own pre-authorized spend, runnable end to end in a mock MCP session: `quote_x402_payment` → the `payment_required` envelope → `create_fiat_transfer` (or `create_crypto_transfer`) carrying the quoted reference in `merchantReference` → the transfer renders in activity like ANY transfer (no agent badge by design: the ledger contract has no initiator field, so none is invented – the event trail attributes the session) → `simulations.ledger.verify()` still passes.

A Node MCP session and a browser tab do NOT share a mock world (state channels are in-memory or same-origin BroadcastChannel). In a browser demo, the simulator plays the agent seat through `simulations.decision.prepare` the same way it plays the bank through `simulations.inbound.credit`.
