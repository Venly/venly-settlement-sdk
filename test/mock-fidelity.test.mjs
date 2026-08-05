// Mock-fidelity regressions: the mock must teach the documented lifecycle, not
// a happy-path fiction. Each block pins a finding from the 2026-08-04 outside
// integrator audit (Report 1 §1.1, §1.2, §1.4, §1.5, §1.6).
import test from "node:test";
import assert from "node:assert/strict";
import { VenlyFinanceClient, VenlyApiError } from "../dist/esm/index.js";

const mockFinance = () => new VenlyFinanceClient({ environment: "mock" });
const ACCT_1 = "a10c2d31-2222-4b20-8c63-000000000001";
const ACCT_2 = "a10c2d31-2222-4b20-8c63-000000000002";
const KEY = "7c9e6679-7425-40de-944b-e07fc1f90ae0";

// ── §1.1 verification starts pending and is advanced deliberately ────────

test("fidelity: a created INDIVIDUAL starts VERIFICATION_PENDING and can be advanced", async () => {
  const f = mockFinance();
  const p = await f.parties.create({ partyType: "INDIVIDUAL", firstName: "Ada", lastName: "L" });
  assert.equal(p.kycStatus, "VERIFICATION_PENDING", "creation starts KYC; it does not complete it");
  assert.equal(p.status, "ACTIVE");

  const readBack = await f.parties.get(p.id);
  assert.equal(readBack.kycStatus, "VERIFICATION_PENDING", "get() returns the stored record");

  f.mock.advanceVerification(p.id);
  assert.equal((await f.parties.get(p.id)).kycStatus, "VERIFIED");

  const rejected = await f.parties.create({ partyType: "INDIVIDUAL", firstName: "B", lastName: "C" });
  f.mock.advanceVerification(rejected.id, "REJECTED");
  assert.equal((await f.parties.get(rejected.id)).kycStatus, "REJECTED");
});

test("fidelity: a created ORGANISATION tracks kybStatus, never kycStatus", async () => {
  const f = mockFinance();
  const org = await f.parties.create({ partyType: "ORGANISATION", name: "Acme BV" });
  assert.equal(org.kybStatus, "PENDING");
  assert.equal(org.kycStatus, undefined);

  f.mock.advanceVerification(org.id, "REJECTED");
  assert.equal((await f.parties.get(org.id)).kybStatus, "DENIED", "KYB's negative state is DENIED");
});

test("fidelity: a created account starts VERIFICATION_PENDING with an auto-provisioned wallet", async () => {
  const f = mockFinance();
  const acct = await f.accounts.create({ externalId: "acct-new", chain: "BASE", name: "New" });
  assert.equal(acct.kycStatus, "VERIFICATION_PENDING");

  const wallets = await f.wallets.list(acct.id);
  assert.equal(wallets.items.length, 1, "wallet is a side effect of account creation");
  assert.equal(wallets.items[0].chain, "BASE");
  assert.deepEqual(wallets.items[0].balances, [], "a fresh wallet holds nothing");

  f.mock.advanceVerification(acct.id);
  assert.equal((await f.accounts.get(acct.id)).kycStatus, "VERIFIED");
});

// ── §1.2 request bodies are validated against the vendored specs ─────────

test("fidelity: an invented field is rejected, not silently accepted", async () => {
  const f = mockFinance();
  await assert.rejects(
    () => f.parties.create({ partyType: "ORGANISATION", companyName: "Acme BV" }),
    (err) =>
      err instanceof VenlyApiError &&
      err.status === 400 &&
      /companyName/.test(err.errors[0].message) &&
      /Allowed fields/.test(err.errors[0].message),
  );
});

test("fidelity: unknown nested keys and missing required fields are rejected", async () => {
  const f = mockFinance();
  await assert.rejects(
    () =>
      f.parties.create({
        partyType: "INDIVIDUAL",
        firstName: "A",
        lastName: "B",
        address: { street: "nope" },
      }),
    (err) => err.status === 400 && /street/.test(err.errors[0].message),
  );
  await assert.rejects(
    () => f.accounts.create({ name: "no ids" }),
    (err) => err.status === 400 && /externalId/.test(err.errors[0].message),
  );
});

test("fidelity: cross-type party fields are rejected", async () => {
  const f = mockFinance();
  await assert.rejects(
    () => f.parties.create({ partyType: "ORGANISATION", name: "Acme", firstName: "Ada" }),
    (err) => err.status === 400,
  );
  await assert.rejects(
    () => f.parties.create({ partyType: "INDIVIDUAL" }),
    (err) => err.status === 400 && /firstName/.test(err.errors[0].message),
  );
});

// ── §1.5 transfers mint real ids, persist, and start PENDING ─────────────

test("fidelity: transfer lifecycle - minted id, persisted record, PENDING → COMPLETED", async () => {
  const f = mockFinance();
  const created = await f.transfers.createFiat(ACCT_1, {
    receiverAccountId: ACCT_2,
    currency: "EUR",
    amount: 25,
    description: "test run",
    idempotencyKey: KEY,
  });
  assert.notEqual(created.id, ACCT_1, "id is minted, not the sender account id echoed back");
  assert.equal(created.status, "PENDING", "transfers settle asynchronously");
  assert.equal(created.transactionHash, undefined);
  assert.equal(created.amount, 25);

  const read = await f.transfers.get(ACCT_1, created.id);
  assert.equal(read.amount, 25, "get() returns the record that was created");
  assert.equal(read.description, "test run");

  f.mock.advanceTransfer(created.id);
  const done = await f.transfers.get(ACCT_1, created.id);
  assert.equal(done.status, "COMPLETED");
  assert.match(done.transactionHash, /^0x[0-9a-f]{64}$/);

  const failing = await f.transfers.createFiat(ACCT_1, {
    receiverAccountId: ACCT_2,
    currency: "EUR",
    amount: 5,
    idempotencyKey: "7c9e6679-7425-40de-944b-e07fc1f90ae1",
  });
  f.mock.advanceTransfer(failing.id, "FAILED");
  const failed = await f.transfers.get(ACCT_1, failing.id);
  assert.equal(failed.status, "FAILED");
  assert.ok(failed.errorMessage);
});

test("fidelity: a transfer needs exactly one receiver", async () => {
  const f = mockFinance();
  await assert.rejects(
    () => f.transfers.createFiat(ACCT_1, { currency: "EUR", amount: 5, idempotencyKey: KEY }),
    (err) => err.status === 400 && /exactly one/.test(err.errors[0].message),
  );
  await assert.rejects(
    () =>
      f.transfers.createFiat(ACCT_1, {
        receiverAccountId: ACCT_2,
        receiverExternalId: "acct-ops-usd",
        currency: "EUR",
        amount: 5,
        idempotencyKey: KEY,
      }),
    (err) => err.status === 400 && /exactly one/.test(err.errors[0].message),
  );
});

// ── §1.6 fixture hygiene: filters, leakage, response shapes ───────────────

test("fidelity: transfers.list honors the accountRole filter", async () => {
  const f = mockFinance();
  const received = await f.transfers.list(ACCT_1, { accountRole: "RECEIVER" });
  assert.ok(received.items.length > 0);
  assert.ok(received.items.every((t) => t.receiverAccountId === ACCT_1));

  const sent = await f.transfers.list(ACCT_1, { accountRole: "SENDER" });
  assert.ok(sent.items.every((t) => t.senderAccountId === ACCT_1));
});

test("fidelity: virtual bank accounts never leak across accounts", async () => {
  const f = mockFinance();
  const own = await f.virtualBankAccounts.list(ACCT_1);
  assert.ok(own.items.every((v) => v.accountId === ACCT_1));
  const other = await f.virtualBankAccounts.list(ACCT_2);
  assert.equal(other.items.length, 0, "account 2 has no seeded vIBAN");
});

test("fidelity: each account has its own wallet", async () => {
  const f = mockFinance();
  const w1 = await f.wallets.list(ACCT_1);
  const w2 = await f.wallets.list(ACCT_2);
  assert.notEqual(w1.items[0].id, w2.items[0].id);
  assert.notEqual(w1.items[0].address, w2.items[0].address);
});

test("fidelity: create responses carry only response-schema fields", async () => {
  const f = mockFinance();
  const vba = await f.virtualBankAccounts.create(ACCT_1, {
    name: "Shape check",
    inCurrency: "EUR",
    targetCryptocurrency: "USDC",
    idempotencyKey: KEY,
  });
  assert.equal(vba.inCurrency, undefined, "inCurrency is request-only");
  assert.equal(vba.idempotencyKey, undefined, "idempotencyKey is not in the vIBAN response schema");
  assert.equal(vba.currency, "EUR", "the response carries currency");

  const tr = await f.transfers.createFiat(ACCT_1, {
    receiverAccountId: ACCT_2,
    currency: "EUR",
    amount: 7,
    idempotencyKey: "7c9e6679-7425-40de-944b-e07fc1f90ae2",
  });
  assert.equal(tr.currency, undefined, "currency is request-only on transfers");
  assert.deepEqual(tr.fiatOrigin, { amount: 7, currency: "EUR" });
});

test("fidelity: unknown ids 404 instead of returning an echoed fixture", async () => {
  const f = mockFinance();
  await assert.rejects(
    () => f.parties.get("00000000-0000-4000-8000-000000000000"),
    (err) => err.status === 404 && err.errors[0].code === "party-not-found",
  );
  // Transfer 003 runs treasury → main; the ops account is not involved.
  await assert.rejects(
    () => f.transfers.get(ACCT_2, "tr5e8c66-7777-4a70-9bb8-000000000003"),
    (err) => err.status === 404,
    "a transfer not involving the path account is not visible through it",
  );
});

// ── §1.4 one idempotency key per request ─────────────────────────────────

test("fidelity: body idempotencyKey and header key are the same value", async () => {
  const f = mockFinance();
  await f.transfers.createFiat(ACCT_1, {
    receiverAccountId: ACCT_2,
    currency: "EUR",
    amount: 1,
    idempotencyKey: KEY,
  });
  let call = f.mock.calls.at(-1);
  assert.equal(call.idempotencyKey, KEY, "header key follows the body key");
  assert.equal(call.body.idempotencyKey, KEY);

  await f.virtualBankAccounts.create(
    ACCT_1,
    { name: "K", inCurrency: "EUR", targetCryptocurrency: "USDC" },
    { idempotencyKey: "aligned-key" },
  );
  call = f.mock.calls.at(-1);
  assert.equal(call.body.idempotencyKey, "aligned-key", "a missing body key is filled from opts");
  assert.equal(call.idempotencyKey, "aligned-key");
});

// ── reset() restores the seeds ────────────────────────────────────────────

test("fidelity: reset() restores seed fixtures and clears the log", async () => {
  const f = mockFinance();
  await f.parties.create({ partyType: "INDIVIDUAL", firstName: "T", lastName: "D" });
  assert.equal((await f.parties.list()).items.length, 6);
  f.mock.reset();
  assert.equal((await f.parties.list()).items.length, 5);
  assert.equal(f.mock.calls.length, 1, "reset cleared the pre-reset log");
});
