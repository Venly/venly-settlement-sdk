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
  assert.equal(done.settledFiatAmount, 1500, "COMPLETED carries the settled fiat amount");
  assert.ok(done.payoutRoute?.beneficiary?.details?.ibanLast4, "beneficiary details are masked");

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
  const prep = await f.payoutRoutes.prepareOwnershipProof(PAYOUTS_ACCT, route.id, {
    walletAddress: "0x9f8b2ca4df2f3cbb3a2f6dc38c1ef4d1b6c1e8a2",
    blockchain: "BASE",
  });
  assert.ok(prep.message.includes(route.id), "the message binds to this route");
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
  assert.equal(completed.settledFiatAmount, 250.5, "stablecoin par unless overridden");
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
