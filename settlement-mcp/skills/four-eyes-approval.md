# Skill: Walk a ramp through four-eyes approval

Move a ramp request from `AWAITING_APPROVAL` to `AWAITING_FUNDS` (approve) or to
`REJECTED` (reject), preserving four-eyes control.

## When to use

A Company Manager created a ramp request. A Company Admin (a different identity)
must review and approve or reject it.

## Tools

- `list_ramp_requests` (read)
- `get_ramp_request` (read)
- `approve_ramp_request` (write, mock sandbox only)
- `reject_ramp_request` (write, mock sandbox only)

## Steps

1. `list_ramp_requests` with `status: "AWAITING_APPROVAL"` to find pending
   requests. Note `id` and `createdBy`.
2. `get_ramp_request` for the chosen `id`. Read the amounts, the `paymentReference`,
   and the `version`. The `version` is required for the optimistic-locking write.
3. Decide. Four-eyes: the approving identity must differ from `createdBy`. The
   Fundflow API enforces this; the tool surfaces the state, it does not bypass it.
4. Call `approve_ramp_request` (or `reject_ramp_request`) with `id` and the
   `version` from step 2.
   - The tool executes only against the mock sandbox and refuses any non-sandbox
     base URL, in code. Live approvals belong to your own reviewed integration
     over `@venlyfinance/sdk`, behind your own ceremony.
5. On a version conflict (HTTP 409), re-fetch with `get_ramp_request` to get the
   new `version` and re-decide against fresh state.

## Notes

- Approve transitions `AWAITING_APPROVAL` to `AWAITING_FUNDS`. Reject transitions
  to `REJECTED`.
- Approving and rejecting are business-judgment decisions: the checker's click is
  the mutation. An agent may prepare the decision; it never applies one.
