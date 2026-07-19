import test from "node:test";
import assert from "node:assert/strict";
import { VenlyFinanceClient, FundflowClient } from "../dist/esm/index.js";
import { mockFetch, jsonResponse, clientOptions } from "./helpers.mjs";

test("finance: staging environment picks the staging base URL", async () => {
  const fetch = mockFetch(() => jsonResponse({ success: true, result: [] }));
  const client = new VenlyFinanceClient(clientOptions(fetch));

  await client.accounts.list();

  assert.ok(
    fetch.apiCalls()[0].url.startsWith("https://api-staging.venlyfinance.com/api/v1/accounts"),
  );
  assert.ok(fetch.calls[0].url.startsWith("https://login-sandbox.venly.io/"));
});

test("finance: envelope is unwrapped so methods return the result directly", async () => {
  const fetch = mockFetch(() =>
    jsonResponse({ success: true, result: { id: "acc-1", status: "ACTIVE" } }),
  );
  const client = new VenlyFinanceClient(clientOptions(fetch));

  const account = await client.accounts.get("acc-1");
  assert.deepEqual(account, { id: "acc-1", status: "ACTIVE" });
});

test("finance: happy path per resource namespace hits the right path/method", async () => {
  const fetch = mockFetch(() => jsonResponse({ success: true, result: {} }));
  const client = new VenlyFinanceClient(clientOptions(fetch));

  await client.parties.create({ partyType: "INDIVIDUAL", firstName: "A", lastName: "B" });
  await client.accounts.suspend("acc-1");
  await client.wallets.create("acc-1", {});
  await client.virtualBankAccounts.create("acc-1", { currency: "EUR" });
  await client.paymentLinks.create("acc-1", {});
  await client.paymentRequests.createByCardProvider({});
  await client.transfers.createFiat("acc-1", {});
  await client.accountToAccountTransfers.create({});
  await client.permits.submit("acc-1", "w-1", {});
  await client.allowances.list("acc-1", "w-1");

  const seen = fetch.apiCalls().map((c) => {
    const u = new URL(c.url);
    return `${c.init.method} ${u.pathname}`;
  });
  assert.deepEqual(seen, [
    "POST /api/v1/parties",
    "POST /api/v1/accounts/acc-1/suspend",
    "POST /api/v1/accounts/acc-1/wallets",
    "POST /api/v1/accounts/acc-1/virtual-bank-accounts",
    "POST /api/v1/accounts/acc-1/fiat-to-crypto/payment-links",
    "POST /api/v1/payment-requests",
    "POST /api/v1/accounts/acc-1/transfers/fiat",
    "POST /api/v1/account-to-account-transfers",
    "POST /api/v1/accounts/acc-1/wallets/w-1/permits",
    "GET /api/v1/accounts/acc-1/wallets/w-1/allowances",
  ]);
});

test("finance: request() escape hatch applies auth and idempotency", async () => {
  const fetch = mockFetch(() => jsonResponse({ ok: true }));
  const client = new VenlyFinanceClient(clientOptions(fetch));

  const res = await client.request("POST", "/some/unwrapped/endpoint", { body: { x: 1 } });
  assert.deepEqual(res, { ok: true });

  const call = fetch.apiCalls()[0];
  assert.ok(call.init.headers["Authorization"].startsWith("Bearer "));
  assert.ok(call.init.headers["Idempotency-Key"]);
  assert.equal(call.init.body, JSON.stringify({ x: 1 }));
});

test("fundflow: ramp request lifecycle paths", async () => {
  const fetch = mockFetch(() => jsonResponse({ success: true, result: { id: "r-1" } }));
  const client = new FundflowClient(clientOptions(fetch));

  await client.rampRequests.create({});
  await client.rampRequests.approve("r-1");
  await client.rampRequests.reject("r-2");
  await client.rampRequests.setAmount("r-3", { amount: 10 });
  await client.fees.calculate({});

  const seen = fetch.apiCalls().map((c) => `${c.init.method} ${new URL(c.url).pathname}`);
  assert.deepEqual(seen, [
    "POST /v1/ramp-requests",
    "POST /v1/ramp-requests/r-1/approve",
    "POST /v1/ramp-requests/r-2/reject",
    "PUT /v1/ramp-requests/r-3/amount",
    "POST /v1/fees/calculate",
  ]);
  assert.ok(fetch.apiCalls()[0].url.startsWith("https://api-fundflow-staging.venly.io/"));
});

test("fundflow: reference data unwraps arrays", async () => {
  const fetch = mockFetch(() =>
    jsonResponse({ success: true, result: [{ symbol: "USDC" }, { symbol: "EURC" }] }),
  );
  const client = new FundflowClient(clientOptions(fetch));

  const currencies = await client.referenceData.cryptoCurrencies();
  assert.equal(currencies.length, 2);
  assert.equal(currencies[0].symbol, "USDC");
});

test("cjs: the CommonJS build is requireable", async () => {
  const { createRequire } = await import("node:module");
  const require = createRequire(import.meta.url);
  const cjs = require("../dist/cjs/index.js");
  assert.equal(typeof cjs.VenlyFinanceClient, "function");
  assert.equal(typeof cjs.FundflowClient, "function");
  assert.equal(typeof cjs.VenlyApiError, "function");
});
