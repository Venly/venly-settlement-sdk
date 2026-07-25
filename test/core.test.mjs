import test from "node:test";
import assert from "node:assert/strict";
import { VenlyFinanceClient, VenlyApiError, VenlyAuthError } from "../dist/esm/index.js";
import { mockFetch, jsonResponse, tokenResponse, clientOptions } from "./helpers.mjs";

test("auth: token is fetched once and reused across requests", async () => {
  const fetch = mockFetch(() => jsonResponse({ success: true, result: { id: "p1" } }));
  const client = new VenlyFinanceClient(clientOptions(fetch));

  await client.parties.get("p1");
  await client.parties.get("p1");
  await client.parties.get("p1");

  assert.equal(fetch.tokenCallCount(), 1);
  const auth = fetch.apiCalls()[0].init.headers["Authorization"];
  assert.equal(auth, "Bearer tok-1");
});

test("auth: concurrent first requests single-flight the token fetch", async () => {
  const fetch = mockFetch(() => jsonResponse({ success: true, result: { id: "p1" } }));
  const client = new VenlyFinanceClient(clientOptions(fetch));

  await Promise.all([
    client.parties.get("a"),
    client.parties.get("b"),
    client.parties.get("c"),
  ]);

  assert.equal(fetch.tokenCallCount(), 1);
});

test("auth: expired token is refreshed before the next request", async () => {
  // expires_in below the 30s skew floor => refreshAfter ~5s in the future is
  // still cached; use expiresIn 0 to force refresh on every call.
  const fetch = mockFetch(() => jsonResponse({ success: true, result: { id: "p1" } }), {
    tokens: (n) => tokenResponse({ token: `tok-${n}`, expiresIn: -10 }),
  });
  const client = new VenlyFinanceClient(clientOptions(fetch));

  await client.parties.get("a");
  await client.parties.get("b");

  assert.equal(fetch.tokenCallCount(), 2);
  assert.equal(fetch.apiCalls()[1].init.headers["Authorization"], "Bearer tok-2");
});

test("auth: token endpoint failure throws VenlyAuthError", async () => {
  const fetch = mockFetch(() => jsonResponse({}), {
    tokens: () => jsonResponse({ error: "invalid_client" }, { status: 401 }),
  });
  const client = new VenlyFinanceClient(clientOptions(fetch));

  await assert.rejects(client.parties.get("a"), VenlyAuthError);
});

test("auth: a 401 from the API invalidates the token and retries once", async () => {
  let apiHits = 0;
  const fetch = mockFetch(() => {
    apiHits += 1;
    if (apiHits === 1) return jsonResponse({ success: false, errors: [] }, { status: 401 });
    return jsonResponse({ success: true, result: { id: "p1" } });
  });
  const client = new VenlyFinanceClient(clientOptions(fetch));

  const party = await client.parties.get("p1");
  assert.equal(party.id, "p1");
  assert.equal(fetch.tokenCallCount(), 2);
});

test("idempotency: POST gets an auto-generated UUID key", async () => {
  const fetch = mockFetch(() => jsonResponse({ success: true, result: { id: "p1" } }));
  const client = new VenlyFinanceClient(clientOptions(fetch));

  await client.parties.create({ partyType: "INDIVIDUAL", firstName: "A", lastName: "B" });

  const key = fetch.apiCalls()[0].init.headers["Idempotency-Key"];
  assert.match(key, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
});

test("idempotency: caller-provided key wins and is stable across retries", async () => {
  let apiHits = 0;
  const fetch = mockFetch(() => {
    apiHits += 1;
    if (apiHits === 1) return jsonResponse({}, { status: 503 });
    return jsonResponse({ success: true, result: { id: "p1" } });
  });
  const client = new VenlyFinanceClient(clientOptions(fetch, { maxAttempts: 3 }));

  await client.parties.create(
    { partyType: "INDIVIDUAL", firstName: "A", lastName: "B" },
    { idempotencyKey: "my-key-1" },
  );

  const keys = fetch.apiCalls().map((c) => c.init.headers["Idempotency-Key"]);
  assert.deepEqual(keys, ["my-key-1", "my-key-1"]);
});

test("idempotency: GET requests carry no idempotency key", async () => {
  const fetch = mockFetch(() => jsonResponse({ success: true, result: { id: "p1" } }));
  const client = new VenlyFinanceClient(clientOptions(fetch));

  await client.parties.get("p1");
  assert.equal(fetch.apiCalls()[0].init.headers["Idempotency-Key"], undefined);
});

test("retry: 429 honours Retry-After and then succeeds", async () => {
  let apiHits = 0;
  const start = Date.now();
  const fetch = mockFetch(() => {
    apiHits += 1;
    if (apiHits === 1)
      return jsonResponse({}, { status: 429, headers: { "Retry-After": "1" } });
    return jsonResponse({ success: true, result: { id: "p1" } });
  });
  const client = new VenlyFinanceClient(clientOptions(fetch));

  const party = await client.parties.get("p1");
  assert.equal(party.id, "p1");
  assert.equal(apiHits, 2);
  assert.ok(Date.now() - start >= 1000, "waited at least Retry-After seconds");
});

test("retry: gives up after maxAttempts and throws VenlyApiError", async () => {
  const fetch = mockFetch(() => jsonResponse({}, { status: 503 }));
  const client = new VenlyFinanceClient(
    clientOptions(fetch, { maxAttempts: 2 }),
  );

  await assert.rejects(client.parties.get("p1"), (err) => {
    assert.ok(err instanceof VenlyApiError);
    assert.equal(err.status, 503);
    return true;
  });
  assert.equal(fetch.apiCalls().length, 2);
});

test("retry: 400 is not retried", async () => {
  const fetch = mockFetch(() =>
    jsonResponse(
      { success: false, errors: [{ code: "VALIDATION_ERROR", message: "bad", traceCode: "tc-9" }] },
      { status: 400 },
    ),
  );
  const client = new VenlyFinanceClient(clientOptions(fetch));

  await assert.rejects(client.parties.get("p1"), (err) => {
    assert.ok(err instanceof VenlyApiError);
    assert.equal(err.status, 400);
    assert.equal(err.traceCode, "tc-9");
    assert.match(err.message, /VALIDATION_ERROR/);
    return true;
  });
  assert.equal(fetch.apiCalls().length, 1);
});

test("retry: network errors are retried", async () => {
  let apiHits = 0;
  const fetch = mockFetch(() => {
    apiHits += 1;
    if (apiHits === 1) throw new TypeError("fetch failed");
    return jsonResponse({ success: true, result: { id: "p1" } });
  });
  const client = new VenlyFinanceClient(clientOptions(fetch));

  const party = await client.parties.get("p1");
  assert.equal(party.id, "p1");
  assert.equal(apiHits, 2);
});

test("pagination: iterate walks pages until hasNextPage is false", async () => {
  const pages = {
    1: { result: [{ id: "a" }, { id: "b" }], pagination: { hasNextPage: true } },
    2: { result: [{ id: "c" }], pagination: { hasNextPage: false } },
  };
  const fetch = mockFetch((url) => {
    const page = new URL(url).searchParams.get("page");
    return jsonResponse({ success: true, ...pages[page] });
  });
  const client = new VenlyFinanceClient(clientOptions(fetch));

  const seen = [];
  for await (const party of client.parties.iterate()) seen.push(party.id);

  assert.deepEqual(seen, ["a", "b", "c"]);
  assert.equal(fetch.apiCalls().length, 2);
});

test("query params: undefined values are dropped, defined ones serialised", async () => {
  const fetch = mockFetch(() => jsonResponse({ success: true, result: [] }));
  const client = new VenlyFinanceClient(clientOptions(fetch));

  await client.parties.list({ page: 2, size: 50, status: undefined });

  const url = new URL(fetch.apiCalls()[0].url);
  assert.equal(url.searchParams.get("page"), "2");
  assert.equal(url.searchParams.get("size"), "50");
  assert.equal(url.searchParams.has("status"), false);
});

// ─── Regressions for the 2026-07-25 fixes ───
import { FundflowClient } from "../dist/esm/index.js";

const fundflowOptions = (fetchImpl) => ({
  clientId: "test-client",
  clientSecret: "test-secret",
  environment: "staging",
  fetch: fetchImpl,
});

test("idempotency: PUT and PATCH now carry an Idempotency-Key too", async () => {
  const fetch = mockFetch(() => jsonResponse({ success: true, result: { id: "rr-1" } }));
  const client = new FundflowClient(fundflowOptions(fetch));

  await client.rampRequests.setAmount("rr-1", { fiatAmount: 100 });
  await client.rampRequests.initiate("rr-1", { transactionHash: "0xabc" });
  const keys = fetch.apiCalls().map((c) => c.init.headers["Idempotency-Key"]);
  assert.equal(keys.length, 2);
  for (const key of keys) assert.ok(key, "mutating request missing Idempotency-Key");
});

test("export: returns raw CSV text and keeps Accept: text/csv under caller headers", async () => {
  const csv = "id,status\nrr-1,SUCCEEDED";
  const fetch = mockFetch(() => new Response(csv, { status: 200, headers: { "Content-Type": "text/csv" } }));
  const client = new FundflowClient(fundflowOptions(fetch));

  const out = await client.rampRequests.export(undefined, { headers: { "X-Extra": "1" } });
  assert.equal(out, csv, "CSV body must not be JSON.parsed");
  const headers = fetch.apiCalls()[0].init.headers;
  assert.equal(headers["Accept"], "text/csv", "caller headers must not clobber Accept");
  assert.equal(headers["X-Extra"], "1");
});

test("approve: sends the optimistic-locking version body", async () => {
  const fetch = mockFetch(() => jsonResponse({ success: true, result: { id: "rr-1", version: 4 } }));
  const client = new FundflowClient(fundflowOptions(fetch));

  await client.rampRequests.approve("rr-1", { version: 3 });
  const call = fetch.apiCalls()[0];
  assert.match(call.url, /\/v1\/ramp-requests\/rr-1\/approve$/);
  assert.deepEqual(JSON.parse(call.init.body), { version: 3 });
});
