# Skill: Stage and confirm a transfer

Create an account-to-account transfer in the mock sandbox and track its status.

## When to use

An operator needs to move funds from a sender account to a receiver in the
sandbox world (a demo, a test, an agent-driven run).

## Tools

- `get_account` (read)
- `create_fiat_transfer` (write, mock sandbox only)
- `get_transfer` (read)

## Steps

1. `get_account` for the `senderAccountId` to confirm it is active.
2. Call `create_fiat_transfer` with `senderAccountId`, exactly one of
   `receiverAccountId` / `receiverExternalId`, `currency`, `amount`, and
   optionally `description` and `merchantReference`.
3. The transfer executes against the mock fixtures and returns the created
   record (status `PENDING`). The tool refuses any non-sandbox base URL in
   code - live transfers belong to your own reviewed integration over
   `@venlyfinance/sdk`.
4. Use `get_transfer` with the returned account and transfer id to track status.

## Notes

- Supply a stable `idempotencyKey` when you want a retried call to replay the
  same record instead of creating a second one.
- In a live integration, keep the stage-then-confirm ceremony in YOUR app:
  render the exact request for review before executing it.
