import assert from "node:assert/strict";
import test from "node:test";
import { SdkVenlyClient } from "../src/client/sdk-client.js";

test("SDK client: mock mode executes Finance and Fundflow reads without network", async () => {
  const originalFetch = globalThis.fetch;
  let networkCalls = 0;
  globalThis.fetch = (async () => {
    networkCalls += 1;
    throw new Error("network must not be called in mock mode");
  }) as typeof fetch;

  try {
    const client = SdkVenlyClient.mock();

    const parties = await client.listParties();
    const account = await client.getAccount("account-001");
    const virtualBankAccounts = await client.listVirtualBankAccounts("account-001");
    const rampRequests = await client.listRampRequests();
    const chains = await client.getSupportedChains();

    assert.ok(parties.length > 0);
    assert.equal(account.id, "account-001");
    assert.ok(virtualBankAccounts.length > 0);
    assert.ok(rampRequests.length > 0);
    assert.ok(chains.length > 0);
    assert.equal(networkCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("SDK client: legacy stage-transfer input is normalized to the live SDK contract", async () => {
  const client = SdkVenlyClient.mock();

  await client.createFiatTransfer("account-001", {
    receiverAccountId: "account-002",
    fiatAmount: "25.50",
    fiatCurrency: "EUR",
    description: "Invoice 42",
    merchantReference: "INV-42",
  });

  const transferCall = client.financeMockCalls.find(
    (call) => call.method === "POST" && call.path.endsWith("/transfers/fiat"),
  );

  assert.ok(transferCall);
  assert.deepEqual(transferCall.body, {
    receiverAccountId: "account-002",
    currency: "EUR",
    amount: 25.5,
    description: "Invoice 42",
    merchantReference: "INV-42",
    idempotencyKey: transferCall.body?.idempotencyKey,
  });
  assert.match(String(transferCall.body?.idempotencyKey), /^[0-9a-f-]{36}$/i);
  assert.equal("fiatAmount" in (transferCall.body ?? {}), false);
  assert.equal("fiatCurrency" in (transferCall.body ?? {}), false);
});

