/**
 * The core safety property, proven per tool: every write/prepare tool refuses
 * any non-mock base URL and any credential-shaped parameter, fail closed at
 * tool level. Plus the positive control - a mock-mode session executing the
 * full journey end to end against the REAL sdk mock (no test double), zero
 * network, zero credentials.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server.js";
import { SdkVenlyClient } from "../src/client/sdk-client.js";
import { findCredentialShapedParam, checkSandboxBoundary } from "../src/safety.js";
import { makeHarness, callToolJson } from "./helpers.ts";

/** Every write/prepare tool with a minimal valid argument set. */
const WRITE_PREPARE_CALLS: Record<string, Record<string, unknown>> = {
  create_party: { partyType: "ORGANISATION", name: "Acme Europe" },
  create_account: { externalId: "acct-x", chain: "BASE", partyId: "party-1" },
  create_virtual_bank_account: {
    accountId: "acct-1",
    name: "EUR Receipts",
    inCurrency: "EUR",
    targetCryptocurrency: "USDC",
  },
  create_fiat_transfer: {
    senderAccountId: "acct-1",
    receiverAccountId: "acct-2",
    currency: "EUR",
    amount: 25,
  },
  create_crypto_transfer: {
    senderAccountId: "acct-1",
    receiverAccountId: "acct-2",
    chain: "BASE",
    asset: "USDC",
    amount: 10,
  },
  approve_ramp_request: { id: "rr-1", version: 1 },
  reject_ramp_request: { id: "rr-1", version: 1 },
  create_payment_session: {
    accountId: "acct-1",
    inAmount: "250.00",
    inCurrency: "EUR",
    outCryptocurrency: "USDC",
    callbackUrl: "https://example.com/webhooks/pay-in",
  },
  register_payout_bank_account: {
    partyId: "party-1",
    rail: "SEPA",
    fiatCurrency: "EUR",
    accountHolderName: "Supplier GmbH",
    iban: "DE89370400440532013000",
    bic: "DEUTDEDBFRA",
  },
  create_payout_route: {
    accountId: "acct-1",
    payoutBankAccountId: "pba-1",
    chain: "BASE",
    asset: "USDC",
  },
  prepare_payout_ownership_proof: { accountId: "acct-1", routeId: "route-1" },
  complete_payout_ownership_proof: {
    accountId: "acct-1",
    routeId: "route-1",
    message: "sign me",
    signature: "0xsigned",
  },
  request_payout: { accountId: "acct-1", payoutRouteId: "route-1", cryptoAmount: 10 },
  prepare_decision: {
    recordType: "verification",
    recordId: "acct-1",
    proposal: "Approve verification",
    reason: "Evidence complete.",
  },
  quote_x402_payment: { action: "stage_transfer", amount: "1.50", payTo: "0xabc" },
};

// ── Rule 1, one test per tool: a non-mock base URL is refused ───────────────

for (const [tool, args] of Object.entries(WRITE_PREPARE_CALLS)) {
  test(`${tool} refuses a non-mock base URL (staging), even confirmed and credentialled`, async () => {
    const h = await makeHarness({
      VENLY_ENV: "staging",
      VENLY_CLIENT_ID: "id",
      VENLY_CLIENT_SECRET: "secret",
    });
    const result = await callToolJson(h.client, tool, { ...args, confirm: true });
    assert.equal(result.isError, true, `${tool} must refuse, not execute or preview`);
    const text = String(result.raw.content?.[0]?.text ?? "");
    assert.match(text, /mock sandbox/i, "the refusal states the sandbox boundary");
    assert.match(text, /No request was sent/i, "the refusal states nothing was sent");
    assert.equal(h.mock.calls.length, 0, `${tool} must not touch the client when refusing`);
    await h.close();
  });
}

test("production is refused the same way", async () => {
  const h = await makeHarness({ VENLY_ENV: "production" });
  const result = await callToolJson(h.client, "create_party", {
    partyType: "ORGANISATION",
    name: "Acme",
  });
  assert.equal(result.isError, true);
  assert.match(String(result.raw.content?.[0]?.text ?? ""), /production/);
  assert.equal(h.mock.calls.length, 0);
  await h.close();
});

test("a base-URL override in mock mode is refused as an ambiguous target", async () => {
  const h = await makeHarness({
    VENLY_ENV: "mock",
    VENLY_FINANCE_BASE_URL: "https://api.venlyfinance.com/v1",
  });
  const result = await callToolJson(h.client, "create_party", {
    partyType: "ORGANISATION",
    name: "Acme",
  });
  assert.equal(result.isError, true);
  assert.match(String(result.raw.content?.[0]?.text ?? ""), /VENLY_FINANCE_BASE_URL/);
  assert.equal(h.mock.calls.length, 0);
  await h.close();
});

test("an unrecognised VENLY_ENV fails closed", () => {
  const refusal = checkSandboxBoundary("create_party", { VENLY_ENV: "prod" });
  assert.ok(refusal);
  assert.equal(refusal.rule, "non-mock-base-url");
});

// ── Rule 2: credential-shaped parameters are refused outright ───────────────

test("a Bearer-shaped value is refused in mock mode too", async () => {
  const h = await makeHarness({ VENLY_ENV: "mock" });
  const result = await callToolJson(h.client, "create_fiat_transfer", {
    senderAccountId: "acct-1",
    receiverAccountId: "acct-2",
    currency: "EUR",
    amount: 25,
    description: "Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature",
  });
  assert.equal(result.isError, true);
  assert.match(String(result.raw.content?.[0]?.text ?? ""), /credential/i);
  assert.equal(h.mock.calls.length, 0);
  await h.close();
});

test("a JWT-shaped value is refused", async () => {
  const h = await makeHarness({ VENLY_ENV: "mock" });
  const result = await callToolJson(h.client, "create_party", {
    partyType: "ORGANISATION",
    name: "Acme",
    externalId: "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0In0.c2lnbmF0dXJl",
  });
  assert.equal(result.isError, true);
  assert.match(String(result.raw.content?.[0]?.text ?? ""), /credential/i);
  assert.equal(h.mock.calls.length, 0);
  await h.close();
});

test("the credential scan matches key names and value shapes, not legitimate params", () => {
  // Key names, whatever the casing or separator.
  assert.ok(findCredentialShapedParam({ client_secret: "x" }));
  assert.ok(findCredentialShapedParam({ clientSecret: "x" }));
  assert.ok(findCredentialShapedParam({ apiKey: "x" }));
  assert.ok(findCredentialShapedParam({ accessToken: "x" }));
  assert.ok(findCredentialShapedParam({ password: "x" }));
  assert.ok(findCredentialShapedParam({ nested: { privateKey: "x" } }));
  // Value shapes.
  assert.ok(findCredentialShapedParam({ description: "Bearer abc123" }));
  assert.ok(
    findCredentialShapedParam({
      note: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl",
    }),
  );
  assert.ok(findCredentialShapedParam({ key: "sk_live_abcdefgh1234" }));
  assert.ok(
    findCredentialShapedParam({
      pem: "-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----",
    }),
  );
  // Raw-key shapes: 0x + 64 hex is a private key unless the key names a hash
  // (transaction hashes are the one legitimate carrier of that shape).
  assert.ok(findCredentialShapedParam({ signerKey: "0x" + "ab".repeat(32) }));
  assert.ok(findCredentialShapedParam({ signing_key: "0x" + "ab".repeat(32) }));
  assert.ok(findCredentialShapedParam({ walletMnemonic: "abandon ability able about" }));
  assert.equal(findCredentialShapedParam({ blockchainTransactionHash: "0x" + "ab".repeat(32) }), null);
  // Legitimate parameters never trip it.
  assert.equal(findCredentialShapedParam(WRITE_PREPARE_CALLS.register_payout_bank_account), null);
  assert.equal(findCredentialShapedParam({ idempotencyKey: crypto.randomUUID() }), null);
  assert.equal(findCredentialShapedParam({ referenceCode: "REF-ABC-123" }), null);
  // A 65-byte ECDSA signature (130 hex) is not private-key shaped.
  assert.equal(findCredentialShapedParam({ signature: "0x" + "ab".repeat(65) }), null);
  assert.equal(findCredentialShapedParam({ payTo: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" }), null);
});

// ── Positive control: a mock-mode session works end to end ──────────────────

test("integration: a mock-mode session runs the journey end to end on the real sdk mock", async () => {
  const client = SdkVenlyClient.mock();
  const server = createServer({ client, env: { VENLY_ENV: "mock" } });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcp = new Client({ name: "sandbox-e2e", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), mcp.connect(clientTransport)]);
  try {
    const party = await callToolJson(mcp, "create_party", {
      partyType: "ORGANISATION",
      name: "Sandbox E2E B.V.",
    });
    assert.equal(party.isError, false);
    assert.equal(party.data.mode, "mock");
    const partyId = party.data.result.id as string;
    assert.ok(partyId);

    const account = await callToolJson(mcp, "create_account", {
      externalId: "sandbox-e2e-main",
      name: "Sandbox E2E Main",
      chain: "BASE",
      partyId,
    });
    assert.equal(account.isError, false);
    const accountId = account.data.result.id as string;
    assert.ok(accountId);

    // Transfer between two seeded funded accounts, so the ledger moves.
    const transfer = await callToolJson(mcp, "create_fiat_transfer", {
      senderAccountId: "a10c2d31-2222-4b20-8c63-000000000001",
      receiverAccountId: "a10c2d31-2222-4b20-8c63-000000000002",
      currency: "EUR",
      amount: 25,
      merchantReference: "sandbox-e2e-1",
    });
    assert.equal(transfer.isError, false);
    assert.equal(transfer.data.dryRun, false);
    assert.equal(transfer.data.result.status, "PENDING");

    const listed = await callToolJson(mcp, "list_transfers", {
      accountId: "a10c2d31-2222-4b20-8c63-000000000001",
    });
    assert.equal(listed.isError, false);
    const found = (listed.data.transfers ?? listed.data.items ?? []).some(
      (t: { merchantReference?: string }) => t.merchantReference === "sandbox-e2e-1",
    );
    assert.ok(found, "the executed transfer is readable back through the read tier");

    const quote = await callToolJson(mcp, "quote_x402_payment", {
      action: "stage_transfer",
      amount: "1.50",
      payTo: "0xabc",
    });
    assert.equal(quote.isError, false);
    assert.equal(quote.data.httpStatus, 402);

    // Prepare a decision draft on the account whose verification is pending
    // in the seeds - the maker half of maker/checker, applied to nothing.
    const draft = await callToolJson(mcp, "prepare_decision", {
      recordType: "verification",
      recordId: "a10c2d31-2222-4b20-8c63-000000000004",
      proposal: "Approve verification",
      reason: "Screening completed; register entry matches the applicant.",
      evidenceRefs: ["account.kycStatus"],
    });
    assert.equal(draft.isError, false);
    assert.equal(draft.data.result.status, "PREPARED");
    assert.ok(draft.data.result.preparedAt);
    const pending = await callToolJson(mcp, "get_account", {
      accountId: "a10c2d31-2222-4b20-8c63-000000000004",
    });
    assert.equal(
      pending.data.kycStatus ?? pending.data.result?.kycStatus,
      "VERIFICATION_PENDING",
      "the draft applied nothing - the record is untouched",
    );
  } finally {
    await mcp.close();
    await server.close();
  }
});
