/**
 * Renders the UI kit's five components into a static demo page for visual
 * verification. Not shipped; run with:  npx tsx demo/render.tsx
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { Money, formatAmount } from "../registry/lib/money.js";
import { StatusPill } from "../registry/components/status-pill.js";
import { DataTable, RowText, type DataTableColumn } from "../registry/components/data-table.js";
import { Timeline } from "../registry/components/timeline.js";
import { BalanceCard } from "../registry/components/balance-card.js";
import { SidePanel } from "../registry/components/side-panel.js";

const here = dirname(fileURLToPath(import.meta.url));
const tokens = readFileSync(join(here, "../registry/styles/tokens.css"), "utf8");

interface Row {
  id: string;
  who: string;
  detail: string;
  status?: { label: string; intent: "positive" | "negative" | "pending" | "neutral" };
  amount: number | null;
}

const rows: Row[] = [
  { id: "1", who: "Nordwind Logistics", detail: "SEPA · VF-2026-0812", status: { label: "Settled", intent: "positive" }, amount: 12400.0 },
  { id: "2", who: "Atlas Components GmbH", detail: "SEPA · VF-2026-0813", status: { label: "Awaiting approval", intent: "pending" }, amount: -4890.25 },
  { id: "3", who: "Riverstone BV", detail: "SWIFT · VF-2026-0814", amount: 730.1 },
  { id: "4", who: "Cobalt Freight", detail: "SEPA · VF-2026-0815", status: { label: "Cancelled", intent: "neutral" }, amount: -1200.0 },
  { id: "5", who: "Helios Analytics", detail: "Internal", status: { label: "Failed", intent: "negative" }, amount: null },
];

const columns: DataTableColumn<Row>[] = [
  {
    key: "who",
    header: "Counterparty",
    cell: (r) => (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
        <RowText primary={r.who} secondary={r.detail} />
        {r.status ? <StatusPill label={r.status.label} intent={r.status.intent} /> : null}
      </span>
    ),
  },
  { key: "date", header: "Date", cell: () => "7 Aug 2026" },
  { key: "amount", header: "Amount", money: true, cell: (r) => (r.amount === null ? null : <Money amount={r.amount} currency="EUR" />) },
];

const page = renderToStaticMarkup(
  <div style={{ fontFamily: "var(--font-family)", background: "var(--surface-page)", minHeight: "100vh", padding: "28px 32px", position: "relative" }}>
    <h1 style={{ fontSize: "var(--font-size-title)", fontWeight: 600, color: "var(--text-primary)", margin: "0 0 20px" }}>
      Payments
    </h1>
    <div style={{ display: "flex", gap: 24, alignItems: "flex-start", marginBottom: 24 }}>
      <BalanceCard
        available={15100.5}
        currency="EUR"
        qualifier="Spendable now · settles from the EUR account"
        buckets={[
          { label: "Total", amount: 15230.5 },
          { label: "Reserved in", amount: 0 },
          { label: "Reserved out, releases 14 Aug", amount: 130, locked: true },
        ]}
      />
      <section style={{ background: "var(--surface-raised)", border: "1px solid var(--border-hairline)", borderRadius: "var(--radius-card)", padding: 22, width: 280 }}>
        <div style={{ fontSize: "var(--font-size-label)", color: "var(--text-secondary)", marginBottom: 10 }}>
          Transfer tracking · 2 of 4
        </div>
        <Timeline
          steps={[
            { key: "a", label: "Created", meta: "Today, 09:12", state: "completed" },
            { key: "b", label: "Approved", meta: "Today, 09:40", state: "completed" },
            { key: "c", label: "Processing", meta: "Est. under 2 hours", state: "current" },
            { key: "d", label: "Paid out", state: "future" },
          ]}
        />
      </section>
    </div>
    <section style={{ background: "var(--surface-raised)", border: "1px solid var(--border-hairline)", borderRadius: "var(--radius-card)", overflow: "hidden", maxWidth: 860 }}>
      <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} selectedKey="2" />
    </section>

    <section style={{ marginTop: 28, maxWidth: 860 }}>
      <div style={{ fontSize: "var(--font-size-label)", color: "var(--text-secondary)", marginBottom: 8 }}>
        Greyscale legibility check – state hues mapped to greys; glyphs must still discriminate
      </div>
      <div className="greyscale" style={{ display: "inline-flex", gap: 8, padding: 12, background: "var(--surface-raised)", border: "1px solid var(--border-hairline)", borderRadius: "var(--radius-card)" }}>
        <StatusPill label="Settled" intent="positive" />
        <StatusPill label="Awaiting approval" intent="pending" />
        <StatusPill label="Failed" intent="negative" />
        <StatusPill label="Cancelled" intent="neutral" />
        <StatusPill label="Processing" intent="active" />
      </div>
    </section>

    <SidePanel
      context="Transfer · 7 Aug 2026"
      amount={-4890.25}
      currency="EUR"
      qualifier="Atlas Components GmbH · SEPA · VF-2026-0813"
    >
      <div style={{ fontSize: "var(--font-size-label)", color: "var(--text-secondary)", marginBottom: 6 }}>
        Approval
      </div>
      <Timeline
        steps={[
          { key: "1", label: "Created by ana@acme.eu", meta: "09:12", state: "completed" },
          { key: "2", label: "Awaiting a second approver", meta: "The creator cannot approve their own request", state: "current" },
          { key: "3", label: "Execution", state: "future" },
        ]}
      />
      <div style={{ marginTop: 16, fontSize: "var(--font-size-body)", color: "var(--text-primary)" }}>
        Fee {formatAmount(4.5)} EUR · Net {formatAmount(4885.75)} EUR
      </div>
    </SidePanel>
  </div>,
);

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Venly UI – component demo</title>
<style>
${tokens}
* { box-sizing: border-box; }
body { margin: 0; }
.greyscale { filter: grayscale(1); }
</style>
</head>
<body>${page}</body>
</html>
`;

mkdirSync(join(here, "out"), { recursive: true });
writeFileSync(join(here, "out/index.html"), html);
console.log("wrote", join(here, "out/index.html"));
