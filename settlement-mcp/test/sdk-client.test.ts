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
  assert.equal(typeof transferCall.body, "object");
  assert.notEqual(transferCall.body, null);
  const transferBody = transferCall.body as Record<string, unknown>;
  assert.deepEqual(transferBody, {
    receiverAccountId: "account-002",
    currency: "EUR",
    amount: 25.5,
    description: "Invoice 42",
    merchantReference: "INV-42",
    idempotencyKey: transferBody.idempotencyKey,
  });
  assert.match(String(transferBody.idempotencyKey), /^[0-9a-f-]{36}$/i);
  assert.equal("fiatAmount" in transferBody, false);
  assert.equal("fiatCurrency" in transferBody, false);
});

test("SDK client: legacy normalization preserves a caller-supplied idempotency key", async () => {
  const client = SdkVenlyClient.mock();

  await client.createFiatTransfer("account-001", {
    receiverAccountId: "account-002",
    fiatAmount: "10.00",
    fiatCurrency: "EUR",
    idempotencyKey: "legacy-key-42",
  });

  const transferCall = client.financeMockCalls.find(
    (call) => call.method === "POST" && call.path.endsWith("/transfers/fiat"),
  );
  assert.ok(transferCall);
  assert.equal(
    (transferCall.body as Record<string, unknown>).idempotencyKey,
    "legacy-key-42",
  );
});

test("SDK client: legacy normalization rejects the retired cryptocurrency field", async () => {
  const client = SdkVenlyClient.mock();

  await assert.rejects(
    client.createFiatTransfer("account-001", {
      receiverAccountId: "account-002",
      fiatAmount: "10.00",
      fiatCurrency: "EUR",
      cryptocurrency: "USDC",
    }),
    /not part of the current fiat-transfer contract/,
  );
  assert.equal(
    client.financeMockCalls.some((call) => call.path.endsWith("/transfers/fiat")),
    false,
    "no request may be staged when normalization rejects the input",
  );
});

test("SDK client: existing approval and payment-session writes map to SDK resources", async () => {
  const client = SdkVenlyClient.mock();

  await client.approveRampRequest("ramp-001", { version: 3 });
  await client.rejectRampRequest("ramp-002", { version: 4 });
  await client.createPayInSession("account-001", {
    inAmount: "100.00",
    inCurrency: "EUR",
    outCryptocurrency: "USDC",
    callbackUrl: "https://example.com/callback",
    idempotencyKey: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  });

  assert.ok(
    client.fundflowMockCalls.some(
      (call) => call.method === "POST" && call.path === "/v1/ramp-requests/ramp-001/approve",
    ),
  );
  assert.ok(
    client.fundflowMockCalls.some(
      (call) => call.method === "POST" && call.path === "/v1/ramp-requests/ramp-002/reject",
    ),
  );
  assert.ok(
    client.financeMockCalls.some(
      (call) =>
        call.method === "POST" &&
        call.path === "/accounts/account-001/fiat-to-crypto/payment-sessions",
    ),
  );
});

test("SDK client: missing live credentials fail before any network request", async () => {
  const originalFetch = globalThis.fetch;
  let networkCalls = 0;
  globalThis.fetch = (async () => {
    networkCalls += 1;
    throw new Error("network must not be called without credentials");
  }) as typeof fetch;

  try {
    const client = SdkVenlyClient.fromEnv({ VENLY_ENV: "staging" });
    await assert.rejects(
      client.listParties(),
      /Missing Venly credentials. Set VENLY_CLIENT_ID and VENLY_CLIENT_SECRET/,
    );
    assert.equal(networkCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("SDK client: builder operations map to current Finance SDK routes", async () => {
  const client = SdkVenlyClient.mock();

  await client.listAccounts();
  await client.listWallets("account-001");
  await client.getVirtualBankAccount("account-001", "vba-001");
  await client.listTransfers("account-001");
  await client.getParty("party-001");
  await client.createParty({ partyType: "ORGANISATION", name: "Acme" });
  await client.createAccount({
    externalId: "acme-main",
    chain: "BASE",
    partyId: "party-001",
  });
  await client.createVirtualBankAccount("account-001", {
    name: "EUR Receipts",
    inCurrency: "EUR",
    targetCryptocurrency: "USDC",
    idempotencyKey: "vba-001",
  });
  await client.createCurrentFiatTransfer("account-001", {
    receiverAccountId: "account-002",
    currency: "EUR",
    amount: 25,
    idempotencyKey: "fiat-001",
  });
  await client.createCryptoTransfer("account-001", {
    receiverAccountId: "account-002",
    chain: "BASE",
    asset: "USDC",
    amount: 10,
    idempotencyKey: "crypto-001",
  });

  for (const expected of [
    "GET /accounts",
    "GET /accounts/account-001/wallets",
    "GET /accounts/account-001/virtual-bank-accounts/vba-001",
    "GET /accounts/account-001/transfers",
    "GET /parties/party-001",
    "POST /parties",
    "POST /accounts",
    "POST /accounts/account-001/virtual-bank-accounts",
    "POST /accounts/account-001/transfers/fiat",
    "POST /accounts/account-001/transfers/crypto",
  ]) {
    const [method, path] = expected.split(" ");
    assert.ok(
      client.financeMockCalls.some((call) => call.method === method && call.path === path),
      `missing SDK call ${expected}`,
    );
  }
});
