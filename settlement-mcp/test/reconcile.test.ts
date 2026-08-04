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
  assert.equal(r.totalAmount, 1000);
  assert.equal(r.currency, "EUR");
});

test("reconcile: sums multiple matching transactions", () => {
  const txns: ObservedBankTransaction[] = [
    { referenceCode: "REF-XYZ-999", amount: 300, currency: "EUR" },
    { referenceCode: "REF-XYZ-999", amount: 200.5, currency: "EUR" },
  ];
  const r = reconcileByReferenceCode("REF-XYZ-999", VBANS, txns);
  assert.equal(r.matched, true);
  assert.equal(r.matchedTransactions.length, 2);
  assert.equal(r.totalAmount, 500.5);
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
  assert.equal(data.totalAmount, 1000);
  assert.ok(h.mock.called("listVirtualBankAccounts"));
  await h.close();
});
