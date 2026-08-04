/**
 * Pure reconciliation logic: match observed incoming bank transactions on a
 * EUR vIBAN to the vIBAN whose `referenceCode` they carry.
 *
 * Kept pure (no I/O) so it is trivially testable. The read tool fetches the
 * vIBANs via the VenlyClient and passes them in alongside the operator- or
 * bank-feed-supplied transactions.
 */

import type { ObservedBankTransaction, VirtualBankAccount } from "./types.js";

export interface ReconcileResult {
  referenceCode: string;
  matched: boolean;
  /** The vIBAN whose referenceCode equals the target, if any. */
  virtualBankAccount: VirtualBankAccount | null;
  /** Transactions carrying the target referenceCode. */
  matchedTransactions: ObservedBankTransaction[];
  /** Sum of matched transaction amounts. */
  totalAmount: number;
  /** Currency of the matched vIBAN (or first matched transaction). */
  currency: string | null;
  note: string;
}

export function reconcileByReferenceCode(
  referenceCode: string,
  virtualBankAccounts: VirtualBankAccount[],
  transactions: ObservedBankTransaction[],
): ReconcileResult {
  const target = referenceCode.trim();
  if (!target) {
    throw new Error("referenceCode must not be blank");
  }

  const vban =
    virtualBankAccounts.find(
      (v) => (v.referenceCode ?? "").trim() === target,
    ) ?? null;

  if (vban && !(vban.id ?? "").trim()) {
    throw new Error("matching vIBAN is missing an id");
  }

  const matchedTransactions = transactions.filter(
    (t) => (t.referenceCode ?? "").trim() === target,
  );

  const totalAmount = matchedTransactions.reduce(
    (sum, t) => sum + (Number.isFinite(t.amount) ? t.amount : 0),
    0,
  );

  const currency =
    vban?.currency ?? matchedTransactions[0]?.currency ?? null;

  const matched = vban !== null && matchedTransactions.length > 0;

  let note: string;
  if (matched) {
    note = `Matched ${matchedTransactions.length} transaction(s) totalling ${totalAmount} ${currency ?? ""} to vIBAN ${vban?.id}.`;
  } else if (vban && matchedTransactions.length === 0) {
    note = `vIBAN ${vban.id} carries referenceCode "${target}" but no supplied transaction references it. Awaiting funds.`;
  } else if (!vban && matchedTransactions.length > 0) {
    note = `Transaction(s) reference "${target}" but no vIBAN on this account carries that referenceCode. Possible misdirected payment.`;
  } else {
    note = `No vIBAN and no transaction match referenceCode "${target}".`;
  }

  return {
    referenceCode: target,
    matched,
    virtualBankAccount: vban,
    matchedTransactions,
    totalAmount,
    currency,
    note,
  };
}
