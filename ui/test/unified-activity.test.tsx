import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import type { FundflowComponents, Transfer } from "@venlyfinance/sdk";
import {
  ActivityFilterEmpty,
  ActivityFilterRow,
  RampActivityPanel,
  activityFilterScopeSentence,
  filterByClientActivity,
  filterUnified,
  rampSigned,
  unifiedBand,
  unifiedColumns,
  unifiedSearchHaystack,
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

test("csv: both ledgers, scope column says which is which, ramp rows carry the fiat leg", () => {
  const rows = unifyActivity([transfer({ id: "t1" })], [ramp({ id: "r1" })]);
  const csv = unifiedToCsv(rows, ACCT, "Main EUR");
  const lines = csv.split("\n");
  assert.equal(lines[0], "source,id,reference,type,date,scope,amount,currency,Converted amount,convertedCurrency,status");
  const rampLine = lines.find((l) => l.startsWith("ramp,"));
  assert.ok(rampLine?.includes("Company-wide"));
  assert.ok(rampLine?.includes("92") && rampLine.includes("EUR"), "the gross fiat leg exports too");
  assert.ok(lines.some((l) => l.startsWith("transfer,") && l.includes("Main EUR")));
});

test("rendered amounts: a settled credit carries an explicit +, a waiting one does not", () => {
  const amountCell = unifiedColumns(ACCT, "Main EUR").find((c) => c.key === "amount");
  assert.ok(amountCell);
  const render = (r: Parameters<typeof unifiedBand>[0]) =>
    renderToStaticMarkup(<>{amountCell.cell(r)}</>);
  const settled = render({ kind: "ramp", key: "k", ramp: ramp({ rampType: "ON_RAMP", status: "SUCCEEDED", cryptoAmount: 100 }) });
  assert.match(settled, />\+</, "settled add-money renders an explicit +");
  const waiting = render({ kind: "ramp", key: "k", ramp: ramp({ rampType: "ON_RAMP", status: "AWAITING_FUNDS", cryptoAmount: 100 }) });
  assert.doesNotMatch(waiting, />\+</, "nothing has been credited yet - no +");
  const withdrawal = render({ kind: "ramp", key: "k", ramp: ramp({ rampType: "OFF_RAMP", cryptoAmount: 100 }) });
  assert.match(withdrawal, /−100\.00/, "withdrawals keep the true minus");

  // The panel hero carries the same sign treatment as the table cell.
  const settledPanel = renderToStaticMarkup(
    <RampActivityPanel ramp={ramp({ rampType: "ON_RAMP", status: "SUCCEEDED", cryptoAmount: 100 })} onClose={() => undefined} />,
  );
  assert.match(settledPanel, />\+</, "settled add-money panel hero renders the +");
  const waitingPanel = renderToStaticMarkup(
    <RampActivityPanel ramp={ramp({ rampType: "ON_RAMP", status: "AWAITING_FUNDS", cryptoAmount: 100 })} onClose={() => undefined} />,
  );
  assert.doesNotMatch(waitingPanel, />\+</, "waiting add-money panel hero stays unprefixed");
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

test("client-side search matches merchantReference, description, counterparty id and id", () => {
  const rows = unifyActivity(
    [
      transfer({ id: "t-ref", merchantReference: "PAY-2026-001234", description: "Supplier settlement" }),
      transfer({ id: "t-other", merchantReference: "NOPE", description: "Other" }),
    ],
    [ramp({ id: "r-pay", paymentReference: "PAY-9" })],
  );
  const hit = filterByClientActivity(
    rows,
    { query: "PAY-2026", dateFrom: "", dateTo: "", amountMin: "", amountMax: "" },
    unifiedSearchHaystack,
    (row) => row.createdAt,
    () => undefined,
  );
  assert.deepEqual(hit.map((r) => r.key), ["transfer:t-ref"]);
});

test("date and amount ranges are client-side over fetched rows", () => {
  const rows = unifyActivity(
    [
      transfer({ id: "t1", amount: 100, createdAt: "2026-07-01T10:00:00Z" }),
      transfer({ id: "t2", amount: 500, createdAt: "2026-07-18T10:00:00Z" }),
      transfer({ id: "t3", amount: 50, createdAt: "2026-08-01T10:00:00Z" }),
    ],
    [],
  );
  const dated = filterByClientActivity(
    rows,
    { query: "", dateFrom: "2026-07-01", dateTo: "2026-07-31", amountMin: "", amountMax: "" },
    unifiedSearchHaystack,
    (row) => row.createdAt,
    (row) => (row.kind === "transfer" ? row.transfer.amount : undefined),
  );
  assert.deepEqual(dated.map((r) => r.key), ["transfer:t2", "transfer:t1"]);
  const amounts = filterByClientActivity(
    rows,
    { query: "", dateFrom: "", dateTo: "", amountMin: "80", amountMax: "200" },
    unifiedSearchHaystack,
    (row) => row.createdAt,
    (row) => (row.kind === "transfer" ? row.transfer.amount : undefined),
  );
  assert.deepEqual(amounts.map((r) => r.key), ["transfer:t1"]);
});

test("filter row states filtered-from-fetched; no-match empty is distinct from no activity", () => {
  assert.equal(
    activityFilterScopeSentence(2, 10, true),
    "Showing 2 of 10 loaded transactions. Search, date and amount filters apply to the transactions currently loaded.",
  );
  assert.equal(activityFilterScopeSentence(10, 10, false), "Showing 10 of 10 loaded transactions.");
  const empty = renderToStaticMarkup(<ActivityFilterEmpty onClear={() => undefined} />);
  assert.match(empty, /No transactions match these filters/);
  assert.match(empty, /Clear filters/);
  assert.doesNotMatch(empty, /No activity yet/);
  const row = renderToStaticMarkup(
    <ActivityFilterRow
      filters={{ query: "PAY", dateFrom: "2026-07-01", dateTo: "", amountMin: "", amountMax: "" }}
      onChange={() => undefined}
      scopeSentence={activityFilterScopeSentence(0, 4, true)}
    />,
  );
  assert.match(row, /aria-label="Search activity"/);
  assert.match(row, /Showing 0 of 4 loaded transactions/);
  assert.doesNotMatch(row, /list API/);
});

