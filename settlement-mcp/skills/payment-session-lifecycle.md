# Skill: Create and track a fiat-to-crypto payment session

Stand up a hosted pay-in session for an account, hand the URL to a payer,
and follow the payment through to settlement.

## When to use

An operator wants to collect a fiat payment that settles as stablecoin into an
account's wallet, without building a checkout: invoicing, one-off B2B
collections, top-ups.

## Tools

- `get_account` (read)
- `list_virtual_bank_accounts` (read)
- `create_payment_session` (write, mock sandbox only)
- `get_transfer` (read)

## Steps

1. `get_account` for the collecting account. Confirm `status: "ACTIVE"` - an
   unverified or suspended account cannot collect.
2. Optional context: `list_virtual_bank_accounts` shows the account's existing
   collection surfaces (IBAN + referenceCode); a payment session is the hosted
   alternative for payers who won't do a bank transfer.
3. `create_payment_session` with the `accountId`, a `callbackUrl` your system
   will receive the completion webhook on, and an `externalRef` you can
   reconcile on later. An `idempotencyKey` is generated when you don't pass one.
   - The tool executes against the mock fixtures only and refuses any
     non-sandbox base URL in code. Live sessions belong to your own reviewed
     integration over `@venlyfinance/sdk`.
4. Share the returned `paymentUrl` with the payer. Status starts at `CREATED` /
   `PENDING_PAYMENT`.
5. After payment, the received fiat converts and lands on-chain. Track the
   resulting movement with `get_transfer` and reconcile on your `externalRef`.

## Notes

- Payment sessions expire (`expiresAt`); a session that was never paid ends at
  `EXPIRED`, not `FAILED`.
- Statuses walk `CREATED → PENDING_PAYMENT → PAYMENT_RECEIVED → CONVERTING →
  MINTING → COMPLETED`, with `FAILED`, `CANCELLED`, `REFUNDING`, `REFUNDED` as
  exits. Only treat `COMPLETED` as settled.
- Sandbox-only is enforced in code, not a convention: a session against a
  non-mock base URL is refused before any request is built.
