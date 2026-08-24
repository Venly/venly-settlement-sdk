// The agent-prepared decision draft store (mock-only concept):
//
// 1. simulations.decision.prepare stores the draft, validates the record
//    exists, and emits decision.prepared through the STANDARD path (the
//    event payload is a snapshot - later mutations never rewrite history).
// 2. Drafts never auto-apply: preparing changes no record state.
// 3. A human decision on the record marks its drafts SUPERSEDED - through
//    the verification ceremony, the payout exception ceremony, or the
//    explicit supersede driver for app-side decisions (reconciliation).
// 4. reset() returns to a world with no drafts.
// 5. decision.* events never appear in the simulated webhook delivery log:
//    the real platform delivers no such webhook, and the mock must not
//    teach that it does.
import test from "node:test";
import assert from "node:assert/strict";
import { VenlyFinanceClient } from "../dist/esm/index.js";

const mockFinance = () => new VenlyFinanceClient({ environment: "mock" });

const PENDING_ACCT = "a10c2d31-2222-4b20-8c63-000000000004"; // VERIFICATION_PENDING
const VBA_MAIN = "vb7e5f19-4444-4d40-ae85-000000000001";
const PAYOUTS_ACCT = "a10c2d31-2222-4b20-8c63-000000000005";

const eventsOf = (client, type) =>
  client.mock.simulations.events.list().filter((e) => e.type === type);

test("prepare stores the draft, lists it per record, and emits decision.prepared", () => {
  const f = mockFinance();
  const sim = f.mock.simulations;

  const draft = sim.decision.prepare({
    recordType: "verification",
    recordId: PENDING_ACCT,
    proposal: "Approve verification",
    reason: "Screening completed and the register entry matches the applicant.",
    evidenceRefs: ["account.kycStatus", "party.iv.status"],
  });

  assert.ok(draft.id, "the draft has an id");
  assert.equal(draft.status, "PREPARED");
  assert.equal(draft.recordType, "verification");
  assert.equal(draft.recordId, PENDING_ACCT);
  assert.deepEqual(draft.evidenceRefs, ["account.kycStatus", "party.iv.status"]);
  assert.ok(draft.preparedAt, "preparedAt is stamped - the real timestamp the trail renders");

  const listed = sim.decision.list(PENDING_ACCT);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].id, draft.id);
  assert.equal(sim.decision.list("no-such-record").length, 0);

  const events = eventsOf(f, "decision.prepared");
  assert.equal(events.length, 1, "prepare emits decision.prepared through the standard path");
  assert.equal(events[0].resource.kind, "decisionDraft");
  assert.equal(events[0].resource.id, draft.id);
  assert.equal(events[0].accountId, PENDING_ACCT, "an account-record draft carries accountId");
  assert.equal(events[0].data.proposal, "Approve verification");
});

test("the emitted event is a snapshot: superseding later never rewrites the prepared event", () => {
  const f = mockFinance();
  const sim = f.mock.simulations;
  const draft = sim.decision.prepare({
    recordType: "verification",
    recordId: PENDING_ACCT,
    proposal: "Approve verification",
    reason: "Evidence complete.",
  });
  sim.verification.advance(PENDING_ACCT, "VERIFIED");
  const prepared = eventsOf(f, "decision.prepared")[0];
  assert.equal(prepared.data.status, "PREPARED", "history still says PREPARED");
  assert.equal(sim.decision.list(PENDING_ACCT)[0].status, "SUPERSEDED");
  assert.equal(draft.status, "SUPERSEDED", "the live draft object did supersede");
});

test("a draft on a missing record is refused; so are empty proposal/reason", () => {
  const sim = mockFinance().mock.simulations;
  assert.throws(
    () =>
      sim.decision.prepare({
        recordType: "verification",
        recordId: "nope",
        proposal: "x",
        reason: "y",
      }),
    /no party or account with id nope/,
  );
  assert.throws(
    () =>
      sim.decision.prepare({
        recordType: "reconciliation",
        recordId: "nope",
        proposal: "x",
        reason: "y",
      }),
    /no inbound credit/,
  );
  assert.throws(
    () =>
      sim.decision.prepare({
        recordType: "payout_exception",
        recordId: "nope",
        proposal: "x",
        reason: "y",
      }),
    /no payout/,
  );
  assert.throws(
    () =>
      sim.decision.prepare({
        recordType: "verification",
        recordId: PENDING_ACCT,
        proposal: "  ",
        reason: "y",
      }),
    /proposal is required/,
  );
});

test("preparing a draft changes NO record state (drafts never auto-apply)", () => {
  const f = mockFinance();
  const sim = f.mock.simulations;
  const before = sim.ledger.snapshot();
  sim.decision.prepare({
    recordType: "verification",
    recordId: PENDING_ACCT,
    proposal: "Approve verification",
    reason: "Evidence complete.",
  });
  assert.deepEqual(sim.ledger.snapshot(), before, "no money moved");
  return f.accounts.get(PENDING_ACCT).then((account) => {
    assert.equal(account.kycStatus, "VERIFICATION_PENDING", "the record did not advance");
  });
});

test("a human verification decision supersedes the draft; the trail shows the operator", () => {
  const f = mockFinance();
  const sim = f.mock.simulations;
  const draft = sim.decision.prepare({
    recordType: "verification",
    recordId: PENDING_ACCT,
    proposal: "Approve verification",
    reason: "Evidence complete.",
  });
  sim.verification.advance(PENDING_ACCT, "VERIFIED");
  const after = sim.decision.list(PENDING_ACCT)[0];
  assert.equal(after.id, draft.id);
  assert.equal(after.status, "SUPERSEDED");
  assert.ok(after.supersededAt, "the supersede is stamped");
  assert.equal(
    eventsOf(f, "decision.prepared").length,
    1,
    "superseding emits no extra decision event - the verification event carries the decision",
  );
});

test("a payout exception decision (confirm/return) supersedes; provider steps do not", async () => {
  const f = mockFinance();
  const sim = f.mock.simulations;
  const payouts = await f.payouts.list(PAYOUTS_ACCT);
  const payout = payouts.items.find((p) => p.status === "REQUESTED") ?? payouts.items[0];

  const draft = sim.decision.prepare({
    recordType: "payout_exception",
    recordId: payout.id,
    proposal: "Confirm completion",
    reason: "Provider statement shows the fiat leg settled.",
  });

  sim.payout.advance(payout.id, "SENDING");
  assert.equal(
    sim.decision.list(payout.id)[0].status,
    "PREPARED",
    "a provider-side lifecycle step is not a decision",
  );

  sim.payout.advance(payout.id, "COMPLETED", {
    settledFiatAmount: 90,
    reconciliationState: "MATCHED",
  });
  assert.equal(sim.decision.list(payout.id)[0].status, "SUPERSEDED");
  assert.equal(draft.status, "SUPERSEDED");
});

test("reconciliation drafts attach to inbound credits and supersede via the explicit driver", () => {
  const f = mockFinance();
  const sim = f.mock.simulations;
  const credit = sim.inbound.credit(VBA_MAIN, 500, "REF-ABC-123");
  const draft = sim.decision.prepare({
    recordType: "reconciliation",
    recordId: credit.id,
    proposal: "Match to REF-ABC-123",
    reason: "Reference and amount agree with the expected payment.",
    evidenceRefs: ["inboundCredit.referenceCode"],
  });
  assert.equal(draft.status, "PREPARED");
  const event = eventsOf(f, "decision.prepared")[0];
  assert.ok(event.accountId, "the credit's account travels on the event");

  const superseded = sim.decision.supersede("reconciliation", credit.id);
  assert.equal(superseded, 1);
  assert.equal(sim.decision.list(credit.id)[0].status, "SUPERSEDED");
  assert.equal(sim.decision.supersede("reconciliation", credit.id), 0, "idempotent");
});

test("reset() clears drafts - the seeds carry none", () => {
  const f = mockFinance();
  const sim = f.mock.simulations;
  sim.decision.prepare({
    recordType: "verification",
    recordId: PENDING_ACCT,
    proposal: "Approve verification",
    reason: "Evidence complete.",
  });
  assert.equal(sim.decision.list().length, 1);
  f.mock.reset();
  assert.equal(sim.decision.list().length, 0);
});

test("decision.prepared never lands in the simulated webhook delivery log", async () => {
  const f = mockFinance();
  const sim = f.mock.simulations;
  await f.webhooks.create({
    url: "https://example.com/hooks",
    name: "all events",
    authenticationMethod: {
      type: "ApiKeyAuthenticationMethod",
      headerName: "X-Api-Key",
      apiKey: "sk-live-verylongsecret-91d7",
    },
  });
  sim.decision.prepare({
    recordType: "verification",
    recordId: PENDING_ACCT,
    proposal: "Approve verification",
    reason: "Evidence complete.",
  });
  const deliveries = sim.webhookDeliveries.list();
  assert.ok(
    deliveries.every((d) => !d.eventType.startsWith("decision.")),
    "no decision.* delivery is simulated - the platform webhooks no such event",
  );
});

test("drafts replicate across contexts through the standard snapshot channel", async () => {
  // Two transports on one shared channel: the decision driver on one side is
  // visible on the other - the browser world receives the agent's draft the
  // way it receives the bank's inbound credit. (Within ONE process; a
  // separate MCP process shares no channel - the simulator plays the agent
  // seat there.)
  const { FinanceMockTransport } = await import("../dist/esm/index.js");
  const subscribers = [];
  const channel = (originId) => ({
    adapter: "custom",
    originId,
    peers: () => 1,
    post: (message) => {
      for (const s of subscribers) if (s.originId !== originId) s.handler(message);
    },
    subscribe(handler) {
      subscribers.push({ originId, handler });
      return () => {};
    },
    close() {},
  });
  const a = new FinanceMockTransport({ sessionId: "shared", channel: channel("a") });
  const b = new FinanceMockTransport({ sessionId: "shared", channel: channel("b") });

  a.simulations.decision.prepare({
    recordType: "verification",
    recordId: PENDING_ACCT,
    proposal: "Approve verification",
    reason: "Evidence complete.",
  });
  const replicated = b.simulations.decision.list(PENDING_ACCT);
  assert.equal(replicated.length, 1, "the peer adopted the draft through the snapshot");
  assert.equal(replicated[0].status, "PREPARED");
});
