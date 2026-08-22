// Payout surface (contract 1.3.0): beneficiary bank accounts on the party,
// routes on the account, ownership proof, then payouts against the route.
import test from "node:test";
import assert from "node:assert/strict";
import { VenlyFinanceClient, VenlyApiError } from "../dist/esm/index.js";

const mockFinance = () => new VenlyFinanceClient({ environment: "mock" });

const ORG_PARTY = "0b54e9f1-1111-4a10-9b52-000000000002";
const PAYOUTS_ACCT = "a10c2d31-2222-4b20-8c63-000000000005"; // Acme – Payouts
const PENDING_ACCT = "a10c2d31-2222-4b20-8c63-000000000004"; // Borealis – Frozen
const ACTIVE_ROUTE = "pr9e3b21-cccc-4f20-8da3-000000000001";
const PROOF_ROUTE = "pr9e3b21-cccc-4f20-8da3-000000000002";
const KEY = "3fa85f64-5717-4562-b3fc-2c963f66afa6";

test("payouts: seeds cover the happy end, in-flight, and money that came back", async () => {
  const f = mockFinance();
  const page = await f.payouts.list(PAYOUTS_ACCT);
  assert.equal(page.items.length, 3);
  assert.equal(page.resultPresent, true);

  const done = page.items.find((p) => p.status === "COMPLETED");
  assert.ok(done.completedAt, "COMPLETED carries completedAt");
  assert.equal(done.settledFiatAmount, 1380, "COMPLETED carries the settled fiat amount - never numerically equal to the crypto side");
  // List rows carry the route SUMMARY only; beneficiary lives on the detail.
  assert.equal(done.payoutRoute?.beneficiary, undefined, "no beneficiary on list rows");
  assert.equal(done.payoutRoute?.depositAddress, undefined, "no deposit address on list rows");
  assert.equal(done.payoutRoute?.status, "ACTIVE", "summary carries the route status");
  const detail = await f.payouts.get(PAYOUTS_ACCT, done.id);
  assert.ok(detail.payoutRoute?.beneficiary?.details?.ibanLast4, "detail carries the masked beneficiary");

  const inFlight = page.items.find((p) => p.status === "PROVIDER_PROCESSING");
  assert.ok(inFlight.sendTxHash, "in-flight payout shows the send transaction");
  assert.equal(inFlight.completedAt, undefined, "in-flight has no completion timestamp");

  const returned = page.items.find((p) => p.status === "RETURNED");
  assert.ok(returned.failureReason, "RETURNED explains itself");
});

test("payouts: the full ceremony from bank account to COMPLETED", async () => {
  const f = mockFinance();

  // 1. Register a beneficiary bank account on the party: starts PENDING and
  //    the response masks the rail details it was given.
  const bankAccount = await f.payoutBankAccounts.register(ORG_PARTY, {
    rail: "SEPA",
    fiatCurrency: "EUR",
    label: "New supplier",
    accountHolderName: "Supplier GmbH",
    railDetails: { iban: "DE89370400440532013999", bic: "DEUTDEDBFRA" },
    bankName: "Supplier Bank AG",
  });
  assert.equal(bankAccount.status, "PENDING", "a fresh beneficiary account is not yet usable");
  assert.equal(bankAccount.details.ibanLast4, "3999", "details are masked, never echoed whole");
  assert.equal(bankAccount.details.iban, undefined);

  // 2. A route cannot use a PENDING bank account.
  await assert.rejects(
    f.payoutRoutes.create(PAYOUTS_ACCT, {
      payoutBankAccountId: bankAccount.id,
      depositAsset: { chain: "BASE", name: "USDC" },
    }),
    (err) => err instanceof VenlyApiError && err.status === 400,
  );

  // 3. Operator activates it (driver = the seam), route becomes creatable.
  f.mock.advancePayoutBankAccount(bankAccount.id);
  const route = await f.payoutRoutes.create(PAYOUTS_ACCT, {
    payoutBankAccountId: bankAccount.id,
    depositAsset: { chain: "BASE", name: "USDC" },
  });
  assert.equal(route.status, "AWAITING_OWNERSHIP_PROOF");
  assert.ok(route.depositAddress, "the route carries its deposit address");

  // 4. Payouts against a not-yet-ACTIVE route are refused.
  await assert.rejects(
    f.payouts.request(PAYOUTS_ACCT, {
      payoutRouteId: route.id,
      cryptoAmount: 100,
      idempotencyKey: KEY,
    }),
    (err) => err instanceof VenlyApiError && err.status === 400,
  );

  // 5. Ownership proof: prepare returns the message to sign, complete activates.
  // Prepare takes no body: the server derives wallet + chain from the route.
  const prep = await f.payoutRoutes.prepareOwnershipProof(PAYOUTS_ACCT, route.id);
  assert.ok(prep.message.includes(route.id), "the message binds to this route");
  assert.equal(prep.blockchain, "BASE", "chain comes from the route's deposit asset");
  const again = await f.payoutRoutes.prepareOwnershipProof(PAYOUTS_ACCT, route.id);
  assert.equal(again.message, prep.message, "repeated prepare is stable");
  const active = await f.payoutRoutes.completeOwnershipProof(PAYOUTS_ACCT, route.id, {
    message: prep.message,
    signature: "0xsigned",
  });
  assert.equal(active.status, "ACTIVE");

  // 6. Request the payout; the client resolves the idempotent wrapper to the payout.
  const payout = await f.payouts.request(PAYOUTS_ACCT, {
    payoutRouteId: route.id,
    cryptoAmount: 250.5,
    idempotencyKey: "7c9e6679-7425-40de-944b-e07fc1f90ae1",
  });
  assert.equal(payout.status, "REQUESTED");
  assert.equal(payout.cryptoAmount, 250.5);
  assert.equal(payout.fundingMode, "PULL");
  assert.equal(payout.payoutRoute.id, route.id);

  // 7. Read-back and lifecycle to COMPLETED.
  const fetched = await f.payouts.get(PAYOUTS_ACCT, payout.id);
  assert.equal(fetched.id, payout.id);
  f.mock.advancePayout(payout.id, "SENDING");
  f.mock.advancePayout(payout.id, "PROVIDER_PROCESSING");
  const completed = f.mock.advancePayout(payout.id, "COMPLETED");
  assert.ok(completed.completedAt);
  // 250.5 USDC × 0.92 EUR (the seeded rate) - a par default would make the
  // crypto and fiat sides numerically identical, the exact falsehood the
  // rate table exists to prevent.
  assert.equal(completed.settledFiatAmount, 230.46, "settles at the seeded rate, never at par");
  assert.ok(completed.sendTxHash);
});

test("payouts: idempotency replays the same payout, conflicts on drift", async () => {
  const f = mockFinance();
  const body = { payoutRouteId: ACTIVE_ROUTE, cryptoAmount: 75, idempotencyKey: KEY };
  const first = await f.payouts.request(PAYOUTS_ACCT, body);
  const replay = await f.payouts.request(PAYOUTS_ACCT, body);
  assert.equal(replay.id, first.id, "same key + same body returns the same payout");
  assert.equal((await f.payouts.list(PAYOUTS_ACCT)).items.length, 4, "3 seeds + 1 create");

  await assert.rejects(
    f.payouts.request(PAYOUTS_ACCT, { ...body, cryptoAmount: 76 }),
    (err) => err instanceof VenlyApiError && err.status === 409,
    "same key + different body is a conflict",
  );
});

test("payouts: an unverified account cannot pay out", async () => {
  const f = mockFinance();
  await assert.rejects(
    f.payouts.request(PENDING_ACCT, {
      payoutRouteId: ACTIVE_ROUTE,
      cryptoAmount: 10,
      idempotencyKey: KEY,
    }),
    (err) => err instanceof VenlyApiError && err.status === 400,
  );
});

test("payouts: failure states carry a reason", async () => {
  const f = mockFinance();
  const payout = await f.payouts.request(PAYOUTS_ACCT, {
    payoutRouteId: ACTIVE_ROUTE,
    cryptoAmount: 33,
    idempotencyKey: "7c9e6679-7425-40de-944b-e07fc1f90ae2",
  });
  const failed = f.mock.advancePayout(payout.id, "FAILED", {
    failureReason: "Provider rejected the beneficiary name",
  });
  assert.equal(failed.failureReason, "Provider rejected the beneficiary name");

  const returned = f.mock.advancePayout(payout.id, "RETURNED");
  assert.ok(returned.failureReason, "RETURNED always explains itself");
});

test("payout bank accounts: list, get, and reset restore the seeds", async () => {
  const f = mockFinance();
  const page = await f.payoutBankAccounts.list(ORG_PARTY);
  assert.equal(page.items.length, 2, "one ACTIVE, one PENDING seed");
  assert.ok(page.items.some((a) => a.status === "ACTIVE"));
  assert.ok(page.items.some((a) => a.status === "PENDING"));

  const one = await f.payoutBankAccounts.get(ORG_PARTY, page.items[0].id);
  assert.equal(one.id, page.items[0].id);

  await f.payoutBankAccounts.register(ORG_PARTY, {
    rail: "SEPA",
    fiatCurrency: "EUR",
    label: "Temp",
    accountHolderName: "Temp",
  });
  assert.equal((await f.payoutBankAccounts.list(ORG_PARTY)).items.length, 3);
  f.mock.reset();
  assert.equal((await f.payoutBankAccounts.list(ORG_PARTY)).items.length, 2);
});

test("payout routes: list is scoped to the account", async () => {
  const f = mockFinance();
  const routes = await f.payoutRoutes.list(PAYOUTS_ACCT);
  assert.equal(routes.length, 2);
  assert.ok(routes.some((r) => r.id === ACTIVE_ROUTE && r.status === "ACTIVE"));
  assert.ok(routes.some((r) => r.id === PROOF_ROUTE && r.status === "AWAITING_OWNERSHIP_PROOF"));

  const other = await f.payoutRoutes.list("a10c2d31-2222-4b20-8c63-000000000001");
  assert.deepEqual(other, [], "accounts without routes answer empty, not error");
});

// ── Management twin (mock-only reconciliation + ceremony fields) ────────

test("payout twin: the ceremony fields persist on the mock row and replicate through advance", async () => {
  const f = mockFinance();
  const sim = f.mock.simulations;
  const page = await f.payouts.list(PAYOUTS_ACCT);
  const inFlight = page.items.find((p) => p.status === "PROVIDER_PROCESSING");

  // Confirm-completion ceremony: the management op's fields, stored as asserted.
  const completed = sim.payout.advance(inFlight.id, "COMPLETED", {
    settledFiatAmount: 2643.18,
    note: "Settled against Iron statement line 4471",
    fiatReference: "FR-2026-0815-2650",
    dakotaOfframpTxId: "dk-off-77disc",
    reconciliationState: "MATCHED",
  });
  assert.equal(completed.note, "Settled against Iron statement line 4471");
  assert.equal(completed.fiatReference, "FR-2026-0815-2650");
  assert.equal(completed.dakotaOfframpTxId, "dk-off-77disc");
  assert.equal(completed.reconciliationState, "MATCHED");

  // The mock-only read serves the twin; rows without asserted values stay bare.
  const rows = sim.payout.list(PAYOUTS_ACCT);
  const twinRow = rows.find((p) => p.id === inFlight.id);
  assert.equal(twinRow.reconciliationState, "MATCHED");
  const requested = rows.find((p) => p.status === "REQUESTED");
  assert.equal(requested?.reconciliationState, undefined, "never defaulted, never guessed");

  // Return ceremony on a fresh transport: reason -> failureReason, plus the
  // provider's reference.
  const g = mockFinance();
  const gInFlight = (await g.payouts.list(PAYOUTS_ACCT)).items.find(
    (p) => p.status === "PROVIDER_PROCESSING",
  );
  const returned = g.mock.simulations.payout.advance(gInFlight.id, "RETURNED", {
    failureReason: "Beneficiary account closed",
    providerReference: "RTN-100233",
  });
  assert.equal(returned.failureReason, "Beneficiary account closed");
  assert.equal(returned.providerReference, "RTN-100233");
});

test("payout twin: the finance routes never serve a management-plane field", async () => {
  const f = mockFinance();
  const sim = f.mock.simulations;
  const inFlight = (await f.payouts.list(PAYOUTS_ACCT)).items.find(
    (p) => p.status === "PROVIDER_PROCESSING",
  );
  sim.payout.advance(inFlight.id, "COMPLETED", {
    note: "must never reach the finance plane",
    fiatReference: "FR-LEAK-CHECK",
    dakotaOfframpTxId: "dk-leak-check",
    providerReference: "PR-LEAK-CHECK",
    reconciliationState: "MATCHED",
  });

  const TWIN_KEYS = [
    "reconciliationState",
    "providerType",
    "providerPayoutId",
    "providerReference",
    "sourceWalletAddress",
    "minutesInProviderProcessing",
    "note",
    "fiatReference",
    "dakotaOfframpTxId",
  ];
  const listed = (await f.payouts.list(PAYOUTS_ACCT)).items.find((p) => p.id === inFlight.id);
  const detail = await f.payouts.get(PAYOUTS_ACCT, inFlight.id);
  for (const key of TWIN_KEYS) {
    assert.equal(key in listed, false, `list must not serve ${key}`);
    assert.equal(key in detail, false, `detail must not serve ${key}`);
  }
  // And the wire projection still serves every PayoutDto field it has.
  assert.equal(detail.status, "COMPLETED");
  assert.ok(detail.completedAt);
  assert.ok(detail.settledFiatAmount);
});

test("payout twin: demoCast seeds the reconciliation axis on the in-flight payout", async () => {
  const f = mockFinance();
  const sim = f.mock.simulations;
  const { demoCast } = await import("../dist/esm/index.js").then((m) => ({ demoCast: m.demoCast }));
  sim.seed(demoCast);
  const rows = sim.payout.list();
  const atProvider = rows.find((p) => p.status === "PROVIDER_PROCESSING");
  assert.equal(atProvider.reconciliationState, "IN_PROGRESS");
  assert.equal(atProvider.providerType, "IRON");
  assert.equal(typeof atProvider.minutesInProviderProcessing, "number");
  const returned = rows.find((p) => p.status === "RETURNED");
  assert.equal(returned.providerType, "DAKOTA");
  assert.equal(returned.reconciliationState, undefined, "the mock never guesses a computed value");
});

test("payout settlement never defaults at par: the seeded rate converts, unknown pairs refuse", async () => {
  const f = mockFinance();
  const sim = f.mock.simulations;
  const inFlight = (await f.payouts.list(PAYOUTS_ACCT)).items.find(
    (p) => p.status === "PROVIDER_PROCESSING",
  );
  // The seeded in-flight payout is USDC -> EUR. Completing it without an
  // explicit settled amount must convert at the seeded USDC/EUR rate - a
  // 1:1 default would render "Settled 820.50 EUR / Difference 0.00" and
  // teach that a crypto unit IS a euro.
  const completed = sim.payout.advance(inFlight.id, "COMPLETED");
  assert.notEqual(
    completed.settledFiatAmount,
    completed.cryptoAmount,
    "the fiat side must not coincide with the crypto side",
  );
  assert.equal(completed.settledFiatAmount, Math.round(completed.cryptoAmount * 0.92 * 100) / 100);

  // A pair the rate table does not carry is refused, not guessed.
  const g = mockFinance();
  const gInFlight = (await g.payouts.list(PAYOUTS_ACCT)).items.find(
    (p) => p.status === "PROVIDER_PROCESSING",
  );
  g.mock.$store.payouts.find((p) => p.id === gInFlight.id).payoutRoute.fiatCurrency = "CHF";
  assert.throws(
    () => g.mock.simulations.payout.advance(gInFlight.id, "COMPLETED"),
    /no exchange rate is configured for USDC\/CHF/,
  );
  // The explicit override still works for exactly that case.
  const settled = g.mock.simulations.payout.advance(gInFlight.id, "COMPLETED", {
    settledFiatAmount: 731.9,
  });
  assert.equal(settled.settledFiatAmount, 731.9);
});

test("payouts: the embedded beneficiary is the route's OWN bank account, never a lookalike", async () => {
  const f = mockFinance();

  // Register a beneficiary that shares the seeded account's currency but
  // nothing else - the exact conditions under which a currency-matched
  // lookup serves the wrong party.
  const registered = await f.payoutBankAccounts.register(ORG_PARTY, {
    rail: "SEPA",
    fiatCurrency: "EUR",
    label: "Meridian settlement",
    accountHolderName: "Meridian Suppliers GmbH",
    railDetails: { iban: "DE02120300000000202051" },
    bankName: "Deutsche Bank AG",
  });
  f.mock.advancePayoutBankAccount(registered.id);
  const route = await f.payoutRoutes.create(PAYOUTS_ACCT, {
    payoutBankAccountId: registered.id,
    depositAsset: { chain: "BASE", name: "USDC" },
  });
  const proof = await f.payoutRoutes.prepareOwnershipProof(PAYOUTS_ACCT, route.id);
  await f.payoutRoutes.completeOwnershipProof(PAYOUTS_ACCT, route.id, {
    message: proof.message,
    signature: "0xsigned",
  });

  const payout = await f.payouts.request(PAYOUTS_ACCT, {
    payoutRouteId: route.id,
    cryptoAmount: 120.25,
    idempotencyKey: "9b2f4c6e-1d3a-4f5b-8c7d-0a1b2c3d4e5f",
  });
  assert.equal(payout.payoutRoute.id, route.id);
  const beneficiary = payout.payoutRoute.beneficiary;
  assert.equal(beneficiary?.accountHolderName, "Meridian Suppliers GmbH");
  assert.equal(beneficiary?.bankName, "Deutsche Bank AG");
  assert.equal(beneficiary?.details?.ibanLast4, "2051");
  assert.equal(beneficiary?.id, registered.id);

  // The read-back agrees with the create response - review and detail must
  // never contradict each other about who gets paid.
  const detail = await f.payouts.get(PAYOUTS_ACCT, payout.id);
  assert.equal(detail.payoutRoute.beneficiary?.accountHolderName, "Meridian Suppliers GmbH");
  assert.equal(detail.payoutRoute.beneficiary?.details?.ibanLast4, "2051");

  // The SEEDED active route keeps its declared pairing (Acme's EUR account).
  const seededPayout = await f.payouts.request(PAYOUTS_ACCT, {
    payoutRouteId: ACTIVE_ROUTE,
    cryptoAmount: 60.75,
    idempotencyKey: "1e2d3c4b-5a69-4788-9796-a5b4c3d2e1f0",
  });
  assert.equal(seededPayout.payoutRoute.beneficiary?.accountHolderName, "Acme Corporation B.V.");
  assert.equal(seededPayout.payoutRoute.beneficiary?.details?.ibanLast4, "3000");
});
