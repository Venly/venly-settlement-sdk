import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { DataTable, TableSkeleton, type DataTableColumn } from "../registry/components/data-table.js";
import { unifiedColumns } from "../registry/blocks/activity.js";

type Row = { a: string; b: string };
const columns: DataTableColumn<Row>[] = [
  { key: "a", header: "Asset", cell: (r) => r.a },
  { key: "b", header: "Total", money: true, cell: (r) => r.b },
];

const cells = (html: string, tag: "th" | "td") =>
  (html.match(new RegExp(`<${tag}[\\s>]`, "g")) ?? []).length;

test("skeleton renders the same column count as the real table", () => {
  const real = renderToStaticMarkup(
    <DataTable columns={columns} rows={[{ a: "USDC", b: "1.00" }]} rowKey={(r) => r.a} />,
  );
  const skeleton = renderToStaticMarkup(<TableSkeleton columns={columns} rows={1} />);
  assert.equal(cells(skeleton, "th"), cells(real, "th"));
  assert.equal(cells(skeleton, "td"), cells(real, "td"));
});

test("skeleton keeps the real header labels, so nothing reflows on arrival", () => {
  const html = renderToStaticMarkup(<TableSkeleton columns={columns} />);
  assert.match(html, /Asset/);
  assert.match(html, /Total/);
  assert.match(html, /aria-busy="true"/);
});

test("row count is configurable and drives the placeholder rows", () => {
  const three = renderToStaticMarkup(<TableSkeleton columns={columns} rows={3} />);
  assert.equal(cells(three, "td"), 3 * columns.length);
});

// Drift guard: the balances block keeps a column *shape* for its skeleton
// because its real columns are built inside the view. If a column is added or
// renamed there, this fails and the shape must be updated with it.
test("balances skeleton shape matches the block's real headers", async () => {
  const src = await import("node:fs/promises").then((fs) =>
    fs.readFile(new URL("../registry/blocks/balances.tsx", import.meta.url), "utf8"),
  );
  const shapeBlock = src.slice(src.indexOf("BALANCE_COLUMN_SHAPE"), src.indexOf("export function BalancesView"));
  const shapeHeaders = [...shapeBlock.matchAll(/header: "([^"]+)"/g)].map((m) => m[1]);
  const realHeaders = [...src.slice(src.indexOf("export function BalancesView")).matchAll(/header: "([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(shapeHeaders, realHeaders);
});

test("activity loading states reuse the real column definitions", () => {
  const html = renderToStaticMarkup(<TableSkeleton columns={unifiedColumns()} />);
  assert.equal(cells(html, "th"), unifiedColumns().length);
});
