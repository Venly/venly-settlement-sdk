# Skill: Stage and confirm a transfer

Prepare a fiat-to-crypto transfer, review the exact request, then execute it only
behind the explicit confirm and arming gate.

## When to use

An operator needs to move funds from a sender account to a receiver, converting
fiat to crypto.

## Tools

- `get_account` (read)
- `stage_transfer` (write, disarmed by default)
- `get_transfer` (read)

## Steps

1. `get_account` for the `senderAccountId` to confirm it is active.
2. Stage the transfer: call `stage_transfer` with `senderAccountId`,
   `receiverAccountId`, `fiatAmount` (decimal string), `fiatCurrency`, and
   optionally `cryptocurrency`, `description`, `merchantReference`. Omit
   `confirm` (or set it false).
3. The tool returns a dry-run object: the exact `POST /accounts/{senderAccountId}/transfers/fiat`
   body it would send, plus the gate decision. Review the amount, currency, and
   receiver.
4. To execute live, re-call with `confirm: true` AND the server armed with
   `VENLY_MCP_LIVE=1` AND credentials present. If any leg is missing, the tool
   dry-runs again and does not touch the API.
5. After a live execution, use `get_transfer` with the returned account and
   transfer id to confirm status.

## Notes

- Dry-run first is the default and the safe path. Confirm and arming are separate,
  deliberate steps.
- Idempotency keys are handled by the transport on live POSTs.
- The fiat transfer endpoint is documented in the rebuild specs but marked a stub
  pending live annotation. Cross-check the live schema before a production run.
