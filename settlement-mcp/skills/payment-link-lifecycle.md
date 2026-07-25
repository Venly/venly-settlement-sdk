# Skill: Create and track a payment link

Stand up a fiat-to-crypto payment link for an account, hand the URL to a payer,
and follow the payment through to settlement.

## When to use

An operator wants to collect a fiat payment that settles as stablecoin into an
account's wallet, without building a checkout: invoicing, one-off B2B
collections, top-ups.

## Tools

- `get_account` (read)
- `list_virtual_bank_accounts` (read)
- `create_payment_link` (write, disarmed by default)
- `get_transfer` (read)

## Steps

1. `get_account` for the collecting account. Confirm `status: "ACTIVE"` - an
   unverified or suspended account cannot collect.
2. Optional context: `list_virtual_bank_accounts` shows the account's existing
   collection surfaces (IBAN + referenceCode); a payment link is the hosted
   alternative for payers who won't do a bank transfer.
3. `create_payment_link` with the `accountId` and an `externalRef` your own
   system can reconcile on later.
   - By default the tool returns a dry-run object with the exact POST it would
     send. Review it.
   - Live execution needs all three: `confirm: true`, `VENLY_MCP_LIVE=1`, and
     credentials present.
4. Share the returned `paymentUrl` with the payer. Status starts at `CREATED` /
   `PENDING_PAYMENT`.
5. After payment, the received fiat converts and lands on-chain. Track the
   resulting movement with `get_transfer` and reconcile on your `externalRef`.

## Notes

- Payment links expire (`expiresAt`); a link that was never paid ends at
  `EXPIRED`, not `FAILED`.
- Statuses walk `CREATED → PENDING_PAYMENT → PAYMENT_RECEIVED → CONVERTING →
  MINTING → COMPLETED`, with `FAILED`, `CANCELLED`, `REFUNDING`, `REFUNDED` as
  exits. Only treat `COMPLETED` as settled.
- The dry-run is the safe default. Read the request body before arming.
