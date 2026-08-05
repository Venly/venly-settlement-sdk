import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { SdkVenlyClient } from "../src/client/sdk-client.js";
import { createServer } from "../src/server.js";
import { callToolJson } from "./helpers.ts";

test("golden journey: official SDK mock builds an international account without network", async () => {
  const originalFetch = globalThis.fetch;
  let networkCalls = 0;
  globalThis.fetch = (async () => {
    networkCalls += 1;
    throw new Error("golden mock journey must not touch network");
  }) as typeof fetch;

  const sdkClient = SdkVenlyClient.mock();
  const server = createServer({ client: sdkClient, env: { VENLY_ENV: "mock" } });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "golden-journey", version: "0.0.0" });

  try {
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const party = await callToolJson(client, "create_party", {
      partyType: "ORGANISATION",
      externalId: "acme-global",
      name: "Acme Global",
    });
    const account = await callToolJson(client, "create_account", {
      externalId: "acme-global-main",
      name: "Acme Global Main",
      chain: "BASE",
      partyId: party.data.result.id,
    });
    const wallets = await callToolJson(client, "list_wallets", {
      accountId: account.data.result.id,
    });
    const receiving = await callToolJson(client, "create_virtual_bank_account", {
      accountId: account.data.result.id,
      name: "EUR Receipts",
      inCurrency: "EUR",
      targetCryptocurrency: "USDC",
      idempotencyKey: "golden-viban-1",
    });
    // The receiver must exist - the 0.2.0 SDK mock resolves external ids and
    // rejects transfers to nobody. "acct-ops-usd" is a seeded account.
    const transfer = await callToolJson(client, "create_fiat_transfer", {
      senderAccountId: account.data.result.id,
      receiverExternalId: "acct-ops-usd",
      currency: "EUR",
      amount: 250,
      description: "Invoice 42",
      idempotencyKey: "golden-transfer-1",
    });
    const history = await callToolJson(client, "list_transfers", {
      accountId: account.data.result.id,
    });

    for (const mutation of [party, account, receiving, transfer]) {
      assert.equal(mutation.data.mode, "mock");
      assert.equal(mutation.data.dryRun, false, "mock writes execute; dryRun is explicit");
      assert.equal(mutation.data.environment, "mock");
    }
    assert.equal(wallets.data.wallets[0].chain, "BASE");
    // A freshly provisioned wallet honestly holds nothing.
    assert.deepEqual(wallets.data.wallets[0].balances, []);
    // Creation starts KYB; it does not complete it (0.2.0 mock fidelity).
    assert.equal(party.data.result.kybStatus, "PENDING");
    assert.equal(account.data.result.kycStatus, "VERIFICATION_PENDING");
    assert.equal(transfer.data.result.status, "PENDING");
    assert.equal(receiving.data.result.currency, "EUR");
    assert.equal(receiving.data.result.targetCryptocurrency, "USDC");
    assert.ok(history.data.count > 0);
    assert.equal(networkCalls, 0);
  } finally {
    await client.close();
    await server.close();
    globalThis.fetch = originalFetch;
  }
});
