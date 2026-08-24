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

/**
 * Replication is asynchronous, so a fixed sleep is a race: BroadcastChannel
 * dispatch on a contended runner can outlast any constant (a 40ms wait here
 * failed in CI while >100ms deliveries were measured under load). Poll the
 * condition instead and fail only when it never arrives.
 */
const waitFor = async (predicate, what, timeoutMs = 2000) => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (predicate()) return;
    if (Date.now() > deadline) throw new Error(`timed out waiting for: ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

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

test("ledger: the seeded sub-cent dust round-trips exactly", async () => {
  const f = mock();
  const sim = f.mock.simulations;
  const eurc = () => sim.ledger.snapshot().rows.find((r) => r.accountId === MAIN && r.asset === "EURC");
  assert.equal(eurc().total, 8020.000875, "six decimals of seeded dust, exact through BigInt round-trip");
  // Move the dust and put it back: a float ledger drifts, this must not.
  const t = await f.transfers.createFiat(MAIN, {
    receiverExternalId: "acct-treasury", amount: 0.000875, currency: "EUR", idempotencyKey: key(62),
  });
  sim.transfer.advance(t.id, "COMPLETED");
  assert.equal(eurc().total, 8020, "exactly the dust left, nothing more");
  sim.ledger.verify();
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
      // The contract permits normalising exactly two things: `epoch`, which
      // increments on every reset by design, and `originId`, which identifies
      // the replica. Everything else - including every minted id inside `data`
      // - must match.
      events: t.simulations.events
        .list()
        .map((e) => ({ ...e, epoch: 0, id: `${e.sequence}`, originId: "x" })),
    };
  };
  const a = await run();
  t.simulations.reset();
  const b = await run();
  assert.deepEqual(b.ledger, a.ledger, "same script, same balances");
  // The whole event, not just its type and timestamp: `data` carries the minted
  // ids, hashes and addresses that deterministic mode exists to pin, and they
  // are the values most likely to drift.
  assert.deepEqual(b.events, a.events, "same script, same events including every minted id");
  void f;
});

// ── Criterion 9: demoCast ──────────────────────────────────────────────

test("demoCast: seven personas, every state contract-real", async () => {
  const t = new FinanceMockTransport();
  t.simulations.seed(seedProfiles.demoCast);
  const sim = t.simulations;
  sim.ledger.verify();

  const parties = t.$store.parties;
  const accounts = t.$store.accounts;
  assert.equal(accounts.length, 7, "seven personas");

  // 1. approved and transacting
  const transacting = accounts.find((a) => a.externalId === "cast-transacting");
  assert.equal(transacting.kycStatus, "VERIFIED");
  assert.ok(t.$store.transfers.some((x) => x.senderAccountId === transacting.id && x.status === "COMPLETED"));

  // 2. identity verification in flight, readable through the contract route
  const atlas = parties.find((p) => p.name === "Atlas Imports");
  const iv = await t.request("GET", `/parties/${atlas.id}/iv-verification`);
  assert.equal(iv.result.status, "SUBMITTED");

  // 3. a route awaiting ownership proof
  assert.ok([...t.$store.payoutRoutes.values()].flat().some((r) => r.status === "AWAITING_OWNERSHIP_PROOF"));

  // 4 + 6. a payout at the provider, and one that came back
  assert.ok(t.$store.payouts.some((p) => p.status === "PROVIDER_PROCESSING"));
  const returned = t.$store.payouts.find((p) => p.status === "RETURNED");
  assert.ok(returned && returned.failureReason, "a return always explains itself");

  // 5. a DENIED organisation, and the decision that produced it - on BOTH
  // planes: the driver acts on a party or an account, never both, so the
  // profile drives each. An account left VERIFICATION_PENDING under a
  // refused party would read as a decision still owed on a refused subject.
  const delta = parties.find((p) => p.name === "Delta Holdings");
  assert.equal(delta.kybStatus, "DENIED", "DENIED lives on kybStatus; kycStatus uses REJECTED");
  assert.ok(
    sim.events.list().some((e) => e.type === "party.verification_changed" && e.resource.id === delta.id),
    "a refusal is a decision someone made, so it carries an event",
  );
  const deniedAccount = accounts.find((a) => a.externalId === "cast-denied");
  assert.equal(deniedAccount.kycStatus, "REJECTED", "the refused subject's account carries the refusal too");
  assert.ok(
    sim.events.list().some(
      (e) => e.type === "account.verification_changed" && e.resource.id === deniedAccount.id,
    ),
    "the account decision carries its event too",
  );

  // 7. screening complete, account decision owed - the review-queue row.
  const reviewable = accounts.find((a) => a.externalId === "cast-reviewable");
  assert.equal(reviewable.kycStatus, "VERIFICATION_PENDING", "the account decision is still open");
  const foxtrot = parties.find((p) => p.name === "Foxtrot Logistics");
  assert.equal(foxtrot.kybStatus, "VERIFIED", "the party itself is fine - the ACCOUNT decision is the open one");
  const foxtrotIv = await t.request("GET", `/parties/${foxtrot.id}/iv-verification`);
  assert.equal(foxtrotIv.result.status, "COMPLETED", "evidence is in; the decision is owed");
});

test("demoCast: an unverified party's IV reads NOT_LINKED rather than 404", async () => {
  const t = new FinanceMockTransport();
  t.simulations.seed(seedProfiles.demoCast);
  const nova = t.$store.parties.find((p) => p.name === "Nova Retail");
  const iv = await t.request("GET", `/parties/${nova.id}/iv-verification`);
  assert.equal(iv.result.status, "NOT_LINKED", "IV is a state every party has, not a resource some lack");
});

// ── Messages a stranger will hit ───────────────────────────────────────
// These assert on user-facing copy on purpose: an unfunded account is the
// FIRST thing a new reader hits, and a message that explains the mock's
// internals instead of the next action leaves them stuck.

test("copy: the insufficient-funds message names what you have and how to fund it", async () => {
  const f = mock();
  const party = await f.parties.create({ partyType: "INDIVIDUAL", firstName: "Ada", lastName: "Lovelace" });
  const acct = await f.accounts.create({ externalId: "copy-probe", chain: "BASE", partyId: party.id });
  await assert.rejects(
    f.transfers.createFiat(acct.id, {
      receiverExternalId: "acct-ops-usd", currency: "EUR", amount: 25, idempotencyKey: key(50),
    }),
    (e) => {
      const m = e.errors[0].message;
      assert.match(m, /has 0 EURC available/, "says what the account actually holds");
      assert.match(m, /needs 25/, "says what the operation wanted");
      assert.match(m, /simulations\.inbound\.credit/, "says how to fix it");
      assert.match(m, /No part of this operation was applied/, "says nothing was half-done");
      return e.status === 402;
    },
  );
});

test("copy: a replayed failure explains that it needs a new key", async () => {
  const f = mock();
  const body = { receiverExternalId: "acct-ops-usd", amount: 999999, currency: "USD", idempotencyKey: key(51) };
  await assert.rejects(f.transfers.createFiat(MAIN, body), (e) => e.status === 402);
  await assert.rejects(f.transfers.createFiat(MAIN, body), (e) => {
    assert.match(e.errors[0].message, /issue a new idempotency key/, "a 409 must say what to do next");
    return e.status === 409;
  });
});

test("copy: no internal register id or rule label reaches a shipped string", async () => {
  const { readFileSync, readdirSync } = await import("node:fs");
  const dir = new URL("../dist/esm/mock/", import.meta.url);
  const offenders = [];
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".js") && !file.endsWith(".d.ts")) continue;
    const text = readFileSync(new URL(file, dir), "utf8");
    // Register ids (MG-*, D-numbers) and invariant labels (I1/I2/I5) are
    // shorthand for documents a consumer does not have.
    for (const pattern of [
      /\bMG-\d+/g,
      /\bI[1-5]\b/g,
      /mock-gap ledger/g,
      /gap register/g,
      // Bug history reads as documentation to nobody: a stranger hovering a
      // symbol should not be told about a defect they never experienced. This
      // class has recurred twice, so the guard covers the class. Deliberately
      // narrow — "no longer" is ordinary present-tense English ("the receiver
      // no longer holds it") and matching it would train people to disable
      // this test rather than fix it.
      /\b(used to|Before this|Previously,)\b/g,
    ]) {
      for (const hit of text.match(pattern) ?? []) offenders.push(`${file}: ${hit}`);
    }
  }
  assert.deepEqual(offenders, [], "shipped source must read as documentation, not as internal notes");
});

test("copy: a partial seed profile is refused with an explanation, not an internal rule", () => {
  const t = new FinanceMockTransport();
  // The obvious first use of the seeding API: bring your own balances, keep
  // everything else. The seeded pending transfer still reserves against the
  // wallets this replaces, so the profile cannot balance.
  assert.throws(
    () => t.simulations.seed({ name: "mine", description: "balances only", seeds: { wallets: {} } }),
    (e) => {
      assert.match(e.message, /supply the transfers and payouts alongside the balances/,
        "the message must tell the caller what THEY should change");
      assert.doesNotMatch(e.message, /\bI5\b/, "not a rule label from a document they do not have");
      return e instanceof MockLedgerError;
    },
  );
});

// ── Refusal paths that write nothing ───────────────────────────────────

test("ledger: a mid-transition row-creation refusal writes no earlier leg", () => {
  const t = new FinanceMockTransport();
  const L = t.$store.ledger;
  const before = L.snapshot();
  // Two legs: a legal debit, then a credit into an asset the tenant does not
  // support. Resolving the asset lazily in the write loop would leave the
  // debit applied - money destroyed by an operation whose error says otherwise.
  assert.throws(
    () =>
      L.applyAtomic([
        { accountId: MAIN, asset: "USDC", deltaTotal: -50_000000n, deltaAvailable: -50_000000n, deltaReserved: 0n, because: "leg 1" },
        { accountId: OPS, asset: "WBTC", deltaTotal: 1n, deltaAvailable: 1n, deltaReserved: 0n, createIfMissing: true, because: "leg 2" },
      ]),
    MockLedgerError,
  );
  assert.deepEqual(L.snapshot(), before, "the first leg must not survive the second leg's refusal");
});

test("ledger: an unbacked seed is refused at construction, not at first use", () => {
  const t = new FinanceMockTransport();
  assert.throws(
    () =>
      t.simulations.seed({
        name: "unbacked",
        description: "a reserve with nothing behind it",
        seeds: {
          wallets: {
            [MAIN]: [
              {
                asset: "USDC",
                contractAddress: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
                amount: { total: 100, available: 40, reserved: 60 },
              },
            ],
          },
          transfers: [],
          payouts: [],
        },
      }),
    (e) => {
      assert.match(e.message, /reserves 60 USDC/, "names the unexplained reserve");
      assert.match(e.message, /0 USDC of pending operations are outstanding/,
        "and what actually backs it, stated directionally so it reads correctly either way");
      return e instanceof MockLedgerError;
    },
    "a reserve with no pending operation behind it must fail loudly at load",
  );
});

// ── Precision the contract's number type cannot render ─────────────────

test("ledger: 18-decimal assets are tracked exactly even though the view is lossy", () => {
  const t = new FinanceMockTransport();
  const L = t.$store.ledger;
  const wei = (n) => ({ accountId: OPS, asset: "DAI", deltaTotal: n, deltaAvailable: n, deltaReserved: 0n, createIfMissing: true, because: "dai" });
  L.applyAtomic([wei(L.toMinor("DAI", 1000))]);
  for (let i = 0; i < 10; i += 1) L.applyAtomic([wei(1n)]);

  const rendered = L.snapshot().rows.find((r) => r.accountId === OPS && r.asset === "DAI").total;
  assert.equal(rendered, 1000, "WalletBalanceDto carries a double, which cannot show 1000 + 10 wei");

  // The authority is exact: draining precisely what went in reaches zero. If
  // the ledger re-derived its state from the rendered decimal, the 10 wei
  // would have been destroyed and this would go negative.
  L.applyAtomic([wei(-(L.toMinor("DAI", 1000) + 10n))]);
  assert.equal(
    L.snapshot().rows.find((r) => r.accountId === OPS && r.asset === "DAI").total, 0,
    "every wei that went in came back out",
  );
});

test("ledger: dust credited to an account is actually credited to it", async () => {
  const f = mock();
  const sim = f.mock.simulations;
  const TREASURY = "a10c2d31-2222-4b20-8c63-000000000003"; // holds EURC, VBA ...0002 targets EURC
  const row = () => sim.ledger.snapshot().rows.find((r) => r.accountId === TREASURY && r.asset === "EURC");
  const start = row().total;
  for (let i = 0; i < 20; i += 1) sim.inbound.credit("vb7e5f19-4444-4d40-ae85-000000000002", 0.000001);
  assert.equal(row().total, start + 0.00002, "twenty 1e-6 credits sum exactly, with no float drift");
  sim.ledger.verify();
});

// ── Walks the spec names ───────────────────────────────────────────────

test("ledger: REQUESTED -> RETURNED releases a hold that never left", async () => {
  const f = mock();
  const sim = f.mock.simulations;
  const before = (await usdc(f, PAYOUTS));
  const p = await f.payouts.request(PAYOUTS, {
    payoutRouteId: ACTIVE_ROUTE, cryptoAmount: 90, idempotencyKey: key(60),
  });
  assert.equal((await usdc(f, PAYOUTS)).reserved, before.reserved + 90);
  sim.payout.advance(p.id, "RETURNED");
  assert.deepEqual(await usdc(f, PAYOUTS), before, "returned before sending is just the hold coming back");
  sim.ledger.verify();
});

test("ledger: a hydrated seed hold can be driven, which is why it must be backed", async () => {
  const f = mock();
  const sim = f.mock.simulations;
  const ESCROW_SEND = "tr5e8c66-7777-4a70-9bb8-000000000006";
  const row = () => sim.ledger.snapshot().rows.find((r) => r.accountId === ESCROW && r.asset === "USDC");
  assert.deepEqual(
    { total: row().total, available: row().available, reserved: row().reserved },
    { total: 4200, available: 0, reserved: 4200 },
  );

  // Fail it: the seeded hold releases back to available. This is the case the
  // reserve-backing rule exists to make safe - without a real hold behind the
  // 4200, this would drive reserved negative.
  sim.transfer.advance(ESCROW_SEND, "FAILED");
  assert.deepEqual(
    { total: row().total, available: row().available, reserved: row().reserved },
    { total: 4200, available: 4200, reserved: 0 },
  );
  sim.ledger.verify();
});

test("ledger: a receiver with no row for the asset gets one on credit", async () => {
  const f = mock();
  const sim = f.mock.simulations;
  const has = (acct, asset) => sim.ledger.snapshot().rows.some((r) => r.accountId === acct && r.asset === asset);
  assert.equal(has(OPS, "EURC"), false, "precondition: acct-ops-usd holds no EURC");

  const t = await f.transfers.createFiat(MAIN, {
    receiverExternalId: "acct-ops-usd", amount: 60, currency: "EUR", idempotencyKey: key(61),
  });
  sim.transfer.advance(t.id, "COMPLETED");
  assert.equal(has(OPS, "EURC"), true, "the row is opened by the credit that needs it");
  assert.equal(
    sim.ledger.snapshot().rows.find((r) => r.accountId === OPS && r.asset === "EURC").available, 60,
  );
  sim.ledger.verify();
});

// ── demoCast joins ─────────────────────────────────────────────────────

test("demoCast: each persona's account is held by its OWN party", async () => {
  const t = new FinanceMockTransport();
  t.simulations.seed(seedProfiles.demoCast);
  for (const account of t.$store.accounts) {
    const role = t.$store.rolesByAccount.get(account.id)?.[0];
    const holder = t.$store.parties.find((p) => p.id === role?.partyId);
    assert.ok(holder, `${account.externalId} has a holder`);
    // The join a console reads. One shared holder would make the denied
    // applicant's account read as held by a verified organisation.
    if (account.externalId === "cast-denied") assert.equal(holder.kybStatus, "DENIED");
    if (account.externalId === "cast-iv-submitted") assert.equal(holder.kybStatus, "PENDING");
    if (account.externalId === "cast-transacting") assert.equal(holder.name, "Nova Retail");
  }
  const denied = t.$store.accounts.find((a) => a.externalId === "cast-denied");
  const assets = await t.request("GET", `/accounts/${denied.id}/supported-assets`);
  assert.ok((assets.result ?? assets.items ?? []).length > 0, "cast accounts resolve their supported assets");
});

// ── Exactness that survives the boundaries ─────────────────────────────

test("ledger: an over-precise amount is refused whichever notation JS picks", () => {
  const t = new FinanceMockTransport();
  const L = t.$store.ledger;
  // Plain notation was already refused. Exponential notation is what String()
  // produces below 1e-6, and toFixed() would ROUND it - silently discarding
  // 1e-7 USDC, and silently CREATING a wei from 1.5e-18 DAI.
  for (const [asset, amount] of [
    ["USDC", 1.0000001],
    ["USDC", 1e-7],
    ["USDC", 1.5e-7],
    ["DAI", 1.5e-19],
  ]) {
    assert.throws(
      () => L.toMinor(asset, amount),
      MockLedgerError,
      `${amount} exceeds ${asset}'s precision and must be refused, not rounded to fit`,
    );
  }
  // Exactly at the asset's precision still works, in either notation.
  assert.equal(L.toMinor("USDC", 0.000001), 1n);
  assert.equal(L.toMinor("DAI", 1e-18), 1n);
});

test("ledger: exactness survives replication, not just a single context", async () => {
  const session = `exact-${process.pid}`;
  const A = new FinanceMockTransport({ channel: "broadcast", sessionId: session });
  const B = new FinanceMockTransport({ channel: "broadcast", sessionId: session });
  const wei = (n) => ({
    accountId: OPS, asset: "DAI", deltaTotal: n, deltaAvailable: n, deltaReserved: 0n,
    createIfMissing: true, because: "dai",
  });

  A.$store.ledger.applyAtomic([wei(A.$store.ledger.toMinor("DAI", 1000) + 10n)]);
  A.$afterDriver(undefined);

  const exactOf = (t) =>
    t.simulations.ledger.snapshot().rows.find((r) => r.accountId === OPS && r.asset === "DAI")?.exact.total;
  await waitFor(() => exactOf(B) !== undefined, "B to adopt A's snapshot");
  assert.equal(exactOf(A), "1000.00000000000000001", "A tracks the wei");
  assert.equal(
    exactOf(B), exactOf(A),
    "and so does B - a snapshot carries the authority, not the rendered double",
  );

  // The proof that matters: B can spend exactly what A funded, to the wei.
  B.$store.ledger.applyAtomic([wei(-(B.$store.ledger.toMinor("DAI", 1000) + 10n))]);
  assert.equal(
    B.simulations.ledger.snapshot().rows.find((r) => r.accountId === OPS && r.asset === "DAI").exact.total,
    "0",
  );
  A.$channel.close();
  B.$channel.close();
});

test("ledger: the refusal names the shortfall when both amounts render alike", () => {
  const t = new FinanceMockTransport();
  const L = t.$store.ledger;
  const one = L.toMinor("DAI", 1000) - 1n;
  L.applyAtomic([{ accountId: OPS, asset: "DAI", deltaTotal: one, deltaAvailable: one, deltaReserved: 0n, createIfMissing: true, because: "fund" }]);
  assert.throws(
    () =>
      L.applyAtomic([{
        accountId: OPS, asset: "DAI",
        deltaTotal: -L.toMinor("DAI", 1000), deltaAvailable: -L.toMinor("DAI", 1000),
        deltaReserved: 0n, because: "send max",
      }]),
    (e) => {
      // "has 1000 and needs 1000" reads as a broken mock. Both render as 1000
      // because a double cannot show 18 decimals, so the message has to say so.
      assert.match(e.message, /999\.999999999999999999/, "the exact balance");
      assert.match(e.message, /shortfall of 0\.000000000000000001/, "the gap, stated next to the amounts");
      assert.match(e.message, /Both amounts render as 1000/, "and why the numbers look equal");
      return e instanceof MockLedgerError;
    },
  );
});

test("ledger: the conservation total is accumulated exactly", () => {
  const t = new FinanceMockTransport();
  const L = t.$store.ledger;
  const wei = (acct, n) => ({ accountId: acct, asset: "DAI", deltaTotal: n, deltaAvailable: n, deltaReserved: 0n, createIfMissing: true, because: "dai" });
  L.applyAtomic([wei(MAIN, L.toMinor("DAI", 1000) + 1n)]);
  L.applyAtomic([wei(OPS, L.toMinor("DAI", 1000) + 1n)]);
  assert.equal(
    L.snapshot().exactTotalsByAsset.DAI, "2000.000000000000000002",
    "summing through a double would lose both wei, and I4 is asserted on this number",
  );
});

// ── Sign, and the status a failure actually deserves ───────────────────

test("ledger: a negative amount is refused, not run backwards", async () => {
  const f = mock();
  const before = await usdc(f, MAIN);
  // Conservation is blind to sign, so a negative transfer balanced perfectly
  // while running the phase machine in reverse: the SENDER gained and the
  // counterparty lost. Any account could pull funds from any other.
  await assert.rejects(
    f.transfers.createFiat(MAIN, {
      receiverExternalId: "acct-ops-usd", currency: "USD", amount: -5, idempotencyKey: key(70),
    }),
    (e) => {
      assert.match(e.errors[0].message, /must be greater than zero/);
      assert.match(e.errors[0].message, /would move money backwards/, "says why it matters");
      return e.status === 400;
    },
  );
  assert.deepEqual(await usdc(f, MAIN), before, "and nothing moved");
});

test("ledger: zero is refused too", async () => {
  const f = mock();
  await assert.rejects(
    f.transfers.createFiat(MAIN, {
      receiverExternalId: "acct-ops-usd", currency: "USD", amount: 0, idempotencyKey: key(71),
    }),
    (e) => e.status === 400,
  );
});

test("ledger: each failure carries the status AND the code its cause deserves", async () => {
  const f = mock();
  // A client branches on these. 402 drives a top-up screen; the 400s drive
  // three different corrections, so they cannot share one code or the handler
  // has to regex the message - which is what a stable code exists to prevent.
  await assert.rejects(
    f.transfers.createFiat(MAIN, {
      receiverExternalId: "acct-ops-usd", currency: "USD", amount: 1.0000001, idempotencyKey: key(72),
    }),
    (e) => e.status === 400 && e.errors[0].code === "invalid-amount",
    "too much precision: reformat the amount, not top up the wallet",
  );
  await assert.rejects(
    f.transfers.createFiat(MAIN, {
      receiverExternalId: "acct-ops-usd", currency: "USD", amount: -5, idempotencyKey: key(74),
    }),
    (e) => e.status === 400 && e.errors[0].code === "invalid-amount",
    "bad sign: a form-field problem",
  );
  await assert.rejects(
    f.transfers.createFiat(MAIN, {
      receiverExternalId: "acct-ops-usd", currency: "USD", amount: 999999999, idempotencyKey: key(73),
    }),
    (e) => e.status === 402 && e.errors[0].code === "insufficient-funds",
    "an actual shortfall is the only funding problem",
  );
});

test("copy: a pre-creation refusal does not quote an id that was never minted", async () => {
  const f = mock();
  const before = (await f.transfers.list(MAIN)).items.length;
  await assert.rejects(
    f.transfers.createFiat(MAIN, {
      receiverExternalId: "acct-ops-usd", currency: "USD", amount: -5, idempotencyKey: key(75),
    }),
    (e) => {
      // An id in an error is an invitation to look it up. Quoting one for a
      // resource that was never created sends the reader to a 404.
      assert.doesNotMatch(
        e.errors[0].message, /transfer [0-9a-f]{8}-/,
        "no dangling resource id in a validation refusal",
      );
      return e.status === 400;
    },
  );
  assert.equal((await f.transfers.list(MAIN)).items.length, before, "and nothing was created");
});

test("ledger: verify() explains itself when the two amounts render alike", () => {
  const t = new FinanceMockTransport();
  const L = t.$store.ledger;
  // reserved and held come from different precision provenance, so on an
  // 18-decimal asset they can differ below what a double can show.
  L.applyAtomic([{
    accountId: OPS, asset: "DAI",
    deltaTotal: L.toMinor("DAI", 1000), deltaAvailable: 0n, deltaReserved: L.toMinor("DAI", 1000),
    createIfMissing: true, because: "reserve",
  }]);
  L.hydrateHold("h1", OPS, "DAI", 1000, "HELD");
  L.applyAtomic([{ accountId: OPS, asset: "DAI", deltaTotal: 1n, deltaAvailable: 0n, deltaReserved: 1n, because: "one wei more reserved" }]);
  assert.throws(
    () => L.verify(),
    (e) => {
      assert.match(e.message, /both render as 1000/, "must not read as '1000 must match 1000'");
      return e instanceof MockLedgerError;
    },
  );
});

test("ledger: open holds carry an exact amount, so reserves can be reconciled", () => {
  const t = new FinanceMockTransport();
  const holds = t.simulations.ledger.snapshot().holds;
  assert.ok(holds.length > 0);
  for (const h of holds) {
    assert.equal(typeof h.exactAmount, "string", "every hold is reconcilable against `reserved`");
  }
});

test("ledger: a refused seed profile leaves the store exactly as it was", async () => {
  const t = new FinanceMockTransport();
  const before = t.simulations.ledger.snapshot();

  assert.throws(
    () =>
      t.simulations.seed({
        name: "bad",
        description: "a hold with a negative amount",
        seeds: {
          wallets: {
            [MAIN]: [
              {
                asset: "USDC",
                contractAddress: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
                amount: { total: 100, available: 100, reserved: 0 },
              },
            ],
          },
          transfers: [
            { id: "bad-1", senderAccountId: MAIN, receiverAccountId: OPS, chain: "BASE",
              asset: "USDC", amount: -50, status: "PENDING", createdAt: "2026-01-01T00:00:00Z" },
          ],
          payouts: [],
        },
      }),
    MockLedgerError,
  );

  // The check exists to stop a bad fixture. Assert it did not INSTALL one -
  // asserting only that it threw is the same shape of hole as a guard test
  // that certifies a property it never checks.
  assert.deepEqual(t.simulations.ledger.snapshot(), before, "no partial state survived");
  t.simulations.ledger.verify();

  // And the store still works: reset, and money still moves.
  t.simulations.reset();
  t.simulations.ledger.verify();
  const f = new VenlyFinanceClient({ environment: "mock" });
  void f;
  const wallets = await t.request("GET", `/accounts/${MAIN}/wallets`);
  const usdcRow = (wallets.result ?? wallets.items).find((w) => w.asset === "USDC");
  assert.equal(usdcRow.amount.total, 15521, "the public read path serves the real fixture");
});

test("ledger: a refused seed profile does not survive a later reset", () => {
  const t = new FinanceMockTransport();
  assert.throws(
    () =>
      t.simulations.seed({
        name: "unbacked", description: "reserve with nothing behind it",
        seeds: {
          wallets: { [MAIN]: [{ asset: "USDC", contractAddress: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", amount: { total: 10, available: 4, reserved: 6 } }] },
          transfers: [], payouts: [],
        },
      }),
    MockLedgerError,
  );
  // reset() used to throw forever, because the poisoned seeds were never
  // restored and every reset re-validated them.
  t.simulations.reset();
  t.simulations.reset();
  t.simulations.ledger.verify();
});

test("errors: every code the ledger throws can also be injected with failNext", async () => {
  const f = mock();
  // A single vocabulary is the point: a UI wired to failNext and a UI wired to
  // the real rejection must not need two handlers for one failure. A code the
  // ledger can produce but failNext cannot inject breaks that.
  for (const [preset, expected] of [
    ["INVALID_AMOUNT", "invalid-amount"],
    ["UNSUPPORTED_ASSET", "unsupported-asset"],
    ["INSUFFICIENT_FUNDS", "insufficient-funds"],
  ]) {
    f.mock.failNext(preset);
    await assert.rejects(f.accounts.list(), (e) => e.errors[0].code === expected, preset);
  }
});

test("idempotency: a key refused for a bad amount is still usable; a burned key is not", async () => {
  const f = mock();
  const k = key(80);
  // Validation now runs before the intent is recorded, so a 400 does not burn
  // the key - retrying with a corrected body is the normal client move.
  await assert.rejects(
    f.transfers.createFiat(MAIN, { receiverExternalId: "acct-ops-usd", currency: "USD", amount: -5, idempotencyKey: k }),
    (e) => e.status === 400,
  );
  const ok = await f.transfers.createFiat(MAIN, {
    receiverExternalId: "acct-ops-usd", currency: "USD", amount: 5, idempotencyKey: k,
  });
  assert.ok(ok.id, "a request rejected before it existed leaves the key free");

  // A key burned by a genuine shortfall stays burned: that attempt DID reach
  // the ledger, so replaying it is a conflict rather than a retry.
  const k2 = key(81);
  const body = { receiverExternalId: "acct-ops-usd", currency: "USD", amount: 999999999, idempotencyKey: k2 };
  await assert.rejects(f.transfers.createFiat(MAIN, body), (e) => e.status === 402);
  await assert.rejects(f.transfers.createFiat(MAIN, body), (e) => e.status === 409);
});
