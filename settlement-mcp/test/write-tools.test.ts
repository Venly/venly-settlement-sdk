import { test } from "node:test";
import assert from "node:assert/strict";
import { makeHarness, callToolJson } from "./helpers.ts";

const CREDS = { VENLY_CLIENT_ID: "id", VENLY_CLIENT_SECRET: "secret" };

// ---------------------------------------------------------------------------
// Fail-closed matrix. A write tool executes live ONLY when confirm===true AND
// VENLY_MCP_LIVE==="1" AND credentials present. Any missing leg => dry-run and
// NO live client call.
// ---------------------------------------------------------------------------

test("stage_transfer: unconfirmed + disarmed => dry-run, no live call", async () => {
  const h = await makeHarness({}); // no live flag, no creds
  const { data } = await callToolJson(h.client, "stage_transfer", {
    senderAccountId: "acct-1",
    receiverAccountId: "acct-2",
    fiatAmount: "1000.00",
    fiatCurrency: "EUR",
    // confirm omitted -> false
  });
  assert.equal(data.mode, "dry-run");
  assert.equal(data.method, "POST");
  assert.equal(data.api, "finance");
  assert.equal(data.path, "/accounts/acct-1/transfers/fiat");
  assert.equal(data.body.receiverAccountId, "acct-2");
  assert.equal(data.body.fiatAmount, "1000.00");
  assert.equal(h.mock.called("createFiatTransfer"), false, "must NOT call live client");
  await h.close();
});

test("stage_transfer rejects a non-numeric legacy fiatAmount before transport", async () => {
  const h = await makeHarness({ VENLY_ENV: "mock" });
  const result = await callToolJson(h.client, "stage_transfer", {
    senderAccountId: "acct-1",
    receiverAccountId: "acct-2",
    fiatAmount: "not-an-amount",
    fiatCurrency: "EUR",
  });

  assert.equal(result.isError, true);
  assert.equal(h.mock.called("createFiatTransfer"), false);
  await h.close();
});

// CRITICAL fail-closed test required by spec acceptance criterion 4:
// confirm:true but VENLY_MCP_LIVE unset still dry-runs and does NOT call live.
test("CRITICAL: confirm:true but VENLY_MCP_LIVE unset still dry-runs (fail-closed)", async () => {
  const h = await makeHarness({ ...CREDS }); // creds present, but LIVE flag NOT set
  const { data } = await callToolJson(h.client, "stage_transfer", {
    senderAccountId: "acct-1",
    receiverAccountId: "acct-2",
    fiatAmount: "500.00",
    fiatCurrency: "EUR",
    confirm: true,
  });
  assert.equal(data.mode, "dry-run", "confirm alone must not arm the tool");
  assert.equal(data.gate.armed, false);
  assert.equal(data.gate.confirm, true);
  assert.equal(data.gate.liveFlagArmed, false);
  assert.ok(
    data.gate.blockedReasons.some((r: string) => r.includes("VENLY_MCP_LIVE")),
    "blocked reason should cite the missing live flag",
  );
  assert.equal(
    h.mock.called("createFiatTransfer"),
    false,
    "live client MUST NOT be called when VENLY_MCP_LIVE is unset",
  );
  await h.close();
});

test("approve_ramp_request: confirm:true, armed flag, but NO creds => dry-run", async () => {
  const h = await makeHarness({ VENLY_MCP_LIVE: "1" }); // flag armed, creds missing
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
  const h = await makeHarness({});
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
  const h = await makeHarness({});
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
test("gate opens only with confirm + VENLY_MCP_LIVE=1 + creds => live call", async () => {
  const h = await makeHarness({ VENLY_MCP_LIVE: "1", ...CREDS });
  const { data } = await callToolJson(h.client, "stage_transfer", {
    senderAccountId: "acct-1",
    receiverAccountId: "acct-2",
    fiatAmount: "10.00",
    fiatCurrency: "EUR",
    confirm: true,
  });
  assert.equal(data.mode, "live", "all three legs present should arm the tool");
  assert.equal(data.result.id, "transfer-live-1");
  assert.equal(h.mock.called("createFiatTransfer"), true);
  await h.close();
});

test("explicit mock mode executes simulated writes without flags or credentials", async () => {
  const h = await makeHarness({ VENLY_ENV: "mock" });
  const { data } = await callToolJson(h.client, "stage_transfer", {
    senderAccountId: "acct-1",
    receiverAccountId: "acct-2",
    fiatAmount: "10.00",
    fiatCurrency: "EUR",
  });

  assert.equal(data.mode, "mock");
  assert.equal(data.environment, "mock");
  assert.equal(data.result.id, "transfer-live-1");
  assert.equal(h.mock.called("createFiatTransfer"), true);
  await h.close();
});

test("production remains disarmed without the additional production flag", async () => {
  const h = await makeHarness({
    VENLY_ENV: "production",
    VENLY_MCP_LIVE: "1",
    ...CREDS,
  });
  const { data } = await callToolJson(h.client, "stage_transfer", {
    senderAccountId: "acct-1",
    receiverAccountId: "acct-2",
    fiatAmount: "10.00",
    fiatCurrency: "EUR",
    confirm: true,
  });

  assert.equal(data.mode, "dry-run");
  assert.equal(data.gate.environment, "production");
  assert.equal(data.gate.productionFlagArmed, false);
  assert.ok(
    data.gate.blockedReasons.some((reason: string) =>
      reason.includes("VENLY_MCP_PRODUCTION"),
    ),
  );
  assert.equal(h.mock.called("createFiatTransfer"), false);
  await h.close();
});

test("production opens only when ordinary and production gates are armed", async () => {
  const h = await makeHarness({
    VENLY_ENV: "production",
    VENLY_MCP_LIVE: "1",
    VENLY_MCP_PRODUCTION: "1",
    ...CREDS,
  });
  const { data } = await callToolJson(h.client, "stage_transfer", {
    senderAccountId: "acct-1",
    receiverAccountId: "acct-2",
    fiatAmount: "10.00",
    fiatCurrency: "EUR",
    confirm: true,
  });

  assert.equal(data.mode, "live");
  assert.equal(data.environment, "production");
  assert.equal(h.mock.called("createFiatTransfer"), true);
  await h.close();
});
