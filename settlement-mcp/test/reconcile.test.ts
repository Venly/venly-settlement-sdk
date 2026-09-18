import { test } from "node:test";
import assert from "node:assert/strict";
import { makeHarness, callToolJson } from "./helpers.ts";
import { reconcileByReferenceCode } from "../src/reconcile.ts";
import type { ObservedBankTransaction, VirtualBankAccount } from "../src/types.ts";

const VBANS: VirtualBankAccount[] = [
  { id: "vban-1", currency: "EUR", referenceCode: "REF-ABC-123" },
  { id: "vban-2", currency: "EUR", referenceCode: "REF-XYZ-999" },
];

test("reconcile: matches a transaction to the vIBAN referenceCode (pure)", () => {
  const txns: ObservedBankTransaction[] = [
    { referenceCode: "REF-ABC-123", amount: 1000, currency: "EUR", remitterName: "Acme" },
    { referenceCode: "REF-OTHER", amount: 50, currency: "EUR" },
  ];
  const r = reconcileByReferenceCode("REF-ABC-123", VBANS, txns);
  assert.equal(r.matched, true);
  assert.equal(r.virtualBankAccount?.id, "vban-1");
  assert.equal(r.matchedTransactions.length, 1);
  assert.deepEqual(r.totals, [{ currency: "EUR", amount: 1000 }]);
  assert.equal(r.mixedCurrency, false);
});

test("reconcile: sums multiple matching transactions", () => {
  const txns: ObservedBankTransaction[] = [
    { referenceCode: "REF-XYZ-999", amount: 300, currency: "EUR" },
    { referenceCode: "REF-XYZ-999", amount: 200.5, currency: "EUR" },
  ];
  const r = reconcileByReferenceCode("REF-XYZ-999", VBANS, txns);
  assert.equal(r.matched, true);
  assert.equal(r.matchedTransactions.length, 2);
  assert.deepEqual(r.totals, [{ currency: "EUR", amount: 500.5 }]);
  assert.equal(r.mixedCurrency, false);
  assert.match(r.note, /totalling 500.5 EUR/);
});

test("reconcile: vIBAN exists but no funds arrived => not matched, awaiting funds", () => {
  const r = reconcileByReferenceCode("REF-ABC-123", VBANS, []);
  assert.equal(r.matched, false);
  assert.equal(r.virtualBankAccount?.id, "vban-1");
  assert.match(r.note, /Awaiting funds/);
});

test("reconcile: transaction references unknown code => misdirected payment flag", () => {
  const txns: ObservedBankTransaction[] = [
    { referenceCode: "REF-UNKNOWN", amount: 100, currency: "EUR" },
  ];
  const r = reconcileByReferenceCode("REF-UNKNOWN", VBANS, txns);
  assert.equal(r.matched, false);
  assert.equal(r.virtualBankAccount, null);
  assert.match(r.note, /misdirected/);
});

test("reconcile: rejects a blank reference code instead of matching missing data", () => {
  assert.throws(
    () => reconcileByReferenceCode("   ", [{ id: "vban-1" }], []),
    /referenceCode must not be blank/,
  );
});

test("reconcile: rejects a matching vIBAN without a usable id", () => {
  assert.throws(
    () =>
      reconcileByReferenceCode(
        "REF-ABC-123",
        [{ currency: "EUR", referenceCode: "REF-ABC-123" }],
        [],
      ),
    /matching vIBAN is missing an id/,
  );
});

test("reconcile_by_reference_code tool matches via the mocked client", async () => {
  const h = await makeHarness({});
  const { data, isError } = await callToolJson(h.client, "reconcile_by_reference_code", {
    accountId: "acct-1",
    referenceCode: "REF-ABC-123",
    transactions: [
      { referenceCode: "REF-ABC-123", amount: 1000, currency: "EUR", remitterName: "Acme" },
    ],
  });
  assert.equal(isError, false);
  assert.equal(data.matched, true);
  assert.equal(data.virtualBankAccount.id, "vban-1");
  assert.deepEqual(data.totals, [{ currency: "EUR", amount: 1000 }]);
  assert.equal(data.mixedCurrency, false);
  assert.equal("totalAmount" in data, false);
  assert.ok(h.mock.called("listVirtualBankAccounts"));
  await h.close();
});

test("reconcile: unlike currencies are partitioned, never summed (pure)", () => {
  const txns: ObservedBankTransaction[] = [
    { referenceCode: "REF-ABC-123", amount: 100, currency: "EUR" },
    { referenceCode: "REF-ABC-123", amount: 100, currency: "USD" },
  ];
  const r = reconcileByReferenceCode("REF-ABC-123", VBANS, txns);
  assert.equal(r.matched, true);
  assert.equal(r.matchedTransactions.length, 2);
  assert.equal(r.mixedCurrency, true);
  assert.deepEqual(r.totals, [
    { currency: "EUR", amount: 100 },
    { currency: "USD", amount: 100 },
  ]);
  // 100 EUR + 100 USD must never be presented as 200 of anything.
  assert.doesNotMatch(r.note, /200/);
  assert.match(r.note, /100 EUR, 100 USD/);
  assert.match(r.note, /never summed across currencies/);
});

test("reconcile: no scalar total on the result, single or mixed currency", () => {
  // Regression guard for the defect where 100 EUR + 100 USD was reported as
  // totalAmount 200 with currency EUR. A scalar total across currencies has no
  // defined value, so the result carries none and no currency label without an
  // amount attached. Fails if either field is reintroduced.
  const mixed = reconcileByReferenceCode("REF-ABC-123", VBANS, [
    { referenceCode: "REF-ABC-123", amount: 100, currency: "EUR" },
    { referenceCode: "REF-ABC-123", amount: 100, currency: "USD" },
  ]);
  const single = reconcileByReferenceCode("REF-ABC-123", VBANS, [
    { referenceCode: "REF-ABC-123", amount: 100, currency: "EUR" },
  ]);
  for (const r of [mixed, single]) {
    assert.equal("totalAmount" in r, false);
    assert.equal("currency" in r, false);
    const scalarNumbers = Object.entries(r)
      .filter(([, v]) => typeof v === "number")
      .map(([k]) => k);
    assert.deepEqual(scalarNumbers, [], `scalar numeric field(s) on the result: ${scalarNumbers.join(", ")}`);
  }
  assert.equal(single.totals.length, 1);
  assert.equal(mixed.totals.length, 2);
});

test("reconcile: currency codes are compared case- and whitespace-insensitively", () => {
  const r = reconcileByReferenceCode("REF-ABC-123", VBANS, [
    { referenceCode: "REF-ABC-123", amount: 40, currency: "eur" },
    { referenceCode: "REF-ABC-123", amount: 60, currency: " EUR " },
  ]);
  assert.equal(r.mixedCurrency, false);
  assert.deepEqual(r.totals, [{ currency: "EUR", amount: 100 }]);
});

test("reconcile: no match yields empty totals and no currency mix", () => {
  const r = reconcileByReferenceCode("REF-ABC-123", VBANS, []);
  assert.deepEqual(r.totals, []);
  assert.equal(r.mixedCurrency, false);
});

test("reconcile_by_reference_code tool never sums unlike currencies over the wire", async () => {
  const h = await makeHarness({});
  const { data, isError } = await callToolJson(h.client, "reconcile_by_reference_code", {
    accountId: "acct-1",
    referenceCode: "REF-ABC-123",
    transactions: [
      { referenceCode: "REF-ABC-123", amount: 100, currency: "EUR" },
      { referenceCode: "REF-ABC-123", amount: 100, currency: "USD" },
    ],
  });
  assert.equal(isError, false);
  assert.equal(data.matched, true);
  assert.equal(data.mixedCurrency, true);
  assert.deepEqual(data.totals, [
    { currency: "EUR", amount: 100 },
    { currency: "USD", amount: 100 },
  ]);
  assert.equal("totalAmount" in data, false);
  assert.equal("currency" in data, false);
  assert.doesNotMatch(data.note, /200/);
  await h.close();
});

test("reconcile: a repeated bank event is counted once and reported (pure)", () => {
  const row: ObservedBankTransaction = {
    referenceCode: "REF-ABC-123", amount: 100, currency: "EUR", bankTransactionId: "bank-tx-1",
  };
  const r = reconcileByReferenceCode("REF-ABC-123", VBANS, [row, { ...row }, { ...row }]);
  assert.equal(r.matched, true);
  assert.equal(r.matchedTransactions.length, 1);
  assert.deepEqual(r.totals, [{ currency: "EUR", amount: 100 }]);
  assert.deepEqual(r.duplicates, { removed: 2, bankTransactionIds: ["bank-tx-1"] });
  assert.match(r.note, /2 repeated bank event\(s\) ignored \(bankTransactionId bank-tx-1\)/);
  assert.doesNotMatch(r.note, /300/);
});

test("reconcile: rows sharing an id but differing in amount or currency refuse the call", () => {
  const base: ObservedBankTransaction = {
    referenceCode: "REF-ABC-123", amount: 100, currency: "EUR", bankTransactionId: "bank-tx-9",
  };
  assert.throws(
    () => reconcileByReferenceCode("REF-ABC-123", VBANS, [base, { ...base, amount: 250 }]),
    /bankTransactionId "bank-tx-9" appears more than once with a different amount or currency/,
  );
  assert.throws(
    () => reconcileByReferenceCode("REF-ABC-123", VBANS, [base, { ...base, currency: "USD" }]),
    /refusing to reconcile/,
  );
});

test("reconcile: rows without a bankTransactionId are never deduplicated", () => {
  const row: ObservedBankTransaction = { referenceCode: "REF-ABC-123", amount: 100, currency: "EUR" };
  const r = reconcileByReferenceCode("REF-ABC-123", VBANS, [row, { ...row }]);
  assert.equal(r.matchedTransactions.length, 2);
  assert.deepEqual(r.totals, [{ currency: "EUR", amount: 200 }]);
  assert.deepEqual(r.duplicates, { removed: 0, bankTransactionIds: [] });
});

test("reconcile: a duplicate-free call reports no duplicates and unchanged totals", () => {
  const r = reconcileByReferenceCode("REF-ABC-123", VBANS, [
    { referenceCode: "REF-ABC-123", amount: 60, currency: "EUR", bankTransactionId: "a" },
    { referenceCode: "REF-ABC-123", amount: 40, currency: "EUR", bankTransactionId: "b" },
  ]);
  assert.deepEqual(r.totals, [{ currency: "EUR", amount: 100 }]);
  assert.deepEqual(r.duplicates, { removed: 0, bankTransactionIds: [] });
  assert.doesNotMatch(r.note, /repeated/);
});

test("reconcile_by_reference_code tool counts a repeated bank event once over the wire", async () => {
  const h = await makeHarness({});
  const row = { referenceCode: "REF-ABC-123", amount: 100, currency: "EUR", bankTransactionId: "wire-dup" };
  const { data, isError } = await callToolJson(h.client, "reconcile_by_reference_code", {
    accountId: "acct-1", referenceCode: "REF-ABC-123", transactions: [row, row],
  });
  assert.equal(isError, false);
  assert.deepEqual(data.totals, [{ currency: "EUR", amount: 100 }]);
  assert.deepEqual(data.duplicates, { removed: 1, bankTransactionIds: ["wire-dup"] });
  assert.equal("totalAmount" in data, false);
  await h.close();
});

test("reconcile_by_reference_code tool refuses conflicting rows that share a bankTransactionId", async () => {
  const h = await makeHarness({});
  const { raw, isError } = await callToolJson(h.client, "reconcile_by_reference_code", {
    accountId: "acct-1", referenceCode: "REF-ABC-123", transactions: [
      { referenceCode: "REF-ABC-123", amount: 100, currency: "EUR", bankTransactionId: "wire-conflict" },
      { referenceCode: "REF-ABC-123", amount: 100, currency: "USD", bankTransactionId: "wire-conflict" },
    ],
  });
  assert.equal(isError, true);
  assert.match(raw.content[0].text, /wire-conflict/);
  assert.match(raw.content[0].text, /refusing to reconcile/);
  await h.close();
});
