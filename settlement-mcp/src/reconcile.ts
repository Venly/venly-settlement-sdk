/**
 * Pure reconciliation logic: match observed incoming bank transactions on a
 * EUR vIBAN to the vIBAN whose `referenceCode` they carry.
 *
 * Kept pure (no I/O) so it is trivially testable. The read tool fetches the
 * vIBANs via the VenlyClient and passes them in alongside the operator- or
 * bank-feed-supplied transactions.
 */

import type { ObservedBankTransaction, VirtualBankAccount } from "./types.js";

/** The summed amount of the matched transactions in ONE currency. */
export interface CurrencyTotal {
  /** Currency code as carried by the transactions, trimmed and upper-cased. */
  currency: string;
  /** Sum of `amount` over the matched transactions in this currency. */
  amount: number;
}

export interface ReconcileResult {
  referenceCode: string;
  matched: boolean;
  /** The vIBAN whose referenceCode equals the target, if any. */
  virtualBankAccount: VirtualBankAccount | null;
  /** Transactions carrying the target referenceCode. */
  matchedTransactions: ObservedBankTransaction[];
  /**
   * Matched amounts partitioned by currency, in order of first appearance.
   * One element per currency present: a single-currency match yields exactly
   * one element, no match yields none. There is deliberately no scalar total
   * on this result. Amounts in different currencies have no defined sum
   * without a conversion contract, and this tool has none.
   */
  totals: CurrencyTotal[];
  /** True when the matched transactions carry more than one currency. */
  mixedCurrency: boolean;
  note: string;
}

/**
 * Normalize a payment reference the way bank remittance text must be read:
 * uppercase, alphanumerics only. Payer banks freely re-case, strip or pad
 * separators, so "ref-abc-123", "REF ABC 123" and "invoice REFABC123 thanks"
 * must all find REF-ABC-123.
 */
export function normalizeReference(text: string): string {
  return text.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * Sum amounts per currency, never across currencies. Currency codes are
 * compared trimmed and upper-cased so "eur" and "EUR" fall into one bucket
 * rather than reporting a spurious currency mix.
 */
function partitionByCurrency(transactions: ObservedBankTransaction[]): CurrencyTotal[] {
  const totals: CurrencyTotal[] = [];
  for (const t of transactions) {
    const currency = t.currency.trim().toUpperCase();
    const amount = Number.isFinite(t.amount) ? t.amount : 0;
    const bucket = totals.find((b) => b.currency === currency);
    if (bucket) {
      bucket.amount += amount;
    } else {
      totals.push({ currency, amount });
    }
  }
  return totals;
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
  const normalizedTarget = normalizeReference(target);
  if (normalizedTarget.length < 4) {
    throw new Error(
      `referenceCode "${target}" is too short after normalization ` +
        `("${normalizedTarget}"): at least 4 alphanumeric characters are required ` +
        "to match safely against free-form remittance text.",
    );
  }

  // The vIBAN side is Venly-issued, so it matches exactly (after normalization).
  const vban =
    virtualBankAccounts.find(
      (v) => normalizeReference(v.referenceCode ?? "") === normalizedTarget,
    ) ?? null;

  if (vban && !(vban.id ?? "").trim()) {
    throw new Error("matching vIBAN is missing an id");
  }

  // The transaction side is free-form remittance text typed by a payer, so a
  // containment test on the normalized text is the honest match.
  const matchedTransactions = transactions.filter((t) =>
    normalizeReference(t.referenceCode ?? "").includes(normalizedTarget),
  );

  const totals = partitionByCurrency(matchedTransactions);
  const mixedCurrency = totals.length > 1;

  const matched = vban !== null && matchedTransactions.length > 0;

  let note: string;
  if (matched) {
    const perCurrency = totals.map((t) => `${t.amount} ${t.currency}`).join(", ");
    note = mixedCurrency
      ? `Matched ${matchedTransactions.length} transaction(s) across ${totals.length} currencies ` +
        `(${perCurrency}) to vIBAN ${vban?.id}. Amounts are reported per currency and never summed across currencies.`
      : `Matched ${matchedTransactions.length} transaction(s) totalling ${perCurrency} to vIBAN ${vban?.id}.`;
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
    totals,
    mixedCurrency,
    note,
  };
}
