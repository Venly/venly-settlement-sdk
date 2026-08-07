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
