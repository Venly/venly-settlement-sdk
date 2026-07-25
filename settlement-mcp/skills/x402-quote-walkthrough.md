# Skill: Read an x402 settlement quote

Get an HTTP-402-shaped quote for a settlement action and understand what each
field commits to, without moving any funds.

## When to use

An agent (or an operator evaluating agent payments) wants to know what a
machine-to-machine settlement over the x402 rail would cost and where it would
pay, before any decision to execute anything.

## Tools

- `quote_x402_payment` (stub - never executes, never calls a facilitator)
- `get_reference_data` (read; chains and currencies for context)

## Steps

1. Call `quote_x402_payment` with the settlement action you are pricing.
2. Read the returned `PaymentRequirements`-shaped quote:
   - `price`: the amount the counterparty would require.
   - `asset`: the settlement asset (typically USDC).
   - `payTo`: the receiving address.
   - `chain`: where settlement would occur (CAIP-2 style network reference).
3. Cross-check `chain` and `asset` against `get_reference_data` - a quote on an
   unsupported chain/currency pair is a configuration error, not an offer.
4. Stop. This tool states Venly's position on the x402 rail; it does not settle.

## Notes

- Position of record: the MCP is the human-gated operator surface; x402 is the
  machine-to-machine rail. This server ships the quote shape so integrators can
  build against it today.
- Live x402 settlement requires a facilitator decision (who submits the signed
  payment on-chain, under whose licence) that deliberately sits outside this
  server. No `confirm` flag, no env var, and no credential arms this tool into
  executing - it has no execution path.
- The x402 pattern: a server answers `402 Payment Required` with these fields;
  the payer signs (EIP-3009/Permit2 style) and a facilitator submits on-chain.
