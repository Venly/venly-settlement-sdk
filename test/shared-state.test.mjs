import test from "node:test";
import assert from "node:assert/strict";
import { VenlyFinanceClient } from "../dist/esm/index.js";
import {
  FinanceMockTransport,
  configureFinanceMockDefaults,
  resetFinanceMockDefaults,
} from "../dist/esm/mock/index.js";

const MAIN = "a10c2d31-2222-4b20-8c63-000000000001";
// An ORGANISATION seeded kybStatus PENDING: the approval a console actually
// makes. Party ...0001 is an INDIVIDUAL and already VERIFIED, so approving it
// would assert on a field that never moves.
const PARTY = "0b54e9f1-1111-4a10-9b52-000000000004";
const key = (n) => `${String(n).padStart(8, "0")}-2222-4222-8222-222222222222`;

/** Let the BroadcastChannel round-trip land: delivery is async by design. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

const usdc = (t, acct) =>
  t.simulations.ledger.snapshot().rows.find((r) => r.accountId === acct && r.asset === "USDC");

test("shared state: a mutation in one context is visible in another", async (t) => {
  const session = `test-${t.name.length}-${process.pid}-a`;
  const A = new FinanceMockTransport({ channel: "broadcast", sessionId: session });
  const B = new FinanceMockTransport({ channel: "broadcast", sessionId: session });
  await settle();

  const seen = [];
  B.simulations.events.subscribe((e) => seen.push(e));

  const beforeB = usdc(B, MAIN).available;
  await A.request("POST", `/accounts/${MAIN}/transfers/fiat`, {
    body: { receiverExternalId: "acct-ops-usd", amount: 400, currency: "USD", idempotencyKey: key(1) },
    idempotencyKey: key(1),
  });
  await settle();

  assert.equal(
    usdc(B, MAIN).available, beforeB - 400,
    "B observes A's hold through its own read path, not a shared object reference",
  );
  assert.ok(
    seen.some((e) => e.type === "transfer.created"),
    "B's subscriber received the event A minted",
  );
  assert.ok(
    seen.some((e) => e.type === "store.resync"),
    "B is told its view was replaced wholesale, rather than diverging silently",
  );
  const ids = seen.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length, "event ids are unique, so dedupe cannot drop a distinct event");
  assert.ok(ids.every((id) => id.split(":").length === 3), "ids carry originId:epoch:sequence");

  A.$channel.close();
  B.$channel.close();
});

test("shared state: B rejects a spend using A's balance, not a stale local one", async (t) => {
  const session = `test-${t.name.length}-${process.pid}-b`;
  const A = new FinanceMockTransport({ channel: "broadcast", sessionId: session });
  const B = new FinanceMockTransport({ channel: "broadcast", sessionId: session });
  await settle();

  // A commits almost everything acct-main-eur can spend.
  const available = usdc(A, MAIN).available;
  await A.request("POST", `/accounts/${MAIN}/transfers/fiat`, {
    body: { receiverExternalId: "acct-ops-usd", amount: available - 10, currency: "USD", idempotencyKey: key(2) },
    idempotencyKey: key(2),
  });
  await settle();

  // B, which started with the full balance, must now refuse a spend of 500.
  await assert.rejects(
    B.request("POST", `/accounts/${MAIN}/transfers/fiat`, {
      body: { receiverExternalId: "acct-ops-usd", amount: 500, currency: "USD", idempotencyKey: key(3) },
      idempotencyKey: key(3),
    }),
    (e) => e.status === 402,
    "the second surface must not be able to spend money the first already committed",
  );

  A.$channel.close();
  B.$channel.close();
});

test("shared state: a driver in the console context reaches the consumer context", async (t) => {
  const session = `test-${t.name.length}-${process.pid}-c`;
  const console_ = new FinanceMockTransport({ channel: "broadcast", sessionId: session });
  const consumer = new FinanceMockTransport({ channel: "broadcast", sessionId: session });
  await settle();

  const before = consumer.$store.parties.find((p) => p.id === PARTY)?.kybStatus;
  console_.simulations.verification.advance(PARTY, "VERIFIED");
  await settle();

  assert.notEqual(before, "VERIFIED", "precondition: not already verified");
  assert.equal(
    consumer.$store.parties.find((p) => p.id === PARTY)?.kybStatus, "VERIFIED",
    "approve in the console, and the consumer surface learns about it",
  );

  console_.$channel.close();
  consumer.$channel.close();
});

test("shared state: a late joiner adopts the world and is told to resync", async (t) => {
  const session = `test-${t.name.length}-${process.pid}-d`;
  const A = new FinanceMockTransport({ channel: "broadcast", sessionId: session });
  await settle();
  await A.request("POST", `/accounts/${MAIN}/transfers/fiat`, {
    body: { receiverExternalId: "acct-ops-usd", amount: 250, currency: "USD", idempotencyKey: key(4) },
    idempotencyKey: key(4),
  });

  // Joins after the fact: it gets state, never the history it missed.
  const late = new FinanceMockTransport({ channel: "broadcast", sessionId: session });
  const seen = [];
  late.simulations.events.subscribe((e) => seen.push(e));
  await settle();

  assert.equal(usdc(late, MAIN).available, usdc(A, MAIN).available, "the late joiner sees current truth");
  assert.ok(seen.some((e) => e.type === "store.resync"), "and is told it is a resync, not continuity");
  assert.ok(
    !seen.some((e) => e.type === "transfer.created"),
    "cross-context delivery is best-effort: history is state-convergent, not replayed",
  );

  A.$channel.close();
  late.$channel.close();
});

test("defaults: an ordinarily-constructed client joins the configured session", async (t) => {
  const session = `test-${t.name.length}-${process.pid}-e`;
  try {
    configureFinanceMockDefaults({ channel: "broadcast", sessionId: session });
    // The path a browser app actually takes: it cannot pass options to the
    // client constructor, so the module-level defaults are the only route.
    const app = new VenlyFinanceClient({ environment: "mock" });
    const info = app.mock.simulations.channelInfo();
    assert.equal(info.adapter, "broadcast", "the defaults took effect");
    assert.equal(info.sessionId, session);

    const other = new FinanceMockTransport({ channel: "broadcast", sessionId: session });
    await settle();
    await other.request("POST", `/accounts/${MAIN}/transfers/fiat`, {
      body: { receiverExternalId: "acct-ops-usd", amount: 125, currency: "USD", idempotencyKey: key(5) },
      idempotencyKey: key(5),
    });
    await settle();

    const wallets = await app.wallets.list(MAIN);
    const row = wallets.items.find((w) => w.asset === "USDC");
    assert.equal(row.amount.reserved, 420.5 + 125, "the default-configured client shares the world");
    other.$channel.close();
    app.mock.$channel.close();
  } finally {
    resetFinanceMockDefaults();
  }
});

test("defaults: memory is the default, so nothing shares by accident", () => {
  const a = new FinanceMockTransport();
  const b = new FinanceMockTransport();
  assert.equal(a.simulations.channelInfo().adapter, "memory");
  a.simulations.verification.advance(PARTY, "VERIFIED");
  assert.notEqual(
    b.$store.parties.find((p) => p.id === PARTY)?.kybStatus, "VERIFIED",
    "two default transports are two worlds, as they always were",
  );
});
