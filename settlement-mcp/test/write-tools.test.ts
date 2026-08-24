import { test } from "node:test";
import assert from "node:assert/strict";
import { makeHarness, callToolJson } from "./helpers.ts";

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
  assert.equal(tools.length, 35);
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

test("create_virtual_bank_account executes in explicit mock mode", async () => {
  const h = await makeHarness({ VENLY_ENV: "mock" });
  const { data } = await callToolJson(h.client, "create_virtual_bank_account", {
    accountId: "acct-1",
    name: "EUR Receipts",
    inCurrency: "EUR",
    targetCryptocurrency: "USDC",
  });
  assert.equal(data.mode, "mock");
  assert.equal(data.dryRun, false);
  assert.equal(h.mock.called("createVirtualBankAccount"), true);
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
// The sandbox boundary itself (refusal per tool, credential-shaped params,
// mock end-to-end) is proven in test/sandbox-boundary.test.ts. The tests here
// prove the mock executions and wire shapes.
// ---------------------------------------------------------------------------

test("approve_ramp_request executes in explicit mock mode", async () => {
  const h = await makeHarness({ VENLY_ENV: "mock" });
  const { data } = await callToolJson(h.client, "approve_ramp_request", {
    id: "rr-1",
    version: 3,
  });
  assert.equal(data.mode, "mock");
  assert.equal(data.dryRun, false);
  assert.equal(h.mock.called("approveRampRequest"), true);
  await h.close();
});

test("reject_ramp_request executes in explicit mock mode", async () => {
  const h = await makeHarness({ VENLY_ENV: "mock" });
  const { data } = await callToolJson(h.client, "reject_ramp_request", {
    id: "rr-9",
    version: 2,
  });
  assert.equal(data.mode, "mock");
  assert.equal(h.mock.called("rejectRampRequest"), true);
  await h.close();
});

test("create_payment_session executes in explicit mock mode", async () => {
  const h = await makeHarness({ VENLY_ENV: "mock" });
  const { data } = await callToolJson(h.client, "create_payment_session", {
    accountId: "acct-1",
    inAmount: "250.00",
    inCurrency: "EUR",
    outCryptocurrency: "USDC",
    callbackUrl: "https://example.com/webhooks/pay-in",
  });
  assert.equal(data.mode, "mock");
  assert.equal(h.mock.called("createPayInSession"), true);
  await h.close();
});

// ── Payout surface (contract 1.3.0) ────────────────────────────────────────

test("payout write tools enumerate", async () => {
  const h = await makeHarness({});
  const { tools } = await h.client.listTools();
  const names = tools.map((tool) => tool.name);
  for (const name of [
    "register_payout_bank_account",
    "create_payout_route",
    "prepare_payout_ownership_proof",
    "complete_payout_ownership_proof",
    "request_payout",
  ]) {
    assert.ok(names.includes(name), `missing payout write tool ${name}`);
  }
  await h.close();
});

test("request_payout executes in explicit mock mode", async () => {
  const h = await makeHarness({ VENLY_ENV: "mock" });
  const { data } = await callToolJson(h.client, "request_payout", {
    accountId: "acct-1",
    payoutRouteId: "route-1",
    cryptoAmount: 100,
    confirm: true,
  });
  assert.equal(data.mode, "mock");
  assert.equal(data.dryRun, false);
  assert.equal(data.result.status, "REQUESTED");
  assert.equal(h.mock.called("requestPayout"), true);
  await h.close();
});

test("register_payout_bank_account nests rail details into the wire body", async () => {
  const h = await makeHarness({ VENLY_ENV: "mock" });
  const { data } = await callToolJson(h.client, "register_payout_bank_account", {
    partyId: "party-1",
    rail: "SEPA",
    fiatCurrency: "EUR",
    accountHolderName: "Supplier GmbH",
    iban: "DE89370400440532013999",
    bic: "DEUTDEDBFRA",
  });
  assert.equal(data.mode, "mock");
  assert.equal(h.mock.called("registerPayoutBankAccount"), true);
  const body = h.mock.lastBody.registerPayoutBankAccount as {
    rail: string;
    railDetails: { iban?: string };
  };
  assert.equal(body.rail, "SEPA");
  assert.equal(body.railDetails.iban, "DE89370400440532013999");
  await h.close();
});

test("prepare_decision writes the draft via the client's mock surface and returns it", async () => {
  const h = await makeHarness({ VENLY_ENV: "mock" });
  const { data } = await callToolJson(h.client, "prepare_decision", {
    recordType: "payout_exception",
    recordId: "payout-9",
    proposal: "Confirm completion",
    reason: "Provider statement shows the fiat leg settled.",
    evidenceRefs: ["payout.status", "payout.sendTxHash"],
  });
  assert.equal(data.mode, "mock");
  assert.equal(data.dryRun, false);
  assert.equal(data.result.status, "PREPARED");
  assert.deepEqual(data.result.evidenceRefs, ["payout.status", "payout.sendTxHash"]);
  assert.equal(h.mock.called("prepareDecision"), true);
  const input = h.mock.lastBody.prepareDecision as { recordType: string; recordId: string };
  assert.equal(input.recordType, "payout_exception");
  assert.equal(input.recordId, "payout-9");
  await h.close();
});

test("create_payout_route builds the depositAsset object from chain + asset", async () => {
  const h = await makeHarness({ VENLY_ENV: "mock" });
  const { data } = await callToolJson(h.client, "create_payout_route", {
    accountId: "acct-1",
    payoutBankAccountId: "pba-1",
    chain: "BASE",
    asset: "USDC",
    confirm: true,
  });
  assert.equal(data.result.status, "AWAITING_OWNERSHIP_PROOF");
  assert.equal(data.result.depositAsset.chain, "BASE");
  assert.equal(h.mock.called("createPayoutRoute"), true);
  await h.close();
});
