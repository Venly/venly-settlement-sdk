import { test } from "node:test";
import assert from "node:assert/strict";
import { makeHarness, callToolJson } from "./helpers.ts";

const CREDS = { VENLY_CLIENT_ID: "id", VENLY_CLIENT_SECRET: "secret" };

test("builder write tools enumerate on the existing MCP server", async () => {
  const h = await makeHarness({});
  const { tools } = await h.client.listTools();
  const names = tools.map((tool) => tool.name);
  for (const name of [
    "create_party",
    "create_account",
    "create_virtual_bank_account",
    "create_fiat_transfer",
    "create_crypto_transfer",
  ]) {
    assert.ok(names.includes(name), `missing builder write tool ${name}`);
  }
  assert.equal(tools.length, 24);
  await h.close();
});

test("create_party executes a synthetic organisation in explicit mock mode", async () => {
  const h = await makeHarness({ VENLY_ENV: "mock" });
  const { data } = await callToolJson(h.client, "create_party", {
    partyType: "ORGANISATION",
    externalId: "merchant-42",
    name: "Acme Europe",
    vatNumber: "BE0123456789",
  });

  assert.equal(data.mode, "mock");
  assert.equal(data.result.id, "party-created-1");
  assert.equal(h.mock.called("createParty"), true);
  await h.close();
});

test("create_party rejects an organisation without a name", async () => {
  const h = await makeHarness({ VENLY_ENV: "mock" });
  const result = await callToolJson(h.client, "create_party", {
    partyType: "ORGANISATION",
  });
  assert.equal(result.isError, true);
  assert.equal(h.mock.called("createParty"), false);
  await h.close();
});

test("create_account provisions the account through the mock client", async () => {
  const h = await makeHarness({ VENLY_ENV: "mock" });
  const { data } = await callToolJson(h.client, "create_account", {
    externalId: "merchant-42-main",
    name: "Acme Main",
    chain: "BASE",
    partyId: "party-created-1",
  });
  assert.equal(data.mode, "mock");
  assert.equal(data.result.id, "account-created-1");
  assert.equal(h.mock.called("createAccount"), true);
  await h.close();
});

test("create_virtual_bank_account preserves KYC boundary in dry-run output", async () => {
  const h = await makeHarness({ VENLY_ENV: "staging" });
  const { data } = await callToolJson(h.client, "create_virtual_bank_account", {
    accountId: "acct-1",
    name: "EUR Receipts",
    inCurrency: "EUR",
    targetCryptocurrency: "USDC",
  });
  assert.equal(data.mode, "dry-run");
  assert.equal(data.body.inCurrency, "EUR");
  assert.ok(data.body.idempotencyKey);
  assert.match(data.note, /KYC.*VERIFIED/i);
  assert.equal(h.mock.called("createVirtualBankAccount"), false);
  await h.close();
});

test("current fiat and crypto transfer tools use OpenAPI field names", async () => {
  const h = await makeHarness({ VENLY_ENV: "mock" });
  const fiat = await callToolJson(h.client, "create_fiat_transfer", {
    senderAccountId: "acct-1",
    receiverAccountId: "acct-2",
    currency: "EUR",
    amount: 25.5,
    idempotencyKey: "fiat-42",
  });
  const crypto = await callToolJson(h.client, "create_crypto_transfer", {
    senderAccountId: "acct-1",
    receiverAccountId: "acct-2",
    chain: "BASE",
    asset: "USDC",
    amount: 10,
    idempotencyKey: "crypto-42",
  });

  assert.equal(fiat.data.mode, "mock");
  assert.equal(crypto.data.mode, "mock");
  assert.equal(h.mock.called("createFiatTransfer"), true);
  assert.equal(h.mock.called("createCryptoTransfer"), true);
  await h.close();
});

// ---------------------------------------------------------------------------
// Fail-closed matrix. A write tool executes live ONLY when confirm===true AND
// VENLY_MCP_LIVE==="1" AND credentials present. Any missing leg => dry-run and
// NO live client call.
// ---------------------------------------------------------------------------

test("approve_ramp_request: confirm:true, armed flag, but NO creds => dry-run", async () => {
  const h = await makeHarness({ VENLY_ENV: "staging", VENLY_MCP_LIVE: "1" }); // flag armed, creds missing
  const { data } = await callToolJson(h.client, "approve_ramp_request", {
    id: "rr-1",
    version: 3,
    confirm: true,
  });
  assert.equal(data.mode, "dry-run");
  assert.equal(data.gate.armed, false);
  assert.equal(data.gate.credentialsPresent, false);
  assert.equal(data.body.version, 3);
  assert.equal(h.mock.called("approveRampRequest"), false);
  await h.close();
});

test("reject_ramp_request dry-run shape", async () => {
  const h = await makeHarness({ VENLY_ENV: "staging" });
  const { data } = await callToolJson(h.client, "reject_ramp_request", {
    id: "rr-9",
    version: 2,
    confirm: true,
  });
  assert.equal(data.mode, "dry-run");
  assert.equal(data.path, "/v1/ramp-requests/rr-9/reject");
  assert.equal(data.api, "fundflow");
  assert.equal(h.mock.called("rejectRampRequest"), false);
  await h.close();
});

test("create_payment_session dry-run shape", async () => {
  const h = await makeHarness({ VENLY_ENV: "staging" });
  const { data } = await callToolJson(h.client, "create_payment_session", {
    accountId: "acct-1",
    inAmount: "250.00",
    inCurrency: "EUR",
    outCryptocurrency: "USDC",
    callbackUrl: "https://example.com/webhooks/pay-in",
  });
  assert.equal(data.mode, "dry-run");
  assert.equal(data.path, "/accounts/acct-1/fiat-to-crypto/payment-sessions");
  assert.equal(data.body.inAmount, "250.00");
  assert.ok(data.body.idempotencyKey, "idempotencyKey auto-generated in the staged body");
  assert.equal(h.mock.called("createPayInSession"), false);
  await h.close();
});

// Positive control: only when ALL THREE legs hold does the tool go live.
// This proves the gate opens correctly, so the fail-closed tests above are
// meaningful (not just a tool that never calls the client).