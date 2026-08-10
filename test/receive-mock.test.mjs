import test from "node:test";
import assert from "node:assert/strict";
import { VenlyFinanceClient } from "../dist/esm/index.js";

const client = () => new VenlyFinanceClient({ environment: "mock" });
const ids = {
  ops: "a10c2d31-2222-4b20-8c63-000000000002",
  treasury: "a10c2d31-2222-4b20-8c63-000000000003",
  payouts: "a10c2d31-2222-4b20-8c63-000000000005",
};

test("receive mock: browser fixtures cover incomplete, multi-account fallback, and closed", async () => {
  const finance = client();
  const incomplete = await finance.virtualBankAccounts.list(ids.ops);
  assert.equal(incomplete.items.length, 1);
  assert.equal(incomplete.items[0].status, "ACTIVE");
  assert.equal(incomplete.items[0].referenceCode, undefined);

  const multiple = await finance.virtualBankAccounts.list(ids.treasury);
  assert.equal(multiple.items.length, 3);
  assert.ok(multiple.items.some((item) => item.name === undefined && item.createdAt === undefined));
  assert.ok(multiple.items.some((item) => item.id === undefined && item.status === undefined));

  const closed = await finance.virtualBankAccounts.list(ids.payouts);
  assert.equal(closed.items.length, 1);
  assert.equal(closed.items[0].status, "CLOSED");
});

test("receive mock: provisioning requires an active verified account", async () => {
  const finance = client();
  await assert.rejects(
    () => finance.virtualBankAccounts.create("a10c2d31-2222-4b20-8c63-000000000004", {
      name: "Blocked",
      inCurrency: "EUR",
      targetCryptocurrency: "USDC",
      idempotencyKey: "blocked-create",
    }),
    (error) => error.status === 400 && error.errors[0].code === "invalid-request",
  );
});

test("receive mock: repeated create intent returns one provisioned account", async () => {
  const finance = client();
  const body = {
    name: "Idempotent EUR",
    inCurrency: "EUR",
    targetCryptocurrency: "USDC",
    idempotencyKey: "same-create-intent",
  };
  const first = await finance.virtualBankAccounts.create(ids.payouts, body);
  const second = await finance.virtualBankAccounts.create(ids.payouts, body);
  assert.equal(second.id, first.id);
  const listed = await finance.virtualBankAccounts.list(ids.payouts);
  assert.equal(listed.items.filter((item) => item.id === first.id).length, 1);
});

test("receive mock: changed input cannot reuse a successful create key", async () => {
  const finance = client();
  const body = {
    name: "First intent",
    inCurrency: "EUR",
    targetCryptocurrency: "USDC",
    idempotencyKey: "changed-create-intent",
  };
  await finance.virtualBankAccounts.create(ids.payouts, body);
  await assert.rejects(
    () => finance.virtualBankAccounts.create(ids.payouts, { ...body, name: "Changed intent" }),
    (error) => error.status === 422 && error.errors[0].code === "idempotency-conflict",
  );
});

test("receive mock: a failed create key cannot be replayed after eligibility changes", async () => {
  const finance = client();
  const accountId = "a10c2d31-2222-4b20-8c63-000000000007";
  const body = {
    name: "Initially blocked",
    inCurrency: "EUR",
    targetCryptocurrency: "USDC",
    idempotencyKey: "failed-create-intent",
  };
  await assert.rejects(
    () => finance.virtualBankAccounts.create(accountId, body),
    (error) => error.status === 400 && error.errors[0].code === "invalid-request",
  );
  finance.mock.advanceVerification(accountId, "VERIFIED");
  await assert.rejects(
    () => finance.virtualBankAccounts.create(accountId, body),
    (error) => error.status === 422 && error.errors[0].code === "idempotency-conflict",
  );
});
