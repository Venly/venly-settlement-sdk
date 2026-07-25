# Skill: Walk a ramp through four-eyes approval

Move a ramp request from `AWAITING_APPROVAL` to `AWAITING_FUNDS` (approve) or to
`REJECTED` (reject), preserving four-eyes control.

## When to use

A Company Manager created a ramp request. A Company Admin (a different identity)
must review and approve or reject it.

## Tools

- `list_ramp_requests` (read)
- `get_ramp_request` (read)
- `approve_ramp_request` (write, disarmed by default)
- `reject_ramp_request` (write, disarmed by default)

## Steps

1. `list_ramp_requests` with `status: "AWAITING_APPROVAL"` to find pending
   requests. Note `id` and `createdBy`.
2. `get_ramp_request` for the chosen `id`. Read the amounts, the `paymentReference`,
   and the `version`. The `version` is required for the optimistic-locking write.
3. Decide. Four-eyes: the approving identity must differ from `createdBy`. The
   Fundflow API enforces this; the tool surfaces the state, it does not bypass it.
4. Call `approve_ramp_request` (or `reject_ramp_request`) with `id` and the
   `version` from step 2.
   - By default the tool returns a dry-run object showing the exact POST it would
     send. Review it.
   - To execute live, all three must hold: `confirm: true`, `VENLY_MCP_LIVE=1`,
     and credentials present. Arming is a deliberate human decision.
5. On a version conflict (HTTP 409) in live mode, re-fetch with `get_ramp_request`
   to get the new `version` and retry.

## Notes

- Approve transitions `AWAITING_APPROVAL` to `AWAITING_FUNDS`. Reject transitions
  to `REJECTED`.
- The dry-run is the safe default. Read the request body before arming.
