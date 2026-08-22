// Two liveness contracts for the payout ceremony's mock plane:
//
// 1. Every ceremony transition EMITS. A consumer that bridges the event
//    stream into cache invalidation (the reference pattern) renders these
//    surfaces; a mutation with no event leaves them stale forever.
// 2. reset() replays the world the last seed() BUILT - including the
//    profile's after() drives - so two invocations that claim the same
//    world produce the same world.
import test from "node:test";
import assert from "node:assert/strict";
import { VenlyFinanceClient, demoCast } from "../dist/esm/index.js";

const mockFinance = () => new VenlyFinanceClient({ environment: "mock" });

const ORG_PARTY = "0b54e9f1-1111-4a10-9b52-000000000002";
const PAYOUTS_ACCT = "a10c2d31-2222-4b20-8c63-000000000005"; // Acme – Payouts

const eventsOf = (client, type) =>
  client.mock.simulations.events.list().filter((e) => e.type === type);

test("payout ceremony: register, route create, proof completion and both drivers all emit", async () => {
  const f = mockFinance();
  const sim = f.mock.simulations;

  // Register a beneficiary account -> created event, PENDING.
  const account = await f.payoutBankAccounts.register(ORG_PARTY, {
    rail: "SEPA",
    fiatCurrency: "EUR",
    label: "Ceremony test account",
    accountHolderName: "Acme Corporation B.V.",
    bankName: "Example Bank N.V.",
    railDetails: { iban: "BE71096123456769" },
  });
  const created = eventsOf(f, "payout_bank_account.created");
  assert.equal(created.length, 1, "registration emits payout_bank_account.created");
  assert.equal(created[0].resource.id, account.id);

  // Operator activates it -> status_changed with the previous status.
  sim.payoutBankAccount.advance(account.id, "ACTIVE");
  const activated = eventsOf(f, "payout_bank_account.status_changed");
  assert.equal(activated.length, 1, "the driver emits payout_bank_account.status_changed");
  assert.equal(activated[0].previous?.status, "PENDING");
  assert.equal(activated[0].data.status, "ACTIVE");

  // Route creation -> created event, account-scoped.
  const route = await f.payoutRoutes.create(PAYOUTS_ACCT, {
    payoutBankAccountId: account.id,
    depositAsset: { chain: "BASE", name: "USDC" },
  });
  const routeCreated = eventsOf(f, "payout_route.created");
  assert.equal(routeCreated.length, 1, "route creation emits payout_route.created");
  assert.equal(routeCreated[0].resource.id, route.id);
  assert.equal(routeCreated[0].accountId, PAYOUTS_ACCT);

  // Ownership-proof completion -> status_changed to ACTIVE with previous.
  const proof = await f.payoutRoutes.prepareOwnershipProof(PAYOUTS_ACCT, route.id);
  await f.payoutRoutes.completeOwnershipProof(PAYOUTS_ACCT, route.id, {
    message: proof.message,
    signature: "0xsigned",
  });
  let routeChanged = eventsOf(f, "payout_route.status_changed");
  assert.equal(routeChanged.length, 1, "proof completion emits payout_route.status_changed");
  assert.equal(routeChanged[0].previous?.status, "AWAITING_OWNERSHIP_PROOF");
  assert.equal(routeChanged[0].data.status, "ACTIVE");

  // The route driver too (e.g. simulating a rejection).
  sim.payoutRoute.advance(route.id, "REJECTED");
  routeChanged = eventsOf(f, "payout_route.status_changed");
  assert.equal(routeChanged.length, 2, "the route driver emits as well");
  assert.equal(routeChanged[1].previous?.status, "ACTIVE");
  assert.equal(routeChanged[1].data.status, "REJECTED");

  // The liveness contract the reference bridge depends on: an in-process
  // subscriber sees a ceremony transition the moment it happens.
  let observed = 0;
  const unsubscribe = sim.events.subscribe((event) => {
    if (event.type === "payout_bank_account.status_changed") observed++;
  });
  sim.payoutBankAccount.advance(account.id, "DISABLED");
  assert.equal(observed, 1, "a subscriber is told about the driver's transition");
  unsubscribe();
});

test("reset() replays the seeded world's after() drives, not just its fixtures", () => {
  const f = mockFinance();
  const sim = f.mock.simulations;
  sim.seed(demoCast);

  const partyStates = async () => {
    const page = await f.parties.list({ size: 100 });
    return Object.fromEntries(
      page.items.map((p) => [p.id, p.partyType === "ORGANISATION" ? p.kybStatus : p.kycStatus]),
    );
  };

  return (async () => {
    const seeded = await partyStates();
    const refused = Object.entries(seeded).filter(([, status]) => status === "DENIED");
    assert.ok(refused.length >= 1, "the cast carries a driven refusal");

    // Mutate the world, then reset: the same world must come back.
    const accounts = await f.accounts.list({ size: 100 });
    sim.verification.advance(accounts.items[0].id, "VERIFIED");
    sim.reset();

    const replayed = await partyStates();
    assert.deepEqual(replayed, seeded, "seed() and seed()+mutate+reset() build the same world");

    // The re-driven decision carries its event in the fresh epoch, exactly
    // as the original seed() run did.
    const refusalEvents = f.mock.simulations.events
      .list()
      .filter((e) => e.type === "party.verification_changed" && e.data?.kybStatus === "DENIED");
    assert.ok(refusalEvents.length >= 1, "the refusal is driven again, with its event");
  })();
});

test("event history is immutable: a later transition must not rewrite a past event's payload", async () => {
  const f = mockFinance();
  const sim = f.mock.simulations;
  const MAIN_ACCT = "a10c2d31-2222-4b20-8c63-000000000001"; // Acme – Main EUR

  sim.account.setStatus(MAIN_ACCT, "SUSPENDED");
  const [suspended] = eventsOf(f, "account.status_changed").filter(
    (e) => e.resource.id === MAIN_ACCT,
  );
  assert.equal(suspended.previous?.status, "ACTIVE");
  assert.equal(suspended.data?.status, "SUSPENDED");

  sim.account.setStatus(MAIN_ACCT, "ACTIVE");
  const events = eventsOf(f, "account.status_changed").filter(
    (e) => e.resource.id === MAIN_ACCT,
  );
  assert.equal(events.length, 2);
  // The FIRST event still narrates ACTIVE -> SUSPENDED. Before the emit
  // snapshot, `data` was a live reference to the account row, so this
  // read reported "ACTIVE -> ACTIVE" after the reactivation.
  assert.equal(events[0].previous?.status, "ACTIVE");
  assert.equal(events[0].data?.status, "SUSPENDED");
  assert.equal(events[1].previous?.status, "SUSPENDED");
  assert.equal(events[1].data?.status, "ACTIVE");
});
