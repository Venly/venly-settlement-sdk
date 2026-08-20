import { test } from "node:test";
import assert from "node:assert/strict";
import { collectTransfersForPeriod } from "../src/queries.js";
import { mockClients } from "./helpers.js";

const ACCT = "a10c2d31-2222-4b20-8c63-000000000001";
const YEAR = { start: "2026-01-01T00:00:00.000Z", end: "2026-12-31T23:59:59.999Z" };

test("collectTransfersForPeriod pages past a single page of 20", async () => {
  const clients = mockClients();
  const page = await clients.finance.transfers.list(ACCT, { page: 1, size: 20 });
  assert.equal(page.resultPresent, true);
  assert.ok(page.items.length <= 20, "one page is at most 20");
  assert.equal(page.pagination?.hasNextPage, true, "the mock has a second page at size 20");

  const collected = await collectTransfersForPeriod(
    (query) => clients.finance.transfers.list(ACCT, query),
    YEAR,
    20,
  );
  assert.equal(collected.resultPresent, true);
  assert.ok(
    collected.ledger.length > page.items.length,
    `ledger ${collected.ledger.length} must exceed first page ${page.items.length}`,
  );
  assert.ok(collected.items.length > 20, "the year window contains more than one page of rows");
  assert.ok(collected.items.every((t) => t.createdAt && t.createdAt >= YEAR.start && t.createdAt <= YEAR.end));
});
