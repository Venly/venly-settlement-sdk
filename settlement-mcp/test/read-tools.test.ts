import { test } from "node:test";
import assert from "node:assert/strict";
import { makeHarness, callToolJson } from "./helpers.ts";

test("server enumerates all read + write + x402 tools over the harness", async () => {
  const h = await makeHarness({});
  const { tools } = await h.client.listTools();
  const names = tools.map((t) => t.name).sort();

  // Read tier
  for (const t of [
    "list_ramp_requests",
    "get_ramp_request",
    "list_accounts",
    "get_account",
    "list_wallets",
    "list_virtual_bank_accounts",
    "get_virtual_bank_account",
    "reconcile_by_reference_code",
    "list_transfers",
    "get_transfer",
    "list_parties",
    "get_party",
    "get_reference_data",
  ]) {
    assert.ok(names.includes(t), `missing read tool ${t}`);
  }
  // Write tier
  for (const t of [
    "stage_transfer",
    "approve_ramp_request",
    "reject_ramp_request",
    "create_payment_session",
  ]) {
    assert.ok(names.includes(t), `missing write tool ${t}`);
  }
  // x402 tier
  assert.ok(names.includes("quote_x402_payment"), "missing x402 tool");

  assert.equal(tools.length, 25, "expected 25 tools total");
  await h.close();
});

test("list_ramp_requests returns shaped data", async () => {
  const h = await makeHarness({});
  const { data, isError } = await callToolJson(h.client, "list_ramp_requests", {
    status: "AWAITING_APPROVAL",
  });
  assert.equal(isError, false);
  assert.equal(data.count, 1);
  assert.equal(data.rampRequests[0].id, "rr-1");
  assert.equal(data.rampRequests[0].status, "AWAITING_APPROVAL");
  assert.ok(h.mock.called("listRampRequests"));
  await h.close();
});

test("get_ramp_request returns detail incl. optimistic-locking version", async () => {
  const h = await makeHarness({});
  const { data } = await callToolJson(h.client, "get_ramp_request", { id: "rr-1" });
  assert.equal(data.id, "rr-1");
  assert.equal(data.version, 3);
  assert.equal(data.status, "AWAITING_APPROVAL");
  await h.close();
});

test("get_account returns the account", async () => {
  const h = await makeHarness({});
  const { data } = await callToolJson(h.client, "get_account", { accountId: "acct-1" });
  assert.equal(data.id, "acct-1");
  assert.equal(data.status, "ACTIVE");
  await h.close();
});

test("list_accounts returns paginated account fixtures", async () => {
  const h = await makeHarness({});
  const { data } = await callToolJson(h.client, "list_accounts", { page: 1, size: 10 });
  assert.equal(data.count, 1);
  assert.equal(data.accounts[0].id, "acct-1");
  assert.ok(h.mock.called("listAccounts"));
  await h.close();
});

test("list_wallets exposes the account wallet", async () => {
  const h = await makeHarness({});
  const { data } = await callToolJson(h.client, "list_wallets", { accountId: "acct-1" });
  assert.equal(data.count, 1);
  assert.equal(data.wallets[0].id, "wallet-1");
  assert.equal(data.wallets[0].chain, "BASE");
  await h.close();
});

test("list_virtual_bank_accounts returns vIBANs with referenceCode", async () => {
  const h = await makeHarness({});
  const { data } = await callToolJson(h.client, "list_virtual_bank_accounts", {
    accountId: "acct-1",
  });
  assert.equal(data.count, 2);
  assert.equal(data.virtualBankAccounts[0].referenceCode, "REF-ABC-123");
  await h.close();
});

test("get_virtual_bank_account returns receiving details", async () => {
  const h = await makeHarness({});
  const { data } = await callToolJson(h.client, "get_virtual_bank_account", {
    accountId: "acct-1",
    virtualBankAccountId: "vban-1",
  });
  assert.equal(data.id, "vban-1");
  assert.equal(data.referenceCode, "REF-ABC-123");
  await h.close();
});

test("list_transfers returns transfer history", async () => {
  const h = await makeHarness({});
  const { data } = await callToolJson(h.client, "list_transfers", {
    accountId: "acct-1",
    page: 1,
    size: 10,
  });
  assert.equal(data.count, 1);
  assert.equal(data.transfers[0].id, "tr-1");
  await h.close();
});

test("get_transfer returns the transfer", async () => {
  const h = await makeHarness({});
  const { data } = await callToolJson(h.client, "get_transfer", {
    accountId: "acct-1",
    transferId: "tr-1",
  });
  assert.equal(data.id, "tr-1");
  assert.equal(data.status, "COMPLETED");
  await h.close();
});

test("list_parties returns parties", async () => {
  const h = await makeHarness({});
  const { data } = await callToolJson(h.client, "list_parties", {});
  assert.equal(data.count, 1);
  assert.equal(data.parties[0].partyType, "ORGANISATION");
  await h.close();
});

test("get_party returns KYC/KYB state", async () => {
  const h = await makeHarness({});
  const { data } = await callToolJson(h.client, "get_party", { partyId: "party-1" });
  assert.equal(data.id, "party-1");
  assert.equal(data.status, "ACTIVE");
  await h.close();
});

test("get_reference_data (all) returns chains, currencies and fees", async () => {
  const h = await makeHarness({});
  const { data } = await callToolJson(h.client, "get_reference_data", { dataset: "all" });
  assert.ok(Array.isArray(data.chains));
  assert.ok(Array.isArray(data.fiatCurrencies));
  assert.ok(Array.isArray(data.cryptocurrencies));
  assert.ok(data.fees);
  await h.close();
});
