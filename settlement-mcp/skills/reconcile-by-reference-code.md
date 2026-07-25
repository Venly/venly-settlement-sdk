# Skill: Reconcile a EUR payment by referenceCode

Match an incoming EUR bank payment on a virtual IBAN (vIBAN) to the vIBAN that
issued its reference code, using only read tools. No mutation.

## When to use

An operator sees an incoming EUR transfer (from a bank feed, statement, or
notification) and needs to know which account and vIBAN it belongs to, and
whether the expected funds have arrived.

## Tools

- `list_virtual_bank_accounts` (read)
- `reconcile_by_reference_code` (read, composite)

## Steps

1. Identify the settlement `accountId` in question.
2. Collect the observed incoming transactions. Each needs at least a
   `referenceCode`, `amount`, and `currency` (add `remitterName`, `valueDate`,
   `bankTransactionId` when available).
3. Call `reconcile_by_reference_code` with `accountId`, the target
   `referenceCode`, and the `transactions` array. The tool fetches the account's
   vIBANs and matches.
4. Read the result:
   - `matched: true` plus a `virtualBankAccount` and `matchedTransactions`: the
     payment is reconciled. `totalAmount` is the summed value.
   - `matched: false` with a `virtualBankAccount` but no transactions: the vIBAN
     exists, funds have not arrived. Awaiting funds.
   - `matched: false` with `virtualBankAccount: null` but transactions present:
     the payment references a code no vIBAN on this account carries. Possible
     misdirected payment, investigate.

## Notes

- There is no list-vIBAN-transactions endpoint in Release 1, so the transactions
  are supplied by the operator or an upstream bank feed. The tool does the
  matching, not the fetching of bank transactions.
- Read-only. This skill never approves, transfers, or mutates anything.
