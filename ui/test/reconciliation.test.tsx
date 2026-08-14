import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { VenlyFinanceClient, type VirtualBankAccount } from "@venlyfinance/sdk";
import {
  CreditQueue,
  DISPOSITION_LABELS,
  ManyToOneBuilder,
  MatchWorkspace,
  RECONCILIATION_COPY,
  RationaleList,
  ReconciliationView,
  SECTION_LABELS,
  SourceUnavailable,
  buildQueueRows,
  candidateScore,
  confirmMatch,
  createExpectedPaymentFromCredit,
  normalizeReference,
  queueGroups,
  queueSection,
  rankCandidates,
  rationaleRows,
  referenceSignal,
  resolutionFor,
  selectionSum,
  shortfallLine,
  stepQueueSelection,
  undoMatch,
  type ExpectedPayment,
  type InboundCredit,
  type ReconciliationModel,
} from "../registry/blocks/reconciliation.js";

// These tests pin the surface's guarantees: the two feeds are never blurred, the
// rationale is per-signal (never a bare score), zero-counts stay drawn, a
// missing result collection is an error rather than an empty queue, part
// payment is a choice rather than a validation error, and undo is a
// reversal that reopens the expected payment.

// ─── Fixtures: the SDK mock is the credit source, exactly as a demo runs ─────

const client = new VenlyFinanceClient({ environment: "mock" });
const mock = client.mock!;
const VBA1 = "vb7e5f19-4444-4d40-ae85-000000000001"; // seed vIBAN, referenceCode REF-ABC-123, EUR

async function seededRegister(): Promise<{ accountId: string; register: VirtualBankAccount[] }> {
  const accounts = await client.accounts.list();
  const owner = accounts.items.find((account) => account.id)!;
  // The seed vIBAN belongs to the first account in the fixtures.
  const accountId = "a10c2d31-2222-4b20-8c63-000000000001";
  const page = await client.virtualBankAccounts.list(accountId);
  assert.equal(page.resultPresent, true);
  void owner;
  return { accountId, register: page.items.filter((v): v is VirtualBankAccount => v != null) };
}

function openPayment(overrides: Partial<ExpectedPayment> = {}): ExpectedPayment {
  return {
    id: overrides.id ?? "pay-1",
    label: overrides.label ?? "INV-2041",
    amount: overrides.amount ?? 1500,
    currency: overrides.currency ?? "EUR",
    status: overrides.status ?? "open",
    ...(overrides.payerName !== undefined ? { payerName: overrides.payerName } : {}),
  };
}

// ─── Reference normalization and matching ────────────────────────────────────

test("reference normalization reads remittance text the way payer banks mangle it", () => {
  assert.equal(normalizeReference("ref-abc-123"), "REFABC123");
  assert.equal(normalizeReference("REF ABC 123"), "REFABC123");
  assert.equal(normalizeReference("invoice REFABC123 thanks"), "INVOICEREFABC123THANKS");
});

test("reference signal: exact, found-inside-text, none, explicit null, too short", async () => {
  const { register } = await seededRegister();

  const exact = referenceSignal({ referenceCode: "ref abc 123" }, register);
  assert.equal(exact.verdict, "exact");

  const fuzzy = referenceSignal({ referenceCode: "invoice REFABC123 thanks" }, register);
  assert.equal(fuzzy.verdict, "contains");

  assert.equal(referenceSignal({ referenceCode: "PAYMENT 4711" }, register).verdict, "none");
  assert.equal(referenceSignal({ referenceCode: null }, register).verdict, "missing");
  assert.equal(referenceSignal({ referenceCode: "a-1" }, register).verdict, "too-short");
});

// ─── The mock recipes drive the queue sections ───────────────────────────────

test("queue sections from the seeded recipes, zero-counts still drawn", async () => {
  mock.reset();
  const { register } = await seededRegister();

  mock.simulateInboundCredit(VBA1, 1500); // defaults to the vIBAN's own reference: exact
  mock.simulateInboundCredit(VBA1, 1500, "invoice REFABC123 thanks"); // found inside text
  mock.simulateInboundCredit(VBA1, 970, "PAYMENT 4711"); // no match: needs review
  mock.simulateInboundCredit(VBA1, 200, null); // explicit null: no usable reference
  mock.simulateInboundCredit(VBA1, 600);
  mock.simulateInboundCredit(VBA1, 300);

  const credits: InboundCredit[] = mock.listInboundCredits();
  const model: ReconciliationModel = { expectedPayments: [], resolutions: [] };
  const rows = buildQueueRows(credits, register, model, new Set());
  const groups = queueGroups(rows);

  const byKey = Object.fromEntries(groups.map((group) => [group.key, group.rows.length]));
  assert.equal(byKey["needs-review"], 1);
  assert.equal(byKey["no-usable-reference"], 1);
  assert.equal(byKey["matched"], 4);
  assert.equal(byKey["resolved"], 0, "the resolved section is drawn even at zero");
  assert.equal(groups.length, 4, "all four sections always exist");

  const html = renderToStaticMarkup(
    <CreditQueue rows={rows} focusedId={null} onOpen={() => {}} />,
  );
  for (const label of Object.values(SECTION_LABELS)) {
    assert.ok(html.includes(label), `section "${label}" is rendered`);
  }
  assert.ok(html.includes(RECONCILIATION_COPY.provenance), "the feed provenance line is rendered");
  assert.doesNotMatch(html, /Venly observed/, "nothing claims Venly observed the arrival");
});

test("empty queue: sections render with explicit zeros and the empty copy", () => {
  const rows = buildQueueRows([], [], { expectedPayments: [], resolutions: [] }, new Set());
  const html = renderToStaticMarkup(<CreditQueue rows={rows} focusedId={null} onOpen={() => {}} />);
  for (const label of Object.values(SECTION_LABELS)) {
    assert.ok(html.includes(label), `zero-count section "${label}" still drawn`);
  }
  assert.ok(html.includes(RECONCILIATION_COPY.emptyQueue));
  assert.ok(html.includes(RECONCILIATION_COPY.emptyQueueDetail));
});

// ─── Per-signal rationale, never a bare score ────────────────────────────────

test("rationale: exact match shows three signals with their own verdicts", async () => {
  mock.reset();
  const { register } = await seededRegister();
  const credit = mock.simulateInboundCredit(VBA1, 1500);
  const signal = referenceSignal(credit, register);
  const rows = rationaleRows(credit, signal, openPayment());

  assert.deepEqual(
    rows.map((row) => row.text),
    [
      "Reference · exact match",
      "Amount · equals the expected 1,500.00 EUR",
      "Remitter · not provided",
    ],
  );

  const html = renderToStaticMarkup(<RationaleList rows={rows} />);
  assert.doesNotMatch(html, /score/i, "never a bare score");
  assert.match(html, /aria-hidden="true"/, "verdicts carry a glyph, not colour alone");
});

test("rationale: fuzzy match names found-inside-text; short and over amounts carry the difference", async () => {
  mock.reset();
  const { register } = await seededRegister();
  const fuzzy = mock.simulateInboundCredit(VBA1, 1500, "invoice REFABC123 thanks");
  const rows = rationaleRows(fuzzy, referenceSignal(fuzzy, register), openPayment());
  assert.equal(rows[0].text, "Reference · found inside the remittance text");

  const short = mock.simulateInboundCredit(VBA1, 900);
  const shortRows = rationaleRows(short, referenceSignal(short, register), openPayment({ amount: 1000 }));
  assert.ok(shortRows.some((row) => row.text === "Amount · short by 100.00 EUR"));

  const over = mock.simulateInboundCredit(VBA1, 1100);
  const overRows = rationaleRows(over, referenceSignal(over, register), openPayment({ amount: 1000 }));
  assert.ok(overRows.some((row) => row.text === "Amount · over by 100.00 EUR"));
});

test("wrong currency: the rationale states the difference and renders no converted figure", async () => {
  mock.reset();
  const { register } = await seededRegister();
  const credit = mock.simulateInboundCredit(VBA1, 1500); // EUR vIBAN
  const usd = openPayment({ id: "pay-usd", currency: "USD", amount: 1500 });
  const rows = rationaleRows(credit, referenceSignal(credit, register), usd);

  assert.ok(rows.some((row) => row.text === "Currency · differs (EUR vs USD)"));
  assert.ok(
    !rows.some((row) => row.signal === "amount"),
    "no amount comparison across currencies - there is no rate to compare with",
  );
  const html = renderToStaticMarkup(<RationaleList rows={rows} />);
  assert.doesNotMatch(html, /≈|converted/i, "no conversion figure is invented");
});

// ─── Candidate ranking ───────────────────────────────────────────────────────

test("candidates: amount proximity ranks the right expected payment first", async () => {
  mock.reset();
  const { register } = await seededRegister();
  const credit = mock.simulateInboundCredit(VBA1, 970, "PAYMENT 4711");
  assert.equal(referenceSignal(credit, register).verdict, "none");

  const payments = [
    openPayment({ id: "pay-a", label: "INV-1000", amount: 1000 }),
    openPayment({ id: "pay-b", label: "INV-0970", amount: 970 }),
    openPayment({ id: "pay-c", label: "INV-0250", amount: 250 }),
    openPayment({ id: "pay-d", label: "INV-USD", amount: 970, currency: "USD" }),
  ];
  const ranked = rankCandidates(credit, payments);
  assert.equal(ranked[0].id, "pay-b", "the equal-amount candidate ranks first");
  assert.ok(
    candidateScore(credit, payments[3]) < candidateScore(credit, payments[0]),
    "cross-currency candidates rank below same-currency ones",
  );
  const rows = rationaleRows(credit, referenceSignal(credit, register), ranked[0]);
  assert.ok(rows.some((row) => row.text === "Amount · equals the expected 970.00 EUR"));
});

test("matched expected payments leave the candidate list", () => {
  const credit: InboundCredit = { id: "c1", referenceCode: "X", amount: 100, currency: "EUR" };
  const ranked = rankCandidates(credit, [
    openPayment({ id: "pay-open", amount: 100 }),
    openPayment({ id: "pay-done", amount: 100, status: "matched" }),
  ]);
  assert.deepEqual(ranked.map((payment) => payment.id), ["pay-open"]);
});

// ─── Many-to-one builder ─────────────────────────────────────────────────────

test("many-to-one: the difference figure is live and reaches zero", () => {
  assert.equal(
    shortfallLine(selectionSum([600, 300]), 1000, "EUR"),
    "Selected 900.00 of 1,000.00 EUR – 100.00 short.",
  );
  assert.equal(
    shortfallLine(selectionSum([600, 300, 100]), 1000, "EUR"),
    RECONCILIATION_COPY.selectedMatches,
  );
});

test("many-to-one builder: confirm waits for zero, partial save is a choice, never an error", () => {
  const payment = openPayment({ id: "pay-1000", label: "INV-1000", amount: 1000 });
  const credits: InboundCredit[] = [
    { id: "c-600", referenceCode: "REF-ABC-123", amount: 600, currency: "EUR" },
    { id: "c-300", referenceCode: "REF-ABC-123", amount: 300, currency: "EUR" },
    { id: "c-100", referenceCode: "REF-ABC-123", amount: 100, currency: "EUR" },
  ];
  const at900 = renderToStaticMarkup(
    <ManyToOneBuilder
      expectedPayment={payment}
      selectableCredits={credits}
      selectedIds={new Set(["c-600", "c-300"])}
      onToggle={() => {}}
      onConfirm={() => {}}
      onSavePartial={() => {}}
      onBack={() => {}}
    />,
  );
  assert.ok(at900.includes("Selected 900.00 of 1,000.00 EUR – 100.00 short."));
  assert.match(
    at900,
    /<button[^>]*disabled[^>]*>Confirm match<\/button>/,
    "confirm is closed while the selection is short",
  );
  assert.doesNotMatch(
    at900,
    new RegExp(`<button[^>]*disabled[^>]*>${RECONCILIATION_COPY.savePartial}</button>`),
    "partial save stays open - a choice, not a validation error",
  );
  assert.doesNotMatch(at900, /error|invalid/i, "a short selection is never phrased as an error");

  const at1000 = renderToStaticMarkup(
    <ManyToOneBuilder
      expectedPayment={payment}
      selectableCredits={credits}
      selectedIds={new Set(["c-600", "c-300", "c-100"])}
      onToggle={() => {}}
      onConfirm={() => {}}
      onSavePartial={() => {}}
      onBack={() => {}}
    />,
  );
  assert.ok(at1000.includes(RECONCILIATION_COPY.selectedMatches));
  assert.doesNotMatch(
    at1000,
    /<button[^>]*disabled[^>]*>Confirm match<\/button>/,
    "confirm opens at zero difference",
  );
});

// ─── Dispositions and undo ───────────────────────────────────────────────────

test("confirm moves the credit to Resolved and the expected payment to matched", async () => {
  mock.reset();
  const { register } = await seededRegister();
  const credit = mock.simulateInboundCredit(VBA1, 970, "PAYMENT 4711");
  const start: ReconciliationModel = {
    expectedPayments: [openPayment({ id: "pay-970", amount: 970 })],
    resolutions: [],
  };

  const before = queueGroups(buildQueueRows([credit], register, start, new Set()));
  assert.equal(before.find((group) => group.key === "needs-review")!.rows.length, 1);
  assert.equal(before.find((group) => group.key === "resolved")!.rows.length, 0);

  const confirmed = confirmMatch(start, [credit.id], "pay-970");
  assert.equal(confirmed.expectedPayments[0].status, "matched");
  const after = queueGroups(buildQueueRows([credit], register, confirmed, new Set()));
  assert.equal(after.find((group) => group.key === "needs-review")!.rows.length, 0);
  assert.equal(after.find((group) => group.key === "resolved")!.rows.length, 1);
});

test("partial confirm records partially-paid on the expected payment", () => {
  const start: ReconciliationModel = {
    expectedPayments: [openPayment({ id: "pay-1000", amount: 1000 })],
    resolutions: [],
  };
  const partial = confirmMatch(start, ["c-600", "c-300"], "pay-1000", true);
  assert.equal(partial.expectedPayments[0].status, "partially-paid");
  assert.equal(resolutionFor(partial, "c-600")!.partial, true);
});

test("undo is a reversal: the expected payment reopens and the credit returns to Needs review", async () => {
  mock.reset();
  const { register } = await seededRegister();
  const credit = mock.simulateInboundCredit(VBA1, 1500); // exact match
  const confirmed = confirmMatch(
    { expectedPayments: [openPayment()], resolutions: [] },
    [credit.id],
    "pay-1",
  );

  const { model: undone, reopenedCreditIds } = undoMatch(confirmed, credit.id);
  assert.deepEqual(reopenedCreditIds, [credit.id]);
  assert.equal(undone.expectedPayments[0].status, "open", "the expected payment reopened");
  assert.equal(resolutionFor(undone, credit.id), null);

  // A reopened credit must be re-judged by a person: it lands in Needs
  // review even though its reference still machine-matches.
  const signal = referenceSignal(credit, register);
  assert.equal(signal.verdict, "exact");
  assert.equal(queueSection(signal, false, true), "needs-review");
});

test("undoing a created expected payment removes it again", () => {
  const credit: InboundCredit = { id: "c9", referenceCode: "X-REF-9", amount: 250, currency: "EUR" };
  const created = createExpectedPaymentFromCredit({ expectedPayments: [], resolutions: [] }, credit);
  assert.equal(created.expectedPayments.length, 1);
  assert.equal(created.expectedPayments[0].status, "matched");
  const { model: undone } = undoMatch(created, "c9");
  assert.equal(undone.expectedPayments.length, 0);
});

// ─── Source unavailable ──────────────────────────────────────────────────────

test("a missing result collection is an error state, never an empty 'all done' queue", async () => {
  mock.reset();
  mock.respondNext({}, "GET /accounts/{accountId}/virtual-bank-accounts");
  const page = await client.virtualBankAccounts.list("a10c2d31-2222-4b20-8c63-000000000001");
  assert.equal(page.resultPresent, false, "the SDK surfaces the absent collection");

  const html = renderToStaticMarkup(<SourceUnavailable onRetry={() => {}} />);
  // renderToStaticMarkup escapes the apostrophe in "couldn't"; assert around it.
  assert.ok(html.includes("load your account details – the list may be incomplete."));
  assert.ok(html.includes(">Retry<"), "the retry affordance is offered");
  assert.ok(!html.includes(RECONCILIATION_COPY.emptyQueue), "the error never reads as an empty queue");
  assert.match(html, /role="alert"/);
});

// ─── Keyboard stepping ───────────────────────────────────────────────────────

test("keyboard stepping walks the queue and clamps at both ends", () => {
  const ids = ["a", "b", "c"];
  assert.equal(stepQueueSelection(ids, null, 1), "a", "down from nothing focuses the first row");
  assert.equal(stepQueueSelection(ids, "a", 1), "b");
  assert.equal(stepQueueSelection(ids, "c", 1), "c", "clamped at the last row");
  assert.equal(stepQueueSelection(ids, "a", -1), "a", "clamped at the first row");
  assert.equal(stepQueueSelection([], null, 1), null);
  assert.equal(stepQueueSelection(ids, "gone", 1), "a", "a vanished row resets to the top");
});

test("the focused row is visibly tinted in the queue", async () => {
  mock.reset();
  const { register } = await seededRegister();
  const credit = mock.simulateInboundCredit(VBA1, 1500);
  const rows = buildQueueRows([credit], register, { expectedPayments: [], resolutions: [] }, new Set());
  const html = renderToStaticMarkup(
    <CreditQueue rows={rows} focusedId={credit.id} onOpen={() => {}} />,
  );
  assert.match(html, /data-selected="true"/, "focus is visible, not just internal state");
});

// ─── Workspace copy and layout ───────────────────────────────────────────────

test("workspace: evidence sits left of the candidates, and the copy never says 'expectation'", async () => {
  mock.reset();
  const { register } = await seededRegister();
  const credit = mock.simulateInboundCredit(VBA1, 1500);
  const rows = buildQueueRows([credit], register, { expectedPayments: [openPayment()], resolutions: [] }, new Set());

  const html = renderToStaticMarkup(
    <MatchWorkspace
      row={rows[0]}
      model={{ expectedPayments: [openPayment()], resolutions: [] }}
      unresolvedCredits={[credit]}
      onConfirm={() => {}}
      onConfirmMany={() => {}}
      onCreateExpectedPayment={() => {}}
      onMarkTransfer={() => {}}
      onRaiseQuery={() => {}}
      onUndo={() => {}}
    />,
  );

  const evidence = html.indexOf("Received evidence");
  const candidates = html.indexOf("Candidate expected payments");
  assert.ok(evidence > 0 && candidates > 0 && evidence < candidates, "evidence renders before (left of) the candidates");
  assert.ok(html.includes("Reference as received"));
  assert.ok(html.includes(RECONCILIATION_COPY.gloss), "first-use gloss above the candidate list");
  assert.doesNotMatch(html, /expectation/i, "the user-facing noun is 'expected payment'");

  for (const label of Object.values(DISPOSITION_LABELS)) {
    assert.ok(html.includes(label), `disposition "${label}" is rendered`);
  }
  assert.match(
    html,
    /<button[^>]*disabled[^>]*>Confirm match<\/button>/,
    "confirm is closed without a selected candidate",
  );
  assert.ok(html.includes(RECONCILIATION_COPY.confirmNeedsCandidate), "the disabled confirm explains itself");
  assert.match(html, /↑/, "keyboard chips are visible in the workspace footer");
});

test("resolved workspace: undo is offered and reopens the expected payment", async () => {
  mock.reset();
  const { register } = await seededRegister();
  const credit = mock.simulateInboundCredit(VBA1, 1500);
  const model = confirmMatch(
    { expectedPayments: [openPayment()], resolutions: [] },
    [credit.id],
    "pay-1",
  );
  const rows = buildQueueRows([credit], register, model, new Set());
  assert.equal(rows[0].section, "resolved");

  const html = renderToStaticMarkup(
    <MatchWorkspace
      row={rows[0]}
      model={model}
      unresolvedCredits={[]}
      onConfirm={() => {}}
      onConfirmMany={() => {}}
      onCreateExpectedPayment={() => {}}
      onMarkTransfer={() => {}}
      onRaiseQuery={() => {}}
      onUndo={() => {}}
    />,
  );
  assert.ok(html.includes(RECONCILIATION_COPY.undoAction));
  assert.ok(html.includes(RECONCILIATION_COPY.undoDetail));
  assert.doesNotMatch(html, /expectation/i);
  assert.doesNotMatch(html, /delete/i, "undo is a reversal, never a delete");
});

test("null-reference credit: explicit null renders as 'Not provided', never '(not required)'", async () => {
  mock.reset();
  const { register } = await seededRegister();
  const credit = mock.simulateInboundCredit(VBA1, 200, null);
  const rows = buildQueueRows([credit], register, { expectedPayments: [], resolutions: [] }, new Set());
  assert.equal(rows[0].section, "no-usable-reference");

  const html = renderToStaticMarkup(
    <MatchWorkspace
      row={rows[0]}
      model={{ expectedPayments: [], resolutions: [] }}
      unresolvedCredits={[credit]}
      onConfirm={() => {}}
      onConfirmMany={() => {}}
      onCreateExpectedPayment={() => {}}
      onMarkTransfer={() => {}}
      onRaiseQuery={() => {}}
      onUndo={() => {}}
    />,
  );
  assert.ok(html.includes("Not provided"));
  assert.ok(!html.includes("(not required)"), "an absent reference is a state, not an exemption");
});

// ─── The split-pane view ─────────────────────────────────────────────────────

test("view: queue rail and workspace placeholder render without a drawer", async () => {
  mock.reset();
  const { register } = await seededRegister();
  mock.simulateInboundCredit(VBA1, 1500);
  const html = renderToStaticMarkup(
    <ReconciliationView
      virtualBankAccounts={register}
      credits={mock.listInboundCredits()}
      expectedPayments={[openPayment()]}
    />,
  );
  assert.ok(html.includes(RECONCILIATION_COPY.provenance));
  assert.ok(html.includes("Select a credit to review it here."));
  assert.doesNotMatch(html, /expectation/i);
});
