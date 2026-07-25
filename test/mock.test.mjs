// Mock-mode contract tests: zero credentials, zero network, fixture-backed.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { VenlyFinanceClient, FundflowClient, VenlyApiError } from "../dist/esm/index.js";

const mockFinance = () => new VenlyFinanceClient({ environment: "mock" });
const mockFundflow = () => new FundflowClient({ environment: "mock" });

test("mock: constructs without credentials; mock controls present only in mock mode", () => {
  const finance = mockFinance();
  const fundflow = mockFundflow();
  assert.ok(finance.mock, "finance client exposes .mock");
  assert.ok(fundflow.mock, "fundflow client exposes .mock");

  const real = new VenlyFinanceClient({
    clientId: "id",
    clientSecret: "secret",
    environment: "staging",
    fetch: async () => {
      throw new Error("no network in this test");
    },
  });
  assert.equal(real.mock, undefined, "credentialed client has no .mock");
});

test("mock: zero network - global fetch is never touched", async (t) => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = () => {
    fetchCalls += 1;
    throw new Error("mock mode must not touch the network");
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const finance = mockFinance();
  const fundflow = mockFundflow();
  await finance.parties.create({ partyType: "INDIVIDUAL", firstName: "Ada", lastName: "L" });
  await finance.accounts.list();
  for await (const _ of finance.parties.iterate({ size: 2 })) {
    void _;
  }
  await fundflow.rampRequests.get("123e4567-e89b-12d3-a456-426614174000");
  await fundflow.referenceData.chains();
  assert.equal(fetchCalls, 0);
});

test("mock: every namespace method returns a plausible fixture", async () => {
  const f = mockFinance();
  const ff = mockFundflow();
  const acct = "a10c2d31-2222-4b20-8c63-000000000001";
  const wal = "w1f3a8c2-3333-4c30-9d74-000000000001";

  const smoke = [
    // [description, promise, assertion]
    ["parties.list", f.parties.list(), (r) => r.items.length > 0],
    ["parties.get", f.parties.get("p-1"), (r) => r.id === "p-1"],
    ["parties.update", f.parties.update("p-1", { firstName: "G" }), (r) => r.firstName === "G"],
    ["parties.delete", f.parties.delete("p-1"), (r) => r === undefined],
    ["parties.listAccounts", f.parties.listAccounts("p-1"), (r) => r.items.length > 0],
    ["accounts.list", f.accounts.list(), (r) => r.items.length === 5],
    ["accounts.get", f.accounts.get(acct), (r) => r.id === acct],
    ["accounts.suspend", f.accounts.suspend(acct), (r) => r.status === "SUSPENDED"],
    ["accounts.reactivate", f.accounts.reactivate(acct), (r) => r.status === "ACTIVE"],
    ["accounts.listPartyRoles", f.accounts.listPartyRoles(acct), (r) => r.items.length > 0],
    [
      "accounts.addPartyRole",
      f.accounts.addPartyRole(acct, { partyId: "p-9", roleType: "ACCOUNT_HOLDER" }),
      (r) => r.partyId === "p-9",
    ],
    ["accounts.removePartyRole", f.accounts.removePartyRole(acct, "p-9"), (r) => r === undefined],
    ["wallets.list", f.wallets.list(acct), (r) => r.items[0].chain === "BASE"],
    ["wallets.get", f.wallets.get(acct, wal), (r) => r.id === wal],
    [
      "virtualBankAccounts.list",
      f.virtualBankAccounts.list(acct),
      (r) => r.items.some((v) => v.referenceCode === "REF-ABC-123"),
    ],
    [
      "virtualBankAccounts.create",
      f.virtualBankAccounts.create(acct, { name: "New EUR", inCurrency: "EUR" }),
      (r) => r.name === "New EUR",
    ],
    ["virtualBankAccounts.get", f.virtualBankAccounts.get(acct, "vb-1"), (r) => r.id === "vb-1"],
    [
      "paymentLinks.create",
      f.paymentLinks.create(acct, { externalRef: "order-1" }),
      (r) => typeof r.paymentUrl === "string",
    ],
    [
      "paymentRequests.create",
      f.paymentRequests.create(acct, { amount: 9.5, currency: "USD" }),
      (r) => r.amount === 9.5,
    ],
    [
      "transfers.createFiat",
      f.transfers.createFiat(acct, { receiverAccountId: "acc-2", fiatAmount: "10.00", fiatCurrency: "EUR" }),
      (r) => typeof r.id === "string",
    ],
    ["transfers.list", f.transfers.list(acct), (r) => r.items.length === 5],
    ["transfers.get", f.transfers.get(acct, "tr-1"), (r) => r.id === "tr-1"],
    ["accountToAccountTransfers.list", f.accountToAccountTransfers.list(), (r) => r.items.length > 0],
    ["permits.getMessages", f.permits.getMessages(acct, wal), (r) => r.length > 0],
    ["allowances.list", f.allowances.list(acct, wal), (r) => r.length > 0],
    ["fundflow rampRequests.list", ff.rampRequests.list(), (r) => r.items.length === 5],
    [
      "fundflow rampRequests.get",
      ff.rampRequests.get("rr-1"),
      (r) => r.id === "rr-1" && r.version === 3,
    ],
    ["fundflow onRampPairs", ff.rampRequests.onRampPairs(), (r) => r.length > 0],
    ["fundflow fees.calculate", ff.fees.calculate({ amount: 1000 }), (r) => r.percentage === 1.0],
    ["fundflow fees.listCompanyFees", ff.fees.listCompanyFees(), (r) => r.length > 0],
    ["fundflow fiatCurrencies", ff.referenceData.fiatCurrencies(), (r) => r.length === 3],
    ["fundflow cryptoCurrencies", ff.referenceData.cryptoCurrencies(), (r) => r.length === 2],
    ["fundflow chains", ff.referenceData.chains(), (r) => r.length > 0],
  ];

  for (const [name, promise, check] of smoke) {
    const result = await promise;
    assert.ok(check(result), `${name} returned an implausible fixture: ${JSON.stringify(result)?.slice(0, 120)}`);
  }
});

test("mock: create echoes the request body over fixture defaults", async () => {
  const f = mockFinance();
  const created = await f.parties.create({
    partyType: "ORGANISATION",
    name: "Borealis GmbH",
  });
  assert.equal(created.name, "Borealis GmbH");
  assert.equal(created.partyType, "ORGANISATION");
  assert.ok(created.id, "id comes from the fixture base");
});

test("mock: pagination slices, reports correct metadata, and iterate() terminates", async () => {
  const f = mockFinance();
  const page1 = await f.parties.list({ page: 1, size: 2 });
  assert.equal(page1.items.length, 2);
  assert.equal(page1.pagination.numberOfPages, 3);
  assert.equal(page1.pagination.hasNextPage, true);
  assert.equal(page1.pagination.hasPreviousPage, false);

  const page3 = await f.parties.list({ page: 3, size: 2 });
  assert.equal(page3.items.length, 1);
  assert.equal(page3.pagination.hasNextPage, false);

  const seen = [];
  for await (const party of f.parties.iterate({ size: 2 })) {
    seen.push(party.id);
    assert.ok(seen.length <= 10, "iterate() must terminate");
  }
  assert.equal(new Set(seen).size, 5, "iterate yields all 5 distinct parties");
});

test("mock: failNext throws a real VenlyApiError, then the next call succeeds", async () => {
  const ff = mockFundflow();
  ff.mock.failNext("OPTIMISTIC_LOCK_EXCEPTION");
  await assert.rejects(
    () => ff.rampRequests.approve("rr-1", { version: 2 }),
    (err) => {
      assert.ok(err instanceof VenlyApiError);
      assert.equal(err.status, 409);
      assert.equal(err.errors[0].code, "OPTIMISTIC_LOCK_EXCEPTION");
      assert.ok(err.traceCode, "mock errors carry a traceCode");
      return true;
    },
  );
  const after = await ff.rampRequests.approve("rr-1", { version: 3 });
  assert.equal(after.status, "AWAITING_FUNDS");
  assert.equal(after.version, 4, "approve bumps the optimistic-locking version");
});

test("mock: failNext supports custom specs and route matching", async () => {
  const f = mockFinance();
  f.mock.failNext({ status: 422, code: "INSUFFICIENT_FUNDS", message: "Not enough." }, "POST /parties");
  // A non-matching call passes through untouched...
  const ok = await f.accounts.get("a-1");
  assert.equal(ok.id, "a-1");
  // ...the matching one fails with the custom spec.
  await assert.rejects(
    () => f.parties.create({ partyType: "INDIVIDUAL" }),
    (err) => err instanceof VenlyApiError && err.status === 422 && err.errors[0].code === "INSUFFICIENT_FUNDS",
  );
});

test("mock: unmocked path fails with a helpful 404 listing known routes", async () => {
  const f = mockFinance();
  await assert.rejects(
    () => f.request("GET", "/does-not-exist"),
    (err) =>
      err instanceof VenlyApiError &&
      err.status === 404 &&
      /No mock fixture for GET \/does-not-exist/.test(err.errors[0].message) &&
      /GET \/parties/.test(err.errors[0].message),
  );
});

test("mock: call log records everything in order; clear() resets", async () => {
  const f = mockFinance();
  await f.parties.list({ page: 1, size: 2 });
  await f.parties.create({ partyType: "INDIVIDUAL", firstName: "Ada" }, { idempotencyKey: "my-key" });
  const calls = f.mock.calls;
  assert.equal(calls.length, 2);
  assert.equal(calls[0].method, "GET");
  assert.equal(calls[0].route, "GET /parties");
  assert.equal(calls[0].query.size, 2);
  assert.equal(calls[1].method, "POST");
  assert.equal(calls[1].body.firstName, "Ada");
  assert.equal(calls[1].idempotencyKey, "my-key");
  f.mock.clear();
  assert.equal(f.mock.calls.length, 0);
});

test("mock: fixtures are cloned per call - mutating a result cannot poison later calls", async () => {
  const f = mockFinance();
  const first = await f.accounts.get("a-1");
  first.status = "BLOCKED";
  const second = await f.accounts.get("a-1");
  assert.equal(second.status, "ACTIVE");
});

test("mock: CSV export returns the raw string", async () => {
  const ff = mockFundflow();
  const csv = await ff.rampRequests.export();
  assert.match(csv, /^id,paymentReference,rampType/);
  assert.match(csv, /PAY-2024-001234/);
});

test("mock: approve/reject/cancel record the optimistic-locking body", async () => {
  const ff = mockFundflow();
  await ff.rampRequests.reject("rr-9", { version: 5 });
  const call = ff.mock.calls.at(-1);
  assert.equal(call.route, "POST /v1/ramp-requests/{id}/reject");
  assert.deepEqual(call.body, { version: 5 });
});

test("mock: clean-room ESM and CJS entry both construct and answer", () => {
  const esm = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import { VenlyFinanceClient } from "./dist/esm/index.js";
       const c = new VenlyFinanceClient({ environment: "mock" });
       const p = await c.parties.list();
       if (p.items.length !== 5) throw new Error("bad fixture count");`,
    ],
    { cwd: new URL("..", import.meta.url).pathname, encoding: "utf8" },
  );
  assert.equal(esm.status, 0, `ESM spawn failed: ${esm.stderr}`);

  const cjs = spawnSync(
    process.execPath,
    [
      "-e",
      `const { FundflowClient } = require("./dist/cjs/index.js");
       new FundflowClient({ environment: "mock" }).referenceData.chains().then((c) => {
         if (!c.length) { console.error("no chains"); process.exit(1); }
       });`,
    ],
    { cwd: new URL("..", import.meta.url).pathname, encoding: "utf8" },
  );
  assert.equal(cjs.status, 0, `CJS spawn failed: ${cjs.stderr}`);
});

// ─── Evaluator-round regressions (2026-07-25 NEEDS_WORK findings) ───

test("mock: error presets teach each API's real codes (evaluator findings 1+2)", async () => {
  const f = mockFinance();
  f.mock.failNext("INTERNAL_SERVER_ERROR");
  await assert.rejects(
    () => f.accounts.get("a-1"),
    (err) => err.status === 500 && err.errors[0].code === "INTERNAL_SERVER_ERROR",
  );
  f.mock.failNext("VALIDATION_ERROR");
  await assert.rejects(
    () => f.accounts.get("a-1"),
    (err) => err.errors[0].code === "VALIDATION_ERROR", // finance spec: uppercase
  );

  const ff = mockFundflow();
  ff.mock.failNext("VALIDATION_ERROR");
  await assert.rejects(
    () => ff.rampRequests.get("rr-1"),
    (err) => err.errors[0].code === "validation-error", // fundflow spec: lowercase
  );
  ff.mock.failNext("INTERNAL_SERVER_ERROR");
  await assert.rejects(
    () => ff.rampRequests.get("rr-1"),
    (err) => err.errors[0].code === "INTERNAL_SERVER_ERROR",
  );
});

test("mock: literal route shadows {id} template, same as the live router (evaluator finding 3)", async () => {
  const ff = mockFundflow();
  // get("export") routes to the CSV endpoint exactly as the real API would;
  // the SDK method then unwraps a string to undefined (no valid DTO). Pin the
  // routing and the degraded result, and pin that a real UUID still hits the
  // by-id route.
  const shadowed = await ff.rampRequests.get("export");
  assert.equal(shadowed, undefined, "shadowed call must not fabricate a DTO");
  assert.equal(ff.mock.calls.at(-1).route, "GET /v1/ramp-requests/export");
  const real = await ff.rampRequests.get("123e4567-e89b-12d3-a456-426614174000");
  assert.equal(real.version, 3);
  assert.equal(ff.mock.calls.at(-1).route, "GET /v1/ramp-requests/{id}");
});
