import { test } from "node:test";
import assert from "node:assert/strict";
import { venlyKeys } from "../src/keys.js";
import { venlyQueries } from "../src/query-options.js";
import { mockClients } from "./helpers.js";

test("query keys are stable for equal input and distinct across resources", () => {
  assert.deepEqual(venlyKeys.parties({ page: 1 }), venlyKeys.parties({ page: 1 }));
  assert.notDeepEqual(venlyKeys.parties(), venlyKeys.accounts());
  assert.notDeepEqual(venlyKeys.account("a"), venlyKeys.account("b"));
  // Detail and list keys for the same account share a prefix, so one
  // invalidation of ["venly","account",id] reaches wallets and transfers.
  assert.deepEqual(venlyKeys.wallets("a").slice(0, 3), venlyKeys.transfers("a").slice(0, 3));
});

test("factories resolve against the mock store", async () => {
  const clients = mockClients();

  const parties = await venlyQueries.parties(clients).queryFn();
  assert.ok(parties.items.length > 0, "seeded parties");

  const accounts = await venlyQueries.accounts(clients).queryFn();
  assert.ok(accounts.items.length > 0, "seeded accounts");
  const accountId = accounts.items[0]!.id!;

  const account = await venlyQueries.account(clients, accountId).queryFn();
  assert.equal(account.id, accountId);

  const vibas = await venlyQueries.virtualBankAccounts(clients, accountId).queryFn();
  assert.ok(Array.isArray(vibas.items));

  const reference = await venlyQueries.referenceData(clients).queryFn();
  assert.ok(reference.fiatCurrencies.length > 0);
  assert.ok(reference.cryptoCurrencies.length > 0);
  assert.ok(reference.chains.length > 0);

  const ramps = await venlyQueries.rampRequests(clients).queryFn();
  assert.ok(ramps.items.length > 0, "seeded ramp requests");
});

test("errors propagate as-is so hooks surface real VenlyApiErrors", async () => {
  const clients = mockClients();
  clients.finance.mock!.failNext("NOT_FOUND");
  await assert.rejects(
    () => venlyQueries.account(clients, "missing").queryFn(),
    (e: { status?: number }) => e.status === 404,
  );
});

test("new keys are stable, distinct, and prefix-aligned with mutation invalidations", () => {
  assert.deepEqual(venlyKeys.companyBankAccounts(), venlyKeys.companyBankAccounts());
  assert.notDeepEqual(venlyKeys.companyBankAccounts(), venlyKeys.companyWallets());
  assert.notDeepEqual(venlyKeys.rampPairs("on"), venlyKeys.rampPairs("off"));
  // Mutations invalidate by prefix with string literals; a typo'd literal
  // would silently never invalidate. Pin the prefixes to the key factory.
  assert.deepEqual(venlyKeys.companyBankAccounts().slice(0, 2), ["venly", "company-bank-accounts"]);
  assert.deepEqual(venlyKeys.companyWallets().slice(0, 2), ["venly", "company-wallets"]);
  assert.deepEqual(venlyKeys.rampRequests().slice(0, 2), ["venly", "ramp-requests"]);
  assert.deepEqual(venlyKeys.companyBankAccount("x"), ["venly", "company-bank-account", "x"]);
});

test("whitelisting + reference factories resolve against the stateful mock", async () => {
  const clients = mockClients();

  const accounts = await venlyQueries.companyBankAccounts(clients).queryFn();
  assert.equal(accounts.items.length, 2, "seeded bank accounts");

  const pending = await venlyQueries
    .companyBankAccounts(clients, { verificationStatus: "PENDING" })
    .queryFn();
  assert.equal(pending.items.length, 1, "filter reaches the store");

  const detailId = accounts.items[0]!.id!;
  const detail = await venlyQueries.companyBankAccount(clients, detailId).queryFn();
  assert.equal(detail.id, detailId);

  const wallets = await venlyQueries.companyWallets(clients).queryFn();
  assert.equal(wallets.items.length, 2, "seeded company wallets");

  const config = await venlyQueries.bankAccountConfig(clients).queryFn();
  assert.ok(config.enabledAccountTypes!.some((t) => t.type === "EUR_SEPA"));

  const deposits = await venlyQueries.depositWallets(clients).queryFn();
  assert.ok(deposits.length > 0 && deposits[0]!.address!.startsWith("0x"));

  const onPairs = await venlyQueries.rampPairs(clients, "on").queryFn();
  const offPairs = await venlyQueries.rampPairs(clients, "off").queryFn();
  assert.ok(onPairs.length > 0 && offPairs.length > 0);
});

test("ramp write path the new mutations wrap: setAmount + initiate against the state machine", async () => {
  const clients = mockClients();
  const AWAITING_APPROVAL = "123e4567-e89b-12d3-a456-426614174000";

  // useSetRampAmount wraps setAmount(id, {version, amount}).
  const before = await clients.fundflow.rampRequests.get(AWAITING_APPROVAL);
  const edited = await clients.fundflow.rampRequests.setAmount(AWAITING_APPROVAL, {
    version: before.version!,
    amount: 2000,
  });
  assert.equal(edited.fiatAmount, 2000);
  assert.ok(edited.events!.some((e) => e.eventType === "AMOUNT_CHANGED"));

  // useInitiateRamp wraps initiate(id, {version, blockchainTransactionHash})
  // on an approved OFF_RAMP: create -> approve -> initiate -> PROCESSING.
  const created = await clients.fundflow.rampRequests.create({
    rampType: "OFF_RAMP",
    amount: 100,
    fiatCurrencyId: "fc000001-0000-4000-8000-000000000001",
    cryptoCurrencyId: "cc000001-0000-4000-8000-000000000001",
    companyBankAccountId: "ba000001-0000-4000-8000-000000000001",
  });
  const approved = await clients.fundflow.rampRequests.approve(created.id!, { version: 0 });
  const initiated = await clients.fundflow.rampRequests.initiate(created.id!, {
    version: approved.version!,
    blockchainTransactionHash: "0x" + "cd".repeat(32),
  });
  assert.equal(initiated.status, "PROCESSING");

  // A stale version surfaces as the real 409 hooks must render.
  await assert.rejects(
    () => clients.fundflow.rampRequests.setAmount(AWAITING_APPROVAL, { version: 0, amount: 5 }),
    (e: { status?: number }) => e.status === 409,
  );
});
