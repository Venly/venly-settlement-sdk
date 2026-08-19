import test from "node:test";
import assert from "node:assert/strict";
import { VenlyFinanceClient } from "../dist/esm/index.js";
// seedProfiles and MockLedgerError are NOT on the package barrel: adding them
// needs one line in src/index.ts, which this slice's brief forbids. A relative
// deep import is not gated by the exports map and resolves to the same module
// instance the client itself imports, so the test is honest about what ships.
import { FinanceMockTransport, seedProfiles, MockLedgerError } from "../dist/esm/mock/index.js";

const MAIN = "a10c2d31-2222-4b20-8c63-000000000001";   // acct-main-eur, USDC + EURC
const OPS = "a10c2d31-2222-4b20-8c63-000000000002";    // acct-ops-usd, USDC
const ESCROW = "a10c2d31-2222-4b20-8c63-000000000006"; // acct-escrow, fully reserved
const PAYOUTS = "a10c2d31-2222-4b20-8c63-000000000005";
const ACTIVE_ROUTE = "pr9e3b21-cccc-4f20-8da3-000000000001";
const VBA_MAIN = "vb7e5f19-4444-4d40-ae85-000000000001"; // EUR -> USDC

const mock = () => new VenlyFinanceClient({ environment: "mock" });
const key = (n) => `${String(n).padStart(8, "0")}-1111-4111-8111-111111111111`;
const usdc = async (f, acct) =>
  (await f.wallets.list(acct)).items.find((w) => w.asset === "USDC")?.amount ?? { total: 0, available: 0, reserved: 0 };

// ── Criterion 1: conservation ──────────────────────────────────────────

test("ledger: an internal transfer conserves the asset total; external legs move it", async () => {
  const f = mock();
  const sim = f.mock.simulations;
  const before = sim.ledger.snapshot().totalsByAsset.USDC;

  // Internal: sender debited, receiver credited, sum unchanged.
  const t = await f.transfers.createFiat(MAIN, {
    receiverExternalId: "acct-ops-usd", amount: 300, currency: "USD", idempotencyKey: key(1),
  });
  sim.transfer.advance(t.id, "COMPLETED");
  assert.equal(
    sim.ledger.snapshot().totalsByAsset.USDC, before,
    "an internal transfer moves money between accounts, not into or out of the system",
  );

  // External inflow: an inbound credit raises the total by exactly its amount.
  sim.inbound.credit(VBA_MAIN, 750);
  assert.equal(sim.ledger.snapshot().totalsByAsset.USDC, before + 750);

  // External outflow: a payout leaving the wallet lowers it.
  const payout = await f.payouts.request(PAYOUTS, {
    payoutRouteId: ACTIVE_ROUTE, cryptoAmount: 200, idempotencyKey: key(2),
  });
  sim.payout.advance(payout.id, "SENDING");
  assert.equal(sim.ledger.snapshot().totalsByAsset.USDC, before + 750 - 200);

  // ...and a return brings it back.
  sim.payout.advance(payout.id, "RETURNED");
  assert.equal(sim.ledger.snapshot().totalsByAsset.USDC, before + 750);
  sim.ledger.verify();
});

test("ledger: a hold moves available without moving total", async () => {
  const f = mock();
  const start = await usdc(f, MAIN);
  const t = await f.transfers.createFiat(MAIN, {
    receiverExternalId: "acct-ops-usd", amount: 500, currency: "USD", idempotencyKey: key(3),
  });
  const held = await usdc(f, MAIN);
  assert.equal(held.total, start.total, "money is committed, not yet gone");
  assert.equal(held.available, start.available - 500);
  assert.equal(held.reserved, start.reserved + 500);

  f.mock.simulations.transfer.advance(t.id, "COMPLETED");
  const settled = await usdc(f, MAIN);
  assert.equal(settled.total, start.total - 500, "now it is gone");
  assert.equal(settled.reserved, start.reserved);
});

test("ledger: sub-cent dust survives arithmetic (no float drift)", async () => {
  const f = mock();
  const sim = f.mock.simulations;
  const eurc = () => sim.ledger.snapshot().rows.find((r) => r.accountId === MAIN && r.asset === "EURC");
  assert.equal(eurc().total, 8020.000875, "the seeded dust is exact");
  for (let i = 0; i < 20; i += 1) sim.inbound.credit("vb7e5f19-4444-4d40-ae85-000000000002", 0.000001);
  sim.ledger.verify();
  assert.equal(eurc().total, 8020.000875, "credits landed on the other account, not this one");
});

test("ledger: precision finer than the asset allows is refused, not rounded", async () => {
  const f = mock();
  assert.throws(
    () => f.mock.simulations.inbound.credit(VBA_MAIN, 1.0000001), // USDC has 6 decimals
    MockLedgerError,
    "silent rounding is how a ledger loses money",
  );
});

// ── Criterion 2: lifecycle ─────────────────────────────────────────────

test("ledger: every documented payout status drives the phase table", async () => {
  const walk = async (statuses) => {
    const f = mock();
    const sim = f.mock.simulations;
    const before = (await usdc(f, PAYOUTS)).total;
    const p = await f.payouts.request(PAYOUTS, {
      payoutRouteId: ACTIVE_ROUTE, cryptoAmount: 100, idempotencyKey: key(9),
    });
    for (const s of statuses) sim.payout.advance(p.id, s);
    sim.ledger.verify();
    return (await usdc(f, PAYOUTS)).total - before;
  };

  assert.equal(await walk(["SENDING", "COMPLETED"]), -100, "completed money is gone");
  assert.equal(await walk(["SENDING", "PROVIDER_PROCESSING", "RETURNED"]), 0, "a return re-credits");
  assert.equal(await walk(["SENDING", "COMPLETED", "RETURNED"]), 0, "COMPLETED -> RETURNED re-credits");
  assert.equal(await walk(["SENDING", "PROVIDER_PROCESSING", "REJECTED"]), 0, "rejected after sending comes back");
  assert.equal(await walk(["REJECTED"]), 0, "rejected before sending releases the hold");
  assert.equal(await walk(["FAILED", "RETURNED"]), 0, "RELEASED <-> RETURNED is narrative, not financial");
});

test("ledger: advancing twice to the same status is a no-op", async () => {
  const f = mock();
  const sim = f.mock.simulations;
  const p = await f.payouts.request(PAYOUTS, {
    payoutRouteId: ACTIVE_ROUTE, cryptoAmount: 60, idempotencyKey: key(10),
  });
  sim.payout.advance(p.id, "SENDING");
  const once = (await usdc(f, PAYOUTS)).total;
  sim.payout.advance(p.id, "SENDING");
  sim.payout.advance(p.id, "SENDING");
  assert.equal((await usdc(f, PAYOUTS)).total, once, "a repeated transition must not debit again");
});

test("ledger: a terminal phase does not re-arm", async () => {
  const f = mock();
  const sim = f.mock.simulations;
  const p = await f.payouts.request(PAYOUTS, {
    payoutRouteId: ACTIVE_ROUTE, cryptoAmount: 45, idempotencyKey: key(11),
  });
  sim.payout.advance(p.id, "REJECTED");
  assert.throws(() => sim.payout.advance(p.id, "SENDING"), MockLedgerError,
    "money already given back cannot be spent again");
});

// ── Criterion 3 + 4: seed consistency, atomicity, refusal ──────────────

test("ledger: the shipped seeds satisfy the invariants at construction and after reset", () => {
  const f = mock();
  f.mock.simulations.ledger.verify();
  f.mock.reset();
  f.mock.simulations.ledger.verify();
});

test("ledger: acct-escrow's reserve is backed by a real hold", async () => {
  const f = mock();
  const snap = f.mock.simulations.ledger.snapshot();
  const row = snap.rows.find((r) => r.accountId === ESCROW && r.asset === "USDC");
  assert.equal(row.available, 0, "every unit is committed");
  assert.equal(row.reserved, 4200);
  const hold = snap.holds.find((h) => h.accountId === ESCROW);
  assert.ok(hold, "a reserve with no hold behind it is money the fixtures cannot account for");
  assert.equal(hold.amount, 4200);
});

test("ledger: a spent credit cannot be reversed, and the refusal writes nothing", async () => {
  const f = mock();
  const sim = f.mock.simulations;

  // MAIN -> OPS, settled. OPS now holds the credit.
  const first = await f.transfers.createFiat(MAIN, {
    receiverExternalId: "acct-ops-usd", amount: 1000, currency: "USD", idempotencyKey: key(20),
  });
  sim.transfer.advance(first.id, "COMPLETED");

  // OPS spends everything it has.
  const opsBalance = (await usdc(f, OPS)).available;
  const second = await f.transfers.createFiat(OPS, {
    receiverExternalId: "acct-main-eur", amount: opsBalance, currency: "USD", idempotencyKey: key(21),
  });
  sim.transfer.advance(second.id, "COMPLETED");

  const before = sim.ledger.snapshot();
  assert.throws(() => sim.transfer.advance(first.id, "FAILED"), MockLedgerError,
    "the money has already moved on");
  assert.deepEqual(sim.ledger.snapshot(), before,
    "a refused transition leaves NO delta - not the sender leg either");
});

test("ledger: insufficient funds is a 402, and acct-escrow proves available != total", async () => {
  const f = mock();
  await assert.rejects(
    f.transfers.createFiat(ESCROW, {
      receiverExternalId: "acct-ops-usd", amount: 1, currency: "USD", idempotencyKey: key(22),
    }),
    (e) => e.status === 402 && e.errors[0].code === "insufficient-funds",
    "4200 total, 0 available: a UI reading total as spendable is lying",
  );
});

// ── Criterion 6: idempotency replay parity ─────────────────────────────

test("transfers: replay parity with requestPayout", async () => {
  const f = mock();
  const sim = f.mock.simulations;
  const k = key(30);
  const body = { receiverExternalId: "acct-ops-usd", amount: 250, currency: "USD", idempotencyKey: k };

  const before = await usdc(f, MAIN);
  const first = await f.transfers.createFiat(MAIN, body);
  const replay = await f.transfers.createFiat(MAIN, body);
  assert.equal(replay.id, first.id, "same key + same body returns the original");
  assert.equal((await usdc(f, MAIN)).available, before.available - 250, "and debits once");
  assert.equal((await f.transfers.list(MAIN)).items.filter((t) => t.id === first.id).length, 1);

  await assert.rejects(
    f.transfers.createFiat(MAIN, { ...body, amount: 900 }),
    (e) => e.status === 409 && e.errors[0].code === "concurrent-modification",
    "same key + different body conflicts",
  );
  sim.ledger.verify();
});

test("transfers: a failed intent stays failed on replay", async () => {
  const f = mock();
  const body = {
    receiverExternalId: "acct-ops-usd", amount: 999999, currency: "USD", idempotencyKey: key(31),
  };
  await assert.rejects(f.transfers.createFiat(MAIN, body), (e) => e.status === 402);
  await assert.rejects(f.transfers.createFiat(MAIN, body), (e) => e.status === 409,
    "a replayed failure is a conflict, not a retry");
});

test("transfers: crypto creator has the same parity", async () => {
  const f = mock();
  const body = {
    receiverExternalId: "acct-ops-usd", chain: "BASE", asset: "USDC", amount: 40, idempotencyKey: key(32),
  };
  const first = await f.transfers.createCrypto(MAIN, body);
  const replay = await f.transfers.createCrypto(MAIN, body);
  assert.equal(replay.id, first.id);
});

// ── Criterion 5: deterministic reset ───────────────────────────────────

test("determinism: a scripted run replays deep-equal after reset", async () => {
  const t = new FinanceMockTransport({ deterministic: true });
  const f = new VenlyFinanceClient({ environment: "mock" });
  // Drive the deterministic transport directly: the client constructor takes
  // no options, so this is the in-path way to reach one.
  const run = async () => {
    await t.request("POST", `/accounts/${MAIN}/transfers/fiat`, {
      body: { receiverExternalId: "acct-ops-usd", amount: 125, currency: "USD", idempotencyKey: key(40) },
      idempotencyKey: key(40),
    });
    t.simulations.inbound.credit(VBA_MAIN, 60);
    return {
      ledger: t.simulations.ledger.snapshot(),
      events: t.simulations.events.list().map((e) => ({ ...e, id: `${e.epoch}:${e.sequence}`, originId: "x" })),
    };
  };
  const a = await run();
  t.simulations.reset();
  const b = await run();
  assert.deepEqual(b.ledger, a.ledger, "same script, same balances");
  assert.deepEqual(
    b.events.map((e) => [e.type, e.occurredAt]),
    a.events.map((e) => [e.type, e.occurredAt]),
    "same script, same event stream and timestamps",
  );
  void f;
});

// ── Criterion 9: demoCast ──────────────────────────────────────────────

test("demoCast: six personas, every state contract-real", async () => {
  const t = new FinanceMockTransport();
  t.simulations.seed(seedProfiles.demoCast);
  const sim = t.simulations;
  sim.ledger.verify();

  const parties = t.$store.parties;
  const accounts = t.$store.accounts;
  assert.equal(accounts.length, 6, "six personas");

  // 1. approved and transacting
  const transacting = accounts.find((a) => a.externalId === "cast-transacting");
  assert.equal(transacting.kycStatus, "VERIFIED");
  assert.ok(t.$store.transfers.some((x) => x.senderAccountId === transacting.id && x.status === "COMPLETED"));

  // 2. identity verification in flight, readable through the contract route
  const atlas = parties.find((p) => p.companyName === "Atlas Imports");
  const iv = await t.request("GET", `/parties/${atlas.id}/iv-verification`);
  assert.equal(iv.result.status, "SUBMITTED");

  // 3. a route awaiting ownership proof
  assert.ok([...t.$store.payoutRoutes.values()].flat().some((r) => r.status === "AWAITING_OWNERSHIP_PROOF"));

  // 4 + 6. a payout at the provider, and one that came back
  assert.ok(t.$store.payouts.some((p) => p.status === "PROVIDER_PROCESSING"));
  const returned = t.$store.payouts.find((p) => p.status === "RETURNED");
  assert.ok(returned && returned.failureReason, "a return always explains itself");

  // 5. a DENIED organisation, and the decision that produced it
  const delta = parties.find((p) => p.companyName === "Delta Holdings");
  assert.equal(delta.kybStatus, "DENIED", "DENIED lives on kybStatus; kycStatus uses REJECTED");
  assert.ok(
    sim.events.list().some((e) => e.type === "party.verification_changed" && e.resource.id === delta.id),
    "a refusal is a decision someone made, so it carries an event",
  );
});

test("demoCast: an unverified party's IV reads NOT_LINKED rather than 404", async () => {
  const t = new FinanceMockTransport();
  t.simulations.seed(seedProfiles.demoCast);
  const nova = t.$store.parties.find((p) => p.companyName === "Nova Retail");
  const iv = await t.request("GET", `/parties/${nova.id}/iv-verification`);
  assert.equal(iv.result.status, "NOT_LINKED", "IV is a state every party has, not a resource some lack");
});
