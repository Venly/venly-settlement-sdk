import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import {
  CONSOLE_DECISION_COPY,
  ConsoleDecisionPanel,
  DecisionForm,
  DualTimeline,
  EvidenceStack,
  PlatformSection,
  type DualTimelineNode,
  type EvidenceRow,
} from "../registry/blocks/console-decision.js";

// ─── Evidence stack: value or labelled omission, no third option ─────────────

test("evidence: an omission is a first-class type and renders its copy, never a placeholder", () => {
  const rows: EvidenceRow[] = [
    { kind: "value", label: "Identity verification", value: "COMPLETED" },
    {
      kind: "omission",
      label: "Screening result",
      copy: "Screening result is held on Venly's internal platform and is not exposed on this API.",
    },
  ];
  const markup = renderToStaticMarkup(<EvidenceStack rows={rows} />);
  assert.match(markup, /COMPLETED/);
  assert.match(markup, /held on Venly&#x27;s internal platform/);
  // The omission implies nothing: no pill, no value word, no copy control.
  assert.ok(!markup.includes("Copy Screening result"), "an omission has no copy affordance");
  assert.ok(!/Screening result[^<]*(clean|pending|passed)/i.test(markup));
});

test("evidence: a value row keeps the field-list affordances", () => {
  const markup = renderToStaticMarkup(
    <EvidenceStack rows={[{ kind: "value", label: "Case reference", value: "IV-FOXTROT-0071", mono: true }]} />,
  );
  assert.match(markup, /IV-FOXTROT-0071/);
  assert.match(markup, /Copy Case reference/);
});

// ─── Decision form: the badge, the version, the conflict ─────────────────────

test("decision form: the reason input always carries the console-note badge", () => {
  const markup = renderToStaticMarkup(
    <DecisionForm version={3} onDecide={() => {}} seat="integrator" />,
  );
  assert.match(markup, /Console note – not on the API/);
  assert.match(markup, /data-badge="console-note"/);
  assert.match(markup, /Deciding against revision 3/);
});

test("decision form: platform seat renders inside the badged section boundary", () => {
  const markup = renderToStaticMarkup(<DecisionForm version={1} onDecide={() => {}} />);
  assert.match(markup, /Platform view \(Venly\)/);
  assert.match(markup, /Your team does not perform this in production/);
  assert.match(markup, /data-seat="platform"/);
});

test("decision form: a driver control says it is one", () => {
  const markup = renderToStaticMarkup(<DecisionForm version={1} driver onDecide={() => {}} />);
  assert.match(markup, /Demo driver – not a contract operation/);
});

test("decision form: conflict means re-decide against fresh state, never auto-retry", () => {
  const markup = renderToStaticMarkup(
    <DecisionForm version={2} conflict onRefreshAfterConflict={() => {}} onDecide={() => {}} />,
  );
  assert.match(markup, /Someone decided first/);
  assert.match(markup, /Review fresh state/);
  assert.ok(!/retry/i.test(markup), "no retry language, no retry control");
  assert.ok(!markup.includes("Approve"), "the decision buttons are gone until the state is fresh");
});

// ─── Dual timeline ───────────────────────────────────────────────────────────

const decisionNodes: DualTimelineNode[] = [
  {
    kind: "node",
    key: "iv",
    label: "Screening completed",
    state: "completed",
    actor: "Identity provider",
    at: "2026-08-17T14:05:00Z",
  },
  { kind: "system", key: "resync" },
  {
    kind: "node",
    key: "approve",
    label: "Account approved",
    state: "completed",
    actor: "Operator",
    role: "Reviewer",
    at: "2026-08-21T09:30:00Z",
  },
];

test("dual timeline: two named columns, actor + role + tz-qualified stamps per node", () => {
  const markup = renderToStaticMarkup(
    <DualTimeline
      decision={decisionNodes}
      money={[{ kind: "node", key: "t", label: "Transfer settled", state: "completed", at: "2026-08-20T10:00:00Z" }]}
    />,
  );
  assert.match(markup, /Decision/);
  assert.match(markup, /Money movement/);
  assert.match(markup, /Operator · Reviewer ·/);
  // formatStamp is timezone-qualified: the stamp carries a zone name.
  assert.match(markup, /UTC|GMT|[A-Z]{2,4}T/, "stamps carry their zone");
});

test("dual timeline: a resync is a thin grey system line, never a decision node", () => {
  const markup = renderToStaticMarkup(<DualTimeline decision={decisionNodes} money={[]} />);
  assert.match(markup, /data-system-line/);
  assert.match(markup, /View refreshed from another window/);
  const empty = renderToStaticMarkup(<DualTimeline decision={[]} money={[]} />);
  assert.match(empty, /No events yet for this record/);
});

// ─── The panel ───────────────────────────────────────────────────────────────

test("panel: a KYC decision heroes the subject and whose-move, never an em-dash amount", () => {
  const markup = renderToStaticMarkup(
    <ConsoleDecisionPanel
      context="Customer · cast-reviewable"
      subject="Foxtrot Logistics"
      derivation={{ kind: "actor", actor: "OPERATOR", state: "Review – decision owed" }}
      statusPill={{ label: "Verification pending", intent: "pending" }}
    />,
  );
  assert.match(markup, /Foxtrot Logistics/);
  assert.match(markup, /Your move/);
  assert.ok(!markup.includes("—"), "no em-dash hero claiming a missing amount");
});

test("panel: a payout heroes the amount, subject demoted to the qualifier line", () => {
  const markup = renderToStaticMarkup(
    <ConsoleDecisionPanel
      context="Payout"
      subject="Cygnus EUR settlement"
      derivation={{ kind: "actor", actor: "PROVIDER", state: "At the provider" }}
      amount={2650}
      currency="USDC"
    />,
  );
  assert.match(markup, /2,650/);
  assert.match(markup, /USDC/);
  assert.match(markup, /Cygnus EUR settlement/);
});

test("platform section is a boundary with a hairline, not a colour fill", () => {
  const markup = renderToStaticMarkup(<PlatformSection>x</PlatformSection>);
  assert.match(markup, /border-top/);
  assert.ok(!markup.includes("--state-"), "no colour fill: a coloured badge reads as a status pill");
  assert.equal(CONSOLE_DECISION_COPY.platformBadgeLabel, "Platform view (Venly)");
});
