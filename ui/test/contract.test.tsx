import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { Money, formatAmount } from "../registry/lib/money.js";
import { StatusPill } from "../registry/components/status-pill.js";
import { DataTable, type DataTableColumn } from "../registry/components/data-table.js";
import { Timeline } from "../registry/components/timeline.js";
import { BalanceCard } from "../registry/components/balance-card.js";
import { SidePanel } from "../registry/components/side-panel.js";

// These tests encode the design library's contract as executable
// invariants: money typography, state-never-colour-alone, the
// available/reserved composition, and the timeline's terminal rules.

test("money: true minus sign, tabular figures, trailing currency, em-dash empty", () => {
  assert.equal(formatAmount(-2.55), "−2.55", "true minus, not a hyphen");
  assert.equal(formatAmount(15230.5), "15,230.50");

  const html = renderToStaticMarkup(<Money amount={5} currency="EUR" />);
  assert.match(html, /tabular-nums/);
  assert.match(html, /5\.00/);
  assert.ok(html.indexOf("5.00") < html.indexOf("EUR"), "currency code trails the digits");
  assert.match(html, /font-size:0\.6em/, "code at ~0.6x the digits");

  const empty = renderToStaticMarkup(<Money amount={null} />);
  assert.match(empty, /—/, "empty numeric value renders an em-dash, never blank or 0.00");
});

test("money: debits are not red - the level is tonally neutral regardless of sign", () => {
  const debit = renderToStaticMarkup(<Money amount={-120} currency="EUR" />);
  assert.doesNotMatch(debit, /state-danger/, "red is reserved for failure, not money leaving");
  assert.match(debit, /−120\.00/);
});

test("status pill: every state renders word AND glyph (legible in greyscale)", () => {
  for (const intent of ["positive", "negative", "pending", "neutral", "active"] as const) {
    const html = renderToStaticMarkup(<StatusPill label="State" intent={intent} />);
    assert.match(html, /State/, `${intent}: word present`);
    assert.match(html, /aria-hidden="true"/, `${intent}: glyph present`);
  }
});

test("status pill: cancelled is a neutral terminal - grey with a return glyph, never red or green", () => {
  const html = renderToStaticMarkup(<StatusPill label="Cancelled" intent="neutral" />);
  assert.match(html, /↺/);
  assert.doesNotMatch(html, /state-danger|state-success/);
  assert.match(html, /border-radius:var\(--radius-pill\)/, "4px data-value rectangle, not fully rounded");
});

interface Row {
  id: string;
  who: string;
  amount: number | null;
}

const columns: DataTableColumn<Row>[] = [
  { key: "who", header: "Counterparty", cell: (r) => r.who },
  { key: "amount", header: "Amount", money: true, cell: (r) => (r.amount === null ? null : formatAmount(r.amount)) },
];

test("data table: money right-aligned tabular, empty cells em-dash, hairline header", () => {
  const html = renderToStaticMarkup(
    <DataTable
      columns={columns}
      rows={[
        { id: "1", who: "Acme GmbH", amount: 1200.5 },
        { id: "2", who: "No amount yet", amount: null },
      ]}
      rowKey={(r) => r.id}
    />,
  );
  assert.match(html, /text-align:right/, "money column right-aligned");
  assert.match(html, /tabular-nums/);
  assert.match(html, /—/, "null cell rendered as em-dash");
  assert.match(html, /height:32px/, "header row at 32px");
  assert.match(html, /height:var\(--row-pitch\)/, "row pitch is token-driven");
  assert.doesNotMatch(html, /box-shadow/, "no shadows in the base layer");
});

test("data table: selected row is tinted and marked", () => {
  const html = renderToStaticMarkup(
    <DataTable
      columns={columns}
      rows={[{ id: "1", who: "Acme", amount: 1 }]}
      rowKey={(r) => r.id}
      selectedKey="1"
    />,
  );
  assert.match(html, /data-selected="true"/);
  assert.match(html, /var\(--selected-tint\)/);
});

test("timeline: current is bold, future rail is dotted, terminal failure never shows a success check", () => {
  const html = renderToStaticMarkup(
    <Timeline
      steps={[
        { key: "a", label: "Created", state: "completed" },
        { key: "b", label: "Approval", state: "current" },
        { key: "c", label: "Payout", state: "future" },
      ]}
    />,
  );
  assert.match(html, /font-weight:600/, "current label bold");
  assert.match(html, /dotted/, "rail goes dotted at the current node");
  assert.match(html, /✓/, "completed node carries the check glyph");

  const cancelled = renderToStaticMarkup(
    <Timeline
      steps={[
        { key: "a", label: "Created", state: "completed" },
        { key: "b", label: "Cancelled", state: "cancelled" },
      ]}
    />,
  );
  // The most dangerous timeline error: a success-green check on a
  // cancelled step. The cancelled node must be neutral with ↺.
  const cancelledNode = cancelled.slice(cancelled.indexOf('data-state="cancelled"'));
  assert.match(cancelledNode, /↺/);
  assert.doesNotMatch(cancelledNode, /state-success/);

  const failed = renderToStaticMarkup(
    <Timeline steps={[{ key: "x", label: "Payout", state: "failed" }]} />,
  );
  assert.match(failed, /✕/);
  assert.doesNotMatch(failed, /state-success/);
});

test("balance card: available is the only figure above the rule; reserved has no colour or weight emphasis", () => {
  const html = renderToStaticMarkup(
    <BalanceCard
      available={15100.5}
      currency="EUR"
      buckets={[
        { label: "Total", amount: 15230.5 },
        { label: "Reserved in", amount: 0 },
        { label: "Reserved out, releases 14 Mar", amount: 130, locked: true },
      ]}
    />,
  );
  const rule = html.indexOf("border-top");
  assert.ok(rule > 0, "hairline rule present");
  const hero = html.indexOf("15,100.50");
  const total = html.indexOf("15,230.50");
  assert.ok(hero > 0 && hero < rule, "available sits above the rule");
  assert.ok(total > rule, "total is demoted below the rule");

  const bucketsHtml = html.slice(rule);
  assert.doesNotMatch(bucketsHtml, /state-danger|state-success|state-pending/, "reserved marked by position and scale, not colour");
  assert.match(bucketsHtml, /font-weight:400/, "reserved values carry no weight emphasis");
  assert.match(bucketsHtml, /🔒/, "padlock marks the unspendable bucket");
  assert.doesNotMatch(html, /box-shadow/, "balance card casts no shadow");
});

test("side panel: the hero is the amount, no scrim, keyboard footer chips present", () => {
  const html = renderToStaticMarkup(
    <SidePanel context="Transfer · 7 Aug 2026" amount={1240} currency="EUR" qualifier="Acme GmbH">
      <p>detail</p>
    </SidePanel>,
  );
  assert.match(html, /1,240\.00/);
  assert.ok(html.indexOf("1,240.00") < html.indexOf("Acme GmbH"), "amount leads, counterparty qualifies");
  assert.match(html, /↑/);
  assert.match(html, /↓/);
  assert.match(html, /Esc/);
  assert.doesNotMatch(html, /backdrop|scrim/, "no scrim: the table stays visible");
  assert.match(html, /box-shadow/, "the panel edge is an overlay boundary and may cast the shadow");
});
