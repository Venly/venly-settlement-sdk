# Skill: Run the x402 agent-payment sequence (sandbox)

Get an HTTP-402-shaped quote for a settlement action, then settle it against
the mock ledger — the full machine-to-machine sequence, end to end, with zero
credentials and zero network.

## When to use

An agent (or an operator evaluating agent payments) wants to price a
machine-to-machine settlement over the x402 rail and see the whole flow run:
quote, pay, observe the ledger move.

## The authority model, stated up front

This sequence is **delegated payment authority**: the payer's own
pre-authorized quote-and-pay call, scoped like an API key, on the payer's own
account. It is a different model from the maker/checker ceremony that governs
business-judgment decisions (KYC, reconciliation matches, payout exceptions),
where an agent may only prepare and a human's click is the only mutation.

## Tools

- `quote_x402_payment` (returns the `payment_required` envelope; never calls a
  facilitator)
- `create_fiat_transfer` / `create_crypto_transfer` (sandbox-only writes, per
  the enforced boundary: any non-sandbox base URL or credential-shaped
  parameter is refused)
- `get_reference_data` (read; chains and currencies for context)
- `get_journey_blueprint` with journey `agent-payment` (the runnable sequence,
  documented as a blueprint)

## Steps

1. Call `quote_x402_payment` with the settlement action you are pricing.
2. Read the returned `PaymentRequirements`-shaped quote:
   - `price`: the amount the counterparty would require.
   - `asset`: the settlement asset (typically USDC).
   - `payTo`: the receiving address.
   - `chain`: where settlement would occur (CAIP-2 style network reference).
3. Cross-check `chain` and `asset` against `get_reference_data` - a quote on an
   unsupported chain/currency pair is a configuration error, not an offer.
4. Pay: call the matching transfer tool carrying the quoted reference in
   `merchantReference`. The transfer lands on the mock ledger.
5. Observe: the transfer appears in the activity read; the event trail
   attributes the preparation; `verify_ledger` (simulations.ledger.verify)
   passes with the debit visible on the payer's balance.

## Notes

- No agent badge appears on the activity row, by design: the ledger contract
  carries no initiator field, so this surface does not invent one. The agent
  is attributed in the event trail, where that fact is true.
- The whole sequence runs in the mock sandbox only. LIVE x402 settlement
  requires a facilitator decision (who submits the signed payment on-chain,
  under whose licence) that deliberately sits outside this server, and the
  sandbox boundary is enforced in code: write tools refuse any non-sandbox
  base URL outright.
- The x402 pattern: a server answers `402 Payment Required` with these fields;
  the payer signs (EIP-3009/Permit2 style) and a facilitator submits on-chain.
