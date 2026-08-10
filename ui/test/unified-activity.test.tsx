import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import type { FundflowComponents, Transfer } from "@venlyfinance/sdk";
import {
  RampActivityPanel,
  filterUnified,
  rampSigned,
  unifiedBand,
  unifiedSummary,
  unifiedToCsv,
  unifiedTypeLabel,
  unifyActivity,
} from "../registry/blocks/activity.js";

type fundflow = FundflowComponents["schemas"];

const ACCT = "acct-1";

const transfer = (over: Partial<Transfer>): Transfer =>
  ({
    id: "t1",
    senderAccountId: ACCT,
    receiverAccountId: "acct-2",
    asset: "USDC",
    amount: 100,
    status: "COMPLETED",
    createdAt: "2026-08-01T10:00:00Z",
    ...over,
  }) as Transfer;

const ramp = (over: Partial<fundflow["RampRequestListItem"]>): fundflow["RampRequestListItem"] =>
  ({
    id: "r1",
    paymentReference: "PAY-1",
    rampType: "OFF_RAMP",
    status: "AWAITING_APPROVAL",
    fiatAmount: 92,
    fiatCurrency: "EUR",
    cryptoAmount: 100,
    cryptoCurrency: "USDC",
    createdAt: "2026-08-02T10:00:00Z",
    createdBy: "ops@example.com",
    ...over,
  }) as fundflow["RampRequestListItem"];

test("unified feed: merge is date-sorted desc and keys namespace the source", () => {
  const rows = unifyActivity(
    [transfer({ id: "t1", createdAt: "2026-08-01T10:00:00Z" })],
    [ramp({ id: "r1", createdAt: "2026-08-02T10:00:00Z" })],
  );
  assert.deepEqual(rows.map((r) => r.key), ["ramp:r1", "transfer:t1"]);
});

test("three bands: BLOCKED waits with In progress; refusals never read as Completed", () => {
  assert.equal(unifiedBand({ kind: "ramp", key: "k", ramp: ramp({ status: "BLOCKED" }) }), "pending");
  assert.equal(unifiedBand({ kind: "ramp", key: "k", ramp: ramp({ status: "SUCCEEDED" }) }), "completed");
  for (const status of ["FAILED", "REJECTED", "CANCELLED", "DENIED"] as const) {
    assert.equal(unifiedBand({ kind: "ramp", key: "k", ramp: ramp({ status }) }), "incomplete", status);
  }
  assert.equal(unifiedBand({ kind: "transfer", key: "k", transfer: transfer({ status: "FAILED" }) }), "incomplete");
  assert.equal(unifiedBand({ kind: "transfer", key: "k", transfer: transfer({ status: "PENDING" }) }), "pending");
});

test("failed count: REJECTED counts (negative intent), CANCELLED stays out (neutral)", () => {
  const rows = unifyActivity(
    [transfer({ id: "t1", status: "FAILED" })],
    [
      ramp({ id: "r1", status: "REJECTED" }),
      ramp({ id: "r2", status: "CANCELLED" }),
      ramp({ id: "r3", status: "DENIED" }),
    ],
  );
  assert.equal(unifiedSummary(rows).failed, 3, "FAILED transfer + REJECTED + DENIED; never CANCELLED");
});

test("type labels speak the Move-money surface's words", () => {
  assert.equal(unifiedTypeLabel({ kind: "ramp", key: "k", ramp: ramp({ rampType: "OFF_RAMP" }) }), "Withdrawal");
  assert.equal(unifiedTypeLabel({ kind: "ramp", key: "k", ramp: ramp({ rampType: "ON_RAMP" }) }), "Add money");
  assert.equal(unifiedTypeLabel({ kind: "transfer", key: "k", transfer: transfer({}) }, ACCT), "Transfer sent");
  assert.equal(
    unifiedTypeLabel({ kind: "transfer", key: "k", transfer: transfer({ senderAccountId: "other", receiverAccountId: ACCT }) }, ACCT),
    "Transfer received",
  );
});

test("type filter isolates each rail; scope composes on top", () => {
  const rows = unifyActivity(
    [transfer({ id: "t1", status: "PENDING" })],
    [ramp({ id: "r1", rampType: "OFF_RAMP" }), ramp({ id: "r2", rampType: "ON_RAMP", status: "SUCCEEDED" })],
  );
  assert.deepEqual(filterUnified(rows, "withdrawals", "all").map((r) => r.key), ["ramp:r1"]);
  assert.deepEqual(filterUnified(rows, "add-money", "all").map((r) => r.key), ["ramp:r2"]);
  assert.deepEqual(filterUnified(rows, "transfers", "pending").map((r) => r.key), ["transfer:t1"]);
});

test("amount signing: withdrawals negative; Add money signs positive only once SUCCEEDED", () => {
  assert.deepEqual(rampSigned(ramp({ rampType: "OFF_RAMP", cryptoAmount: 100 })), { amount: -100, signed: true });
  assert.deepEqual(rampSigned(ramp({ rampType: "ON_RAMP", status: "SUCCEEDED", cryptoAmount: 100 })), { amount: 100, signed: true });
  assert.deepEqual(rampSigned(ramp({ rampType: "ON_RAMP", status: "AWAITING_FUNDS", cryptoAmount: 100 })), { amount: 100, signed: false });
});

test("csv: both ledgers, scope column says which is which", () => {
  const rows = unifyActivity([transfer({ id: "t1" })], [ramp({ id: "r1" })]);
  const csv = unifiedToCsv(rows, ACCT, "Main EUR");
  const lines = csv.split("\n");
  assert.equal(lines[0], "source,id,reference,type,date,scope,amount,currency,status");
  assert.ok(lines.some((l) => l.startsWith("ramp,") && l.includes("Company-wide")));
  assert.ok(lines.some((l) => l.startsWith("transfer,") && l.includes("Main EUR")));
});

test("ramp panel: gross fiat is 'Converted amount', never 'bank receives'; drill is OFF_RAMP-only", () => {
  const off = renderToStaticMarkup(
    <RampActivityPanel ramp={ramp({})} onClose={() => undefined} onOpenWithdrawal={() => undefined} />,
  );
  assert.match(off, /Converted amount/);
  assert.match(off, /92\.00 EUR/);
  assert.doesNotMatch(off, /receives/i, "gross fiat must not claim to be the banked amount");
  assert.match(off, /View withdrawal/);
  assert.match(off, /ops@example\.com/, "createdBy renders - the one ledger that has provenance");

  const on = renderToStaticMarkup(
    <RampActivityPanel
      ramp={ramp({ rampType: "ON_RAMP", status: "AWAITING_FUNDS" })}
      onClose={() => undefined}
      onOpenWithdrawal={() => undefined}
    />,
  );
  assert.doesNotMatch(on, /View withdrawal/, "Add money has no entity page yet");
});
