import { test } from "node:test";
import assert from "node:assert/strict";
import { makeHarness, callToolJson } from "./helpers.ts";

test("quote_x402_payment returns a 402-shaped quote", async () => {
  const h = await makeHarness({});
  const { data, isError } = await callToolJson(h.client, "quote_x402_payment", {
    action: "stage_transfer",
    amount: "1.50",
    asset: "USDC",
    chain: "base",
    payTo: "0x000000000000000000000000000000000000dEaD",
  });
  assert.equal(isError, false);
  assert.equal(data.mode, "stub");
  assert.equal(data.httpStatus, 402);
  assert.equal(data.error, "payment_required");
  assert.equal(data.x402Version, 1);
  assert.ok(Array.isArray(data.accepts) && data.accepts.length === 1);
  const opt = data.accepts[0];
  assert.equal(opt.scheme, "exact");
  assert.equal(opt.network, "base");
  assert.equal(opt.asset, "USDC");
  assert.equal(opt.maxAmountRequired, "1.50");
  assert.equal(opt.payTo, "0x000000000000000000000000000000000000dEaD");
  assert.ok(opt.assetAddress, "USDC asset address should be filled for base");
  await h.close();
});

test("quote_x402_payment defaults asset=USDC and chain=base", async () => {
  const h = await makeHarness({});
  const { data } = await callToolJson(h.client, "quote_x402_payment", {
    action: "reconcile",
    amount: "0.10",
    payTo: "0xabc",
  });
  assert.equal(data.accepts[0].network, "base");
  assert.equal(data.accepts[0].asset, "USDC");
  await h.close();
});

test("quote_x402_payment never executes: mode is always stub", async () => {
  const h = await makeHarness({ VENLY_MCP_LIVE: "1", VENLY_CLIENT_ID: "id", VENLY_CLIENT_SECRET: "s" });
  const { data } = await callToolJson(h.client, "quote_x402_payment", {
    action: "stage_transfer",
    amount: "999.00",
    payTo: "0xabc",
    chain: "polygon",
  });
  // Even with the live flag armed, x402 is a stub and never settles.
  assert.equal(data.mode, "stub");
  assert.equal(data.accepts[0].network, "polygon");
  await h.close();
});
