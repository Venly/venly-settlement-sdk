# Composition rules for coding agents

You are building a financial product UI on `@venlyfinance/react`. These rules exist because the failure modes of money UIs are specific; follow them over generic dashboard instincts.

## Non-negotiable

1. **Never hand-roll API calls, auth, retries, or transfer state.** Every read is a hook (`useAccounts`, `useTransfers`, `useRampRequests`, …); every regulated lifecycle is a flow machine (`useStagedTransfer`, `useFourEyesApproval`, `useRampLifecycle`). If you are writing `fetch` or a `useEffect` polling loop, stop – the hook exists.
2. **Wrap the tree once** in `<VenlyProvider environment="mock">`. Mock mode needs zero credentials and zero network; it is the correct default for any demo, test, or first build. Going live is a constructor change, not a rewrite.
3. **Never place `clientSecret` in browser code.** The provider throws if you try. For browser apps use `proxyClientOptions()` against your own backend route.
4. **Money movement is stage-then-confirm.** Render a review step showing `state.staged` (the exact request) before calling `confirm()`. Never wire a form submit directly to execution.
5. **Approval UIs render the rule, not the error.** Use `capability` from `useFourEyesApproval`: when `reason` is `"actor-is-creator"`, say that a second person must approve – do not show buttons that will be refused. On failure `"stale-version"`, refetch and let the operator re-decide; never auto-retry an approval.

## Rendering money states

- Use `descriptor` from `useRampLifecycle` for status pills and timelines: `intent` gives the semantic colour, but always pair colour with a glyph or label – state is never carried by colour alone.
- A waiting state must answer: must I act, who is it waiting on, what still works. `descriptor.waitingOn` and `descriptor.explanation` carry this; render them instead of a bare "Pending".
- Amounts: tabular figures, currency code after the amount, and never render a debit in red as the only signal. Empty numeric cells are an em dash, not 0.
- Terminal failure states show the reason from the record; the status field is the explanation field.

## Demo choreography (mock mode)

`useVenlyMock()` exposes the store controls. A credible end-to-end demo:
create party → `advanceVerification(id)` → create account → virtual bank account (note its `referenceCode`) → stage + confirm a transfer → `advanceTransfer(id)` → show the ledger. Inject failures with `failNext("CONFLICT")` to show the stale-version approval path – error states are part of the product.
