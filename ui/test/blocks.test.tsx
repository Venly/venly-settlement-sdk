import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { VenlyProvider } from "@venlyfinance/react";
import { ReceiveBlock, isComplete, serializeReceiveDetails } from "../registry/blocks/receive.js";
import { SendReview, parseAmountInput, transferProgressSteps } from "../registry/blocks/send.js";
import {
  ActivityTable,
  TransferDetailPanel,
  transferStatusIntent,
} from "../registry/blocks/activity.js";

const viba = {
  name: "Main EUR",
  iban: "DE89370400440532013000",
  bic: "DEUTDEDB",
  bankName: "Deutsche Bank",
  beneficiaryName: "Acme GmbH",
  referenceCode: "VF-REF-12345",
  currency: "EUR" as const,
  bankAccountType: "EUR_SEPA" as const,
  targetCryptocurrency: "USDC" as const,
};

test("receive: the completeness gate needs every serializer input", () => {
  assert.equal(isComplete(viba), true, "a full set is shareable");
  for (const k of [
    "referenceCode",
    "beneficiaryName",
    "iban",
    "bic",
    "bankName",
    "currency",
    "bankAccountType",
    "targetCryptocurrency",
  ]) {
    assert.equal(
      isComplete({ ...viba, [k]: undefined }),
      false,
      `a set missing ${k} must not be shareable`,
    );
    assert.equal(
      isComplete({ ...viba, [k]: "" }),
      false,
      `an empty ${k} must not be shareable either`,
    );
  }
});

test("receive: the artifact carries the reference warning above the values", () => {
  const text = serializeReceiveDetails(viba);
  const warning = text.indexOf("Enter the payment reference exactly as shown");
  const reference = text.indexOf("VF-REF-12345");
  assert.ok(warning > 0, "the reference warning is present");
  assert.ok(reference > warning, "the warning precedes the values");
  assert.match(text, /Payment reference \(required\)/);
  assert.match(text, /Fraud check/, "the artifact carries the fraud-check advisory");
});

test("receive: the artifact never claims a required field is optional", () => {
  const text = serializeReceiveDetails(viba);
  assert.doesNotMatch(text, /\(not required\)/);
  assert.doesNotMatch(
    text,
    /business day|typically arrive|held until claimed/i,
    "no timing or custody claim the API cannot support",
  );
});

test("send: the amount guard rejects empty, zero, negative and Infinity inputs", () => {
  assert.equal(parseAmountInput("1240"), 1240);
  assert.equal(parseAmountInput(" 12.5 "), 12.5);
  for (const bad of ["", "   ", "0", "-100", "Infinity", "abc", "NaN"]) {
    assert.equal(parseAmountInput(bad), null, `"${bad}" must not stage`);
  }
});

test("send review: components before the total, and the button restates the amount", () => {
  const html = renderToStaticMarkup(
    <SendReview
      draft={{
        kind: "fiat",
        senderAccountId: "acc-1",
        body: { receiverAccountId: "acc-2", currency: "EUR", amount: 1240 },
      }}
      fee={4.5}
      onConfirm={() => {}}
      onEdit={() => {}}
    />,
  );
  assert.match(html, /Pay 1,240\.00 EUR/, "commit button restates the amount");
  const fee = html.indexOf("Transfer fee");
  const total = html.indexOf("Recipient receives");
  assert.ok(fee > 0 && fee < total, "the working comes before the answer");
  assert.match(html, /−/, "operator is literal in the gutter");
  assert.match(html, /aria-label="estimate"/, "uncertainty attaches to the number");
});

test("send progress: failure is terminal and carries the reason", () => {
  const steps = transferProgressSteps({
    phase: "failed",
    reason: "transfer-failed",
    transfer: { id: "t1", status: "FAILED", errorMessage: "Insufficient funds" },
  });
  const terminal = steps[steps.length - 1]!;
  assert.equal(terminal.state, "failed");
  assert.equal(terminal.label, "Insufficient funds");

  const done = transferProgressSteps({
    phase: "completed",
    staged: {
      draft: { kind: "fiat", senderAccountId: "a", body: { currency: "EUR", amount: 1 } },
      idempotencyKey: "k",
      stagedAt: "now",
    },
    transfer: { id: "t2", status: "COMPLETED" },
  });
  assert.equal(done[done.length - 1]!.state, "completed");
});

test("activity: colour is a budget - settled rows stay quiet, pending and failed speak", () => {
  assert.equal(transferStatusIntent("COMPLETED"), null);
  assert.equal(transferStatusIntent("PENDING")?.intent, "pending");
  assert.equal(transferStatusIntent("FAILED")?.intent, "negative");

  const html = renderToStaticMarkup(
    <ActivityTable
      transfers={[
        { id: "1", description: "Settled one", status: "COMPLETED", amount: 10, asset: "USDC" },
        { id: "2", description: "Pending one", status: "PENDING", amount: 20, asset: "USDC" },
      ]}
    />,
  );
  const settledRow = html.slice(html.indexOf("Settled one"), html.indexOf("Pending one"));
  assert.doesNotMatch(settledRow, /data-intent/, "completed row carries no pill");
  assert.match(html.slice(html.indexOf("Pending one")), /data-intent="pending"/);
});

test("activity detail: the panel timeline's terminal node carries the failure reason", () => {
  const html = renderToStaticMarkup(
    <TransferDetailPanel
      transfer={{
        id: "t9",
        amount: 55,
        asset: "USDC",
        status: "FAILED",
        errorMessage: "Recipient account closed",
        createdAt: "2026-08-07T09:00:00Z",
      }}
      onClose={() => {}}
    />,
  );
  assert.match(html, /Recipient account closed/);
  assert.match(html, /✕/, "failed node glyph");
  assert.doesNotMatch(
    html.slice(html.indexOf('data-state="failed"')),
    /state-success/,
    "no success styling on the failed terminal",
  );
});

test("connected receive block renders its loading state under the mock provider (SSR-safe)", () => {
  const html = renderToStaticMarkup(
    <VenlyProvider environment="mock">
      <ReceiveBlock accountId="acc-1" />
    </VenlyProvider>,
  );
  assert.match(html, /Loading bank details/);
});

// ── Session A: balances on the real wallet source ─────────────────────

import {
  assetBalanceRows,
  segmentedBarBuckets,
  BalancesView,
} from "../registry/blocks/balances.js";
import {
  GroupedActivityTable,
  activitySummary,
  visibleTransferIds,
  scopeTransfers,
  signedTransferAmount,
  transferDirection,
  exportScopeSentence,
  transfersToCsv,
  stepSelection,
} from "../registry/blocks/activity.js";

// Contract 1.3.0: listWallets returns per-asset balance rows (numbers, no
// wallet wrapper). Two USDC rows model the multi-wallet aggregation case.
const wallets = [
  { asset: "USDC", contractAddress: "0x1", amount: { total: 15230.5, available: 15100.5, reserved: 130 } },
  { asset: "EURC", contractAddress: "0x2", amount: { total: 8020, available: 8020, reserved: 0 } },
  { asset: "USDC", contractAddress: "0x1", amount: { total: 100, available: 100, reserved: 0 } },
];

test("balances: rows aggregate per asset across balance rows, sorted by available descending", () => {
  const rows = assetBalanceRows(wallets);
  assert.deepEqual(
    rows.map((r) => r.asset),
    ["USDC", "EURC"],
  );
  const usdc = rows[0]!;
  assert.equal(usdc.total, 15330.5, "totals sum across rows of the same asset");
  assert.equal(usdc.available, 15200.5);
  assert.equal(usdc.reserved, 130);
  // Contract 1.3.0 names no chain on a balance row; the UI must not invent one.
  assert.deepEqual(usdc.chains, []);
});

test("balances: the segmented bar needs two non-zero buckets - a single band implies a split that isn't there", () => {
  const rows = assetBalanceRows(wallets);
  assert.equal(segmentedBarBuckets(rows[0]!).length, 2, "USDC has available AND reserved");
  assert.equal(segmentedBarBuckets(rows[1]!).length, 0, "EURC has no reserve: no bar");
  const html = renderToStaticMarkup(<BalancesView rows={rows} />);
  assert.match(html, /role="img"/, "bar rendered for the primary asset");
  const eurOnly = renderToStaticMarkup(<BalancesView rows={[rows[1]!]} />);
  assert.doesNotMatch(eurOnly, /role="img"/, "no bar without a real split");
});

test("balances: available is the hero from the wallet source; zero reserves render the em-dash", () => {
  const rows = assetBalanceRows(wallets);
  const html = renderToStaticMarkup(<BalancesView rows={rows} qualifier="Acme" />);
  assert.match(html, /15,200\.50/, "hero available comes from the aggregated wallet data");
  assert.match(html, /15,330\.50/, "total demoted below the rule");
  // EURC row has reserved 0 -> em-dash, not 0.00 noise.
  const eurcCells = html.slice(html.indexOf(">EURC<"));
  const eurcRow = eurcCells.slice(0, eurcCells.indexOf("</tr>"));
  assert.match(eurcRow, /—/, "zero reserve renders the em-dash");
});

test("balances: masking covers the hero, the buckets AND every row - not just the headline", () => {
  const rows = assetBalanceRows(wallets);
  const html = renderToStaticMarkup(
    <BalancesView rows={rows} masked onToggleMasked={() => {}} />,
  );
  assert.doesNotMatch(html, /15,200|15,330|8,020|130\.00/, "no figure survives masking");
  assert.match(html, /••••/, "fixed-length mask leaks no magnitude");
  assert.match(html, /Show/, "masking control is a labelled text link, not an ambiguous icon");
});

test("activity: pending sits in its own section above settled; the empty section is still drawn", () => {
  const transfers = [
    { id: "s1", description: "Old settled", status: "COMPLETED" as const, amount: 10, asset: "USDC" },
    { id: "p1", description: "In flight", status: "PENDING" as const, amount: 20, asset: "USDC" },
  ];
  const html = renderToStaticMarkup(<GroupedActivityTable transfers={transfers} />);
  const pendingBand = html.indexOf("Pending");
  const settledBand = html.indexOf("Settled");
  assert.ok(pendingBand >= 0 && settledBand >= 0, "both section bands drawn");
  assert.ok(pendingBand < settledBand, "pending above settled");
  assert.ok(html.indexOf("In flight") < html.indexOf("Old settled"), "rows follow their bands");

  const settledOnly = renderToStaticMarkup(
    <GroupedActivityTable transfers={[transfers[0]!]} />,
  );
  assert.match(settledOnly, /Pending/, "empty pending section still drawn - a zero count is a state");
});

test("activity: amounts are signed relative to the account, and the level stays neutral", () => {
  const t = { id: "t1", senderAccountId: "me", receiverAccountId: "them", amount: 50, asset: "USDC", status: "COMPLETED" as const };
  assert.equal(transferDirection(t, "me"), "out");
  assert.equal(transferDirection(t, "them"), "in");
  assert.equal(signedTransferAmount(t, "me"), -50);
  assert.equal(signedTransferAmount(t, "them"), 50);
  assert.equal(signedTransferAmount(t), 50, "unsigned without an account perspective");

  const html = renderToStaticMarkup(<GroupedActivityTable transfers={[t]} accountId="me" />);
  assert.match(html, /−50\.00/, "true minus sign on outgoing");
  assert.doesNotMatch(html, /state-danger-fg[^"]*">−50/, "debits are not red");
});

test("activity: the summary recomputes per filter and the scope switch actually scopes", () => {
  const transfers = [
    { id: "1", status: "COMPLETED" as const, asset: "USDC", amount: 1 },
    { id: "2", status: "PENDING" as const, asset: "USDC", amount: 2 },
    { id: "3", status: "FAILED" as const, asset: "EURC", amount: 3 },
  ];
  assert.deepEqual(activitySummary(transfers), { transfers: 3, pending: 1, failed: 1 });
  const usdcOnly = transfers.filter((t) => t.asset === "USDC");
  assert.deepEqual(activitySummary(usdcOnly), { transfers: 2, pending: 1, failed: 0 });
  assert.deepEqual(scopeTransfers(transfers, "pending").map((t) => t.id), ["2"]);
  assert.deepEqual(scopeTransfers(transfers, "failed").map((t) => t.id), ["3"]);
  assert.equal(scopeTransfers(transfers, "all").length, 3);
});

test("activity export: scope is declared in prose before any format choice", () => {
  assert.equal(exportScopeSentence(3, 3), "Exports all 3 transfers on this account.");
  assert.equal(
    exportScopeSentence(2, 5),
    "Exports the 2 transfers matching your current filters, out of 5.",
  );
  const csv = transfersToCsv(
    [{ id: "t1", senderAccountId: "me", amount: 12.5, asset: "USDC", status: "COMPLETED" as const, description: "Has, comma" }],
    "me",
  );
  const [header, row] = csv.split("\n");
  assert.match(header!, /^id,createdAt,direction,asset,chain,amount,status/);
  assert.match(row!, /"Has, comma"/, "csv fields with commas are quoted");
  assert.match(row!, /,out,/, "direction travels with the export");
  assert.match(row!, /-12\.5/, "signed amount in the export");
});

test("activity keyboard: arrows step through visible rows without wrapping, from and to the edges", () => {
  const ids = ["a", "b", "c"];
  assert.equal(stepSelection(ids, "a", 1), "b");
  assert.equal(stepSelection(ids, "c", 1), "c", "no wrap at the bottom");
  assert.equal(stepSelection(ids, "a", -1), "a", "no wrap at the top");
  assert.equal(stepSelection(ids, null, 1), "a", "down from nothing selects the first row");
  assert.equal(stepSelection(ids, "gone", 1), "a", "a filtered-away selection resets to the top");
  assert.equal(stepSelection([], "a", 1), null);
});

test("activity keyboard: a collapsed group's rows are excluded from the stepper - never select a row with no tr", () => {
  const transfers = [
    { id: "p1", status: "PENDING" as const, asset: "USDC", amount: 1 },
    { id: "s1", status: "COMPLETED" as const, asset: "USDC", amount: 2 },
    { id: "s2", status: "FAILED" as const, asset: "USDC", amount: 3 },
  ];
  assert.deepEqual(visibleTransferIds(transfers, {}), ["p1", "s1", "s2"]);
  assert.deepEqual(visibleTransferIds(transfers, { settled: true }), ["p1"]);
  assert.deepEqual(visibleTransferIds(transfers, { pending: true }), ["s1", "s2"]);
  // Stepping from the last visible row cannot land in the collapsed group.
  const ids = visibleTransferIds(transfers, { settled: true });
  assert.equal(stepSelection(ids, "p1", 1), "p1");

  // The controlled table renders no rows for a collapsed group.
  const html = renderToStaticMarkup(
    <GroupedActivityTable transfers={transfers} collapsedGroups={{ settled: true }} />,
  );
  assert.ok(html.includes("Settled"), "collapsed band still drawn");
  assert.doesNotMatch(html, /2\.00 |3\.00/, "settled rows not rendered while collapsed");
});
