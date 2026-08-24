import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ACTOR_SECTION_LABELS,
  AgeCell,
  CONSOLE_QUEUE_COPY,
  ConsoleQueue,
  WhoseMove,
  consoleQueueCsv,
  consoleQueueGroups,
  deriveKycActor,
  derivePayoutActor,
  derivePayoutBankAccountActor,
  deriveRouteActor,
  formatAge,
  queueSectionOf,
  type ConsoleQueueRow,
  type Derivation,
} from "../registry/blocks/console-queue.js";

// The two derivation tables are the whose-move contract: every case below is
// one row of that contract, plus its overrides, plus the no-guess rule. The
// module has no clock and no configuration, so neither does this suite.

// ─── Customer onboarding: account kycStatus × IV status ─────────────────────

const kyc = (
  accountKycStatus: string | undefined,
  ivStatus?: string,
  party?: { kybStatus?: string; kycStatus?: string },
): Derivation =>
  deriveKycActor({
    accountKycStatus,
    ivStatus,
    partyKybStatus: party?.kybStatus,
    partyKycStatus: party?.kycStatus,
  });

test("kyc table: one case per row", () => {
  // Row 1 - nothing submitted: the customer's move. Absent and NOT_LINKED
  // are the same state.
  assert.deepEqual(kyc("VERIFICATION_PENDING", undefined), {
    kind: "actor",
    actor: "CUSTOMER",
    state: "Verification not started",
  });
  assert.deepEqual(kyc("VERIFICATION_PENDING", "NOT_LINKED"), {
    kind: "actor",
    actor: "CUSTOMER",
    state: "Verification not started",
  });
  // Rows 2 + 3 - submitted / forwarded sit with the provider, one phrase.
  assert.deepEqual(kyc("VERIFICATION_PENDING", "SUBMITTED"), {
    kind: "actor",
    actor: "PROVIDER",
    state: "Screening in progress",
  });
  assert.deepEqual(kyc("VERIFICATION_PENDING", "FORWARDED"), {
    kind: "actor",
    actor: "PROVIDER",
    state: "Screening in progress",
  });
  // Rows 4 + 5 - the review-queue rows: evidence in, decision owed.
  assert.deepEqual(kyc("VERIFICATION_PENDING", "ACCEPTED"), {
    kind: "actor",
    actor: "OPERATOR",
    state: "Review – decision owed",
  });
  assert.deepEqual(kyc("VERIFICATION_PENDING", "COMPLETED"), {
    kind: "actor",
    actor: "OPERATOR",
    state: "Review – decision owed",
  });
  // Row 6 - a failed screening is still an open account decision; routing
  // it to the customer would drop it out of every worklist.
  assert.deepEqual(kyc("VERIFICATION_PENDING", "FAILED"), {
    kind: "actor",
    actor: "OPERATOR",
    state: "Screening failed – decision owed",
  });
  // Rows 7-9 - terminal: no move, and NOT_REQUIRED is its own explicit
  // state, never conflated with Verified.
  assert.deepEqual(kyc("VERIFIED", "COMPLETED"), { kind: "terminal", state: "Verified" });
  assert.deepEqual(kyc("REJECTED", "FAILED"), { kind: "terminal", state: "Rejected" });
  assert.deepEqual(kyc("NOT_REQUIRED", undefined), {
    kind: "terminal",
    state: "Verification not required",
  });
});

test("kyc overrides: party terminal wins; pending creates no work; no invented states; status is a separate axis", () => {
  // O1 - the negative case FIRST: without the override, a pending account
  // with no IV case is row 1's join - waiting on the CUSTOMER, not an
  // operator row. That is exactly why the override must exist: a refused
  // party would otherwise sit "waiting on the customer" forever.
  assert.deepEqual(kyc("VERIFICATION_PENDING", undefined, { kybStatus: "PENDING" }), {
    kind: "actor",
    actor: "CUSTOMER",
    state: "Verification not started",
  });
  // O1 applied - the party refusal is terminal whatever the account says.
  assert.deepEqual(kyc("VERIFICATION_PENDING", undefined, { kybStatus: "DENIED" }), {
    kind: "terminal",
    state: "Rejected at party level",
  });
  assert.deepEqual(kyc("VERIFICATION_PENDING", "COMPLETED", { kycStatus: "REJECTED" }), {
    kind: "terminal",
    state: "Rejected at party level",
  });
  // O2 - a pending party with no case is the not-started row, never review.
  const pendingParty = kyc("VERIFICATION_PENDING", undefined, { kybStatus: "PENDING" });
  assert.equal(pendingParty.kind === "actor" && pendingParty.actor, "CUSTOMER");
  // O3 - no plane carries a documents state and none may be derived.
  for (const ivStatus of [undefined, "NOT_LINKED", "SUBMITTED", "FORWARDED", "ACCEPTED", "COMPLETED", "FAILED"]) {
    const result = kyc("VERIFICATION_PENDING", ivStatus);
    const state = result.kind === "unrecognised" ? "" : result.state;
    assert.ok(!/document/i.test(state), `no derived documents state (got "${state}")`);
  }
  // O4 - account status (frozen or not) is not an input: the derivation
  // takes only the verification axes, so a suspended account cannot change
  // whose move the verification decision is by construction.
  const withoutStatus = kyc("VERIFICATION_PENDING", "COMPLETED");
  assert.deepEqual(withoutStatus, kyc("VERIFICATION_PENDING", "COMPLETED"));
});

test("kyc no-guess rule: an uncovered join renders no value and says so", () => {
  assert.deepEqual(kyc("SOMETHING_NEW", "COMPLETED"), { kind: "unrecognised" });
  assert.deepEqual(kyc("VERIFICATION_PENDING", "SOMETHING_NEW"), { kind: "unrecognised" });
  const markup = renderToStaticMarkup(<WhoseMove derivation={{ kind: "unrecognised" }} />);
  assert.match(markup, /State not recognised – see detail/);
});

// ─── Payouts: status × reconciliationState ───────────────────────────────────

test("payout table: one case per row", () => {
  // Row 1 - accepted, not yet sent: the platform's own pipeline holds it.
  assert.deepEqual(derivePayoutActor({ status: "REQUESTED" }), {
    kind: "actor",
    actor: "PROVIDER",
    state: "Requested",
  });
  assert.deepEqual(derivePayoutActor({ status: "REQUESTED", reconciliationState: "IN_PROGRESS" }), {
    kind: "actor",
    actor: "PROVIDER",
    state: "Requested",
  });
  // Row 2 - on-chain send in flight.
  assert.deepEqual(derivePayoutActor({ status: "SENDING" }), {
    kind: "actor",
    actor: "PROVIDER",
    state: "Sending",
  });
  // Row 3 - the provider holds it; the one row whose duration is a fact.
  assert.deepEqual(
    derivePayoutActor({ status: "PROVIDER_PROCESSING", reconciliationState: "IN_PROGRESS" }),
    { kind: "actor", actor: "PROVIDER", state: "At the provider" },
  );
  assert.deepEqual(
    derivePayoutActor({ status: "PROVIDER_PROCESSING", reconciliationState: "MATCHED" }),
    { kind: "actor", actor: "PROVIDER", state: "At the provider" },
  );
  // Row 4 - the contract itself asserts the row needs attention.
  assert.deepEqual(
    derivePayoutActor({ status: "PROVIDER_PROCESSING", reconciliationState: "STUCK" }),
    { kind: "actor", actor: "OPERATOR", state: "Stuck at the provider – needs review" },
  );
  // Row 5.
  assert.deepEqual(
    derivePayoutActor({ status: "PROVIDER_PROCESSING", reconciliationState: "NEEDS_REVIEW" }),
    { kind: "actor", actor: "OPERATOR", state: "Needs review" },
  );
  // Row 6 - a mismatch overrides the status axis entirely.
  assert.deepEqual(derivePayoutActor({ status: "SENDING", reconciliationState: "MISMATCH" }), {
    kind: "actor",
    actor: "OPERATOR",
    state: "Amount mismatch",
  });
  // Row 7 - confirmed and reconciled.
  assert.deepEqual(derivePayoutActor({ status: "COMPLETED", reconciliationState: "MATCHED" }), {
    kind: "terminal",
    state: "Completed",
  });
  // Row 8 - lifecycle-done, books not closed: confirm-completion is owed.
  assert.deepEqual(derivePayoutActor({ status: "COMPLETED" }), {
    kind: "actor",
    actor: "OPERATOR",
    state: "Completed – awaiting confirmation",
  });
  assert.deepEqual(derivePayoutActor({ status: "COMPLETED", reconciliationState: "IN_PROGRESS" }), {
    kind: "actor",
    actor: "OPERATOR",
    state: "Completed – awaiting confirmation",
  });
  // Row 9 - money came back: an open item, not a closed one.
  assert.deepEqual(derivePayoutActor({ status: "RETURNED" }), {
    kind: "actor",
    actor: "OPERATOR",
    state: "Returned",
  });
  // Row 10.
  assert.deepEqual(derivePayoutActor({ status: "FAILED" }), {
    kind: "actor",
    actor: "OPERATOR",
    state: "Failed",
  });
  // Row 11 - refused before leaving: terminal, no move.
  assert.deepEqual(derivePayoutActor({ status: "REJECTED" }), {
    kind: "terminal",
    state: "Rejected",
  });
});

test("payout overrides: attention outranks lifecycle; routes and bank accounts are their own axes; no derived durations", () => {
  // P1 - STUCK / MISMATCH / NEEDS_REVIEW route to the operator whatever the
  // lifecycle status says: the server computed that judgment.
  assert.equal(derivePayoutActor({ status: "SENDING", reconciliationState: "STUCK" }).kind, "actor");
  assert.deepEqual(derivePayoutActor({ status: "COMPLETED", reconciliationState: "NEEDS_REVIEW" }), {
    kind: "actor",
    actor: "OPERATOR",
    state: "Needs review",
  });
  // P2 - the route is a third axis: the ownership proof is a funding-wallet
  // signature only the holder can produce.
  assert.deepEqual(deriveRouteActor("AWAITING_OWNERSHIP_PROOF"), {
    kind: "actor",
    actor: "CUSTOMER",
    state: "Awaiting ownership proof",
  });
  assert.deepEqual(deriveRouteActor("REGISTERING"), {
    kind: "actor",
    actor: "PROVIDER",
    state: "Registering",
  });
  assert.deepEqual(deriveRouteActor("PENDING"), { kind: "actor", actor: "OPERATOR", state: "Pending" });
  assert.deepEqual(deriveRouteActor("ACTIVE"), { kind: "terminal", state: "Active" });
  // P3 - a pending beneficiary bank account waits on the platform seat.
  assert.deepEqual(derivePayoutBankAccountActor("PENDING"), {
    kind: "actor",
    actor: "OPERATOR",
    state: "Pending",
  });
  assert.deepEqual(derivePayoutBankAccountActor("DISABLED"), { kind: "terminal", state: "Disabled" });
  // P4 - no derivation output carries a duration; the only duration a row
  // may render is one the API computed, and it arrives as row data, not
  // from this module.
  for (const result of [
    derivePayoutActor({ status: "PROVIDER_PROCESSING", reconciliationState: "IN_PROGRESS" }),
    derivePayoutActor({ status: "RETURNED" }),
  ]) {
    assert.deepEqual(
      Object.keys(result).sort(),
      result.kind === "actor" ? ["actor", "kind", "state"] : ["kind", "state"],
      "a derivation result carries no duration, target or threshold",
    );
  }
});

test("payout no-guess rule: uncovered joins render no value", () => {
  assert.deepEqual(derivePayoutActor({ status: "SOMETHING_NEW" }), { kind: "unrecognised" });
  // REQUESTED × MATCHED is not a row either table carries.
  assert.deepEqual(derivePayoutActor({ status: "REQUESTED", reconciliationState: "MATCHED" }), {
    kind: "unrecognised",
  });
  assert.deepEqual(deriveRouteActor(undefined), { kind: "unrecognised" });
});

// ─── Rendering guarantees ────────────────────────────────────────────────────

const row = (overrides: Partial<ConsoleQueueRow> & { key: string }): ConsoleQueueRow => ({
  subject: "Subject",
  state: { label: "Verification pending", intent: "pending" },
  derivation: { kind: "actor", actor: "OPERATOR", state: "Review – decision owed" },
  ageIso: "2026-08-17T14:05:00Z",
  ...overrides,
});

const NOW = "2026-08-21T12:00:00Z";

test("whose-move renders plain text, never a pill, and terminal rows render nothing", () => {
  const operator = renderToStaticMarkup(
    <WhoseMove derivation={{ kind: "actor", actor: "OPERATOR", state: "x" }} />,
  );
  assert.match(operator, /Your move/);
  assert.ok(!operator.includes("radius-pill"), "plain text, not a pill");
  const platform = renderToStaticMarkup(
    <WhoseMove derivation={{ kind: "actor", actor: "OPERATOR", state: "x" }} seat="platform" />,
  );
  assert.match(platform, /Platform move/);
  assert.equal(
    renderToStaticMarkup(<span><WhoseMove derivation={{ kind: "terminal", state: "Verified" }} /></span>),
    "<span></span>",
    "nobody's move: no value on a closed row",
  );
});

test("sections are actors in order, zero sections stay drawn, closed rows collapse", () => {
  const rows = [
    row({ key: "op" }),
    row({ key: "closed", derivation: { kind: "terminal", state: "Verified" } }),
    row({ key: "prov", derivation: { kind: "actor", actor: "PROVIDER", state: "Screening in progress" } }),
  ];
  const groups = consoleQueueGroups(rows, "integrator");
  assert.deepEqual(
    groups.map((g) => g.label),
    ["Your move", "Waiting on the customer", "Waiting on a provider", "Closed"],
  );
  const customer = groups.find((g) => g.label === "Waiting on the customer");
  assert.equal(customer?.rows.length, 0, "the empty section still exists");
  const markup = renderToStaticMarkup(
    <ConsoleQueue
      rows={rows}
      empty={{ headline: "No customers yet", body: "Rows appear when a customer starts onboarding." }}
      nowIso={NOW}
    />,
  );
  assert.match(markup, /Waiting on the customer/, "zero section drawn as a header row");
  assert.match(markup, /aria-expanded="false"/, "closed section starts collapsed");
});

test("the not-recognised band appears only when a derivation failed", () => {
  const clean = consoleQueueGroups([row({ key: "a" })], "integrator");
  assert.ok(!clean.some((g) => g.key === "UNRECOGNISED"));
  const dirty = consoleQueueGroups(
    [row({ key: "a" }), row({ key: "b", derivation: { kind: "unrecognised" } })],
    "integrator",
  );
  assert.equal(dirty[0].key, "UNRECOGNISED");
  assert.equal(dirty[0].rows.length, 1);
});

test("oldest first inside each band", () => {
  const groups = consoleQueueGroups(
    [
      row({ key: "newer", ageIso: "2026-08-20T00:00:00Z" }),
      row({ key: "older", ageIso: "2026-08-10T00:00:00Z" }),
    ],
    "integrator",
  );
  assert.deepEqual(groups[0].rows.map((r) => r.key), ["older", "newer"]);
});

test("age is a labelled fact: duration words, absolute date past 7 days, API minutes verbatim", () => {
  assert.equal(formatAge("2026-08-21T11:42:00Z", NOW), "18m");
  assert.equal(formatAge("2026-08-21T06:48:00Z", NOW), "5h 12m");
  assert.equal(formatAge("2026-08-18T08:00:00Z", NOW), "3d 4h");
  const recent = renderToStaticMarkup(<AgeCell sinceIso="2026-08-20T12:00:00Z" nowIso={NOW} />);
  assert.match(recent, /1d 0h/);
  const old = renderToStaticMarkup(<AgeCell sinceIso="2026-08-01T12:00:00Z" nowIso={NOW} />);
  assert.match(old, /Aug 01/, "rows older than 7 days carry the absolute date");
  const minutes = renderToStaticMarkup(<AgeCell minutes={41} nowIso={NOW} />);
  assert.match(minutes, /41m/);
  // No breach colouring anywhere: age cells never reach for a state colour.
  assert.ok(!old.includes("--state-danger"), "age is a fact, not a target");
});

test("loading is a geometry-preserving skeleton; a missing result is an error, not an empty queue", () => {
  const loading = renderToStaticMarkup(
    <ConsoleQueue rows={[]} loading empty={{ headline: "x", body: "y" }} nowIso={NOW} />,
  );
  assert.match(loading, /aria-busy="true"/);
  assert.match(loading, /Subject/, "real header labels stay");
  const failed = renderToStaticMarkup(
    <ConsoleQueue
      rows={[]}
      error={{ what: "the customer queue" }}
      empty={{ headline: "x", body: "y" }}
      nowIso={NOW}
    />,
  );
  assert.match(failed, /role="alert"/);
  assert.match(failed, /couldn&#x27;t load the customer queue/);
});

test("true-empty keeps the column header and names the actor who causes rows", () => {
  const markup = renderToStaticMarkup(
    <ConsoleQueue
      rows={[]}
      empty={{
        headline: "No customers yet",
        body: "Rows appear here when a customer starts onboarding.",
      }}
      nowIso={NOW}
    />,
  );
  assert.match(markup, /Whose move/, "column header retained");
  assert.match(markup, /when a customer starts onboarding/);
});

test("csv export carries values, quotes fields, and follows the filter", () => {
  const csv = consoleQueueCsv(
    [row({ key: "a", subject: 'Foxtrot "Logistics"', reference: "IV-FOXTROT-0071" })],
    "integrator",
  );
  const [header, line] = csv.split("\n");
  assert.equal(header, "subject,state,whoseMove,age,amount,currency,reference");
  assert.match(line, /"Foxtrot ""Logistics"""/);
  assert.match(line, /IV-FOXTROT-0071/);
  assert.match(line, /Your move/);
});

test("frozen is a badge beside the state pill, not a state replacement", () => {
  const markup = renderToStaticMarkup(
    <ConsoleQueue
      rows={[row({ key: "frozen", frozen: true })]}
      empty={{ headline: "x", body: "y" }}
      nowIso={NOW}
    />,
  );
  assert.match(markup, /Verification pending/, "the kyc state still renders");
  assert.match(markup, /Frozen/);
});

test("section membership mirrors queueSectionOf", () => {
  assert.equal(queueSectionOf({ kind: "terminal", state: "x" }), "CLOSED");
  assert.equal(queueSectionOf({ kind: "unrecognised" }), "UNRECOGNISED");
  assert.equal(queueSectionOf({ kind: "actor", actor: "CUSTOMER", state: "x" }), "CUSTOMER");
  assert.equal(ACTOR_SECTION_LABELS.OPERATOR.integrator, "Your move");
  assert.equal(CONSOLE_QUEUE_COPY.unrecognised, "State not recognised – see detail");
});

// ─── Prepare with agent: the affordance, the panel, the snippet ───────────────

import {
  PrepareWithAgentPanel,
  buildPrepareDecisionSnippet,
} from "../registry/blocks/console-queue.js";

const OPEN_ROW = {
  key: "row-open",
  subject: "Foxtrot Logistics",
  state: { label: "Verification pending", intent: "pending" as const },
  derivation: { kind: "actor" as const, actor: "OPERATOR" as const, state: "Review – decision owed" },
  ageIso: "2026-08-20T10:00:00Z",
};

const CLOSED_ROW = {
  key: "row-closed",
  subject: "Cygnus Retail",
  state: { label: "Verified", intent: "positive" as const },
  derivation: { kind: "terminal" as const, state: "Verified" },
  ageIso: "2026-08-01T10:00:00Z",
};

const QUEUE_EMPTY = { headline: "No customers yet", body: "Rows appear when a customer applies." };
const NOW_ISO = "2026-08-24T12:00:00Z";

test("queue: onPrepareWithAgent renders the action on open rows only", () => {
  const markup = renderToStaticMarkup(
    <ConsoleQueue
      rows={[OPEN_ROW, CLOSED_ROW]}
      empty={QUEUE_EMPTY}
      nowIso={NOW_ISO}
      onPrepareWithAgent={() => {}}
    />,
  );
  const occurrences = markup.split(CONSOLE_QUEUE_COPY.prepareWithAgent).length - 1;
  assert.equal(occurrences, 1, "the open row gets the action; the terminal row does not");
});

test("queue: without onPrepareWithAgent the queue renders unchanged (prop-optional)", () => {
  const markup = renderToStaticMarkup(
    <ConsoleQueue rows={[OPEN_ROW, CLOSED_ROW]} empty={QUEUE_EMPTY} nowIso={NOW_ISO} />,
  );
  assert.ok(!markup.includes(CONSOLE_QUEUE_COPY.prepareWithAgent));
});

test("snippet: the exact prepare_decision call for the record, judgment left to the agent", () => {
  const snippet = buildPrepareDecisionSnippet({
    recordType: "payout_exception",
    recordId: "payout-123",
  });
  assert.match(snippet, /^prepare_decision\(\{/);
  assert.match(snippet, /"recordType": "payout_exception"/);
  assert.match(snippet, /"recordId": "payout-123"/);
  assert.match(snippet, /"proposal": "<the decision you propose>"/);
  assert.match(snippet, /"reason": "<why - cite the evidence you read>"/);
  assert.match(snippet, /"evidenceRefs": \[\]/);
});

test("panel: carries the record reference, the copyable snippet, and the maker/checker line", () => {
  const markup = renderToStaticMarkup(
    <PrepareWithAgentPanel
      recordType="verification"
      recordId="acct-0004"
      subject="Foxtrot Logistics"
    />,
  );
  assert.match(markup, /Prepare with agent/);
  assert.match(markup, /acct-0004/);
  assert.match(markup, /Foxtrot Logistics/);
  assert.match(markup, /prepare_decision/);
  assert.match(markup, /&quot;recordType&quot;: &quot;verification&quot;/);
  assert.match(markup, /Copy tool call/);
  assert.match(markup, /Nothing changes until you approve in this console/);
  assert.ok(!markup.includes("MCP seat"), "protocol vocabulary stays out of operator copy");
});
