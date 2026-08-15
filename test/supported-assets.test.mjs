// Supported-assets contract tests: the decimals surface UIs render money from.
import test from "node:test";
import assert from "node:assert/strict";
import { VenlyFinanceClient, VenlyApiError } from "../dist/esm/index.js";

const mockFinance = () => new VenlyFinanceClient({ environment: "mock" });

const ACCT_MAIN = "a10c2d31-2222-4b20-8c63-000000000001";
const ACCT_OPS = "a10c2d31-2222-4b20-8c63-000000000002"; // has a wallet, not seeded here
const ACCT_SPARSE = "a10c2d31-2222-4b20-8c63-000000000007"; // exists, no wallet

/**
 * Real on-chain decimals per contract address. This table is the test's own
 * copy of ground truth: if a seed edit ever changes a decimals value, this
 * fails before the fixture can teach integrators a falsehood.
 */
const ON_CHAIN_DECIMALS = {
  "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": 6, // USDC (Base)
  "0x60a3e35cc302bfa44cb288bc5a4f316fdb1adb42": 6, // EURC (Base)
  "0xfde4c96c8593536e31f229ea8f37b2ada2699bb2": 6, // USDT (Base)
  "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": 6, // USDC (Ethereum)
  "0x6b175474e89094c44da98b954eedeac495271d0f": 18, // DAI (Ethereum)
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: 6, // USDC (Solana)
};

test("supported-assets: tenant list carries real on-chain decimals per asset", async () => {
  const f = mockFinance();
  const page = await f.supportedAssets.list();

  assert.equal(page.resultPresent, true);
  assert.equal(page.pagination, undefined, "the wire shape has no pagination");
  assert.ok(page.items.length >= 6, "the seed set covers the demo assets");

  for (const asset of page.items) {
    assert.equal(typeof asset.decimals, "number", `${asset.cryptoCurrency} has numeric decimals`);
    assert.ok(Number.isInteger(asset.decimals), `${asset.cryptoCurrency} decimals is an integer`);
    assert.equal(
      asset.decimals,
      ON_CHAIN_DECIMALS[asset.contractAddress],
      `${asset.chain} ${asset.cryptoCurrency} (${asset.contractAddress}) must carry its real on-chain decimals`,
    );
  }

  const dai = page.items.find((a) => a.cryptoCurrency === "DAI");
  assert.equal(dai?.decimals, 18, "the seed set includes a non-6-decimals asset");
});

test("supported-assets: every wallet-seed asset is resolvable by contract address", async () => {
  const f = mockFinance();
  const [assets, wallets] = await Promise.all([
    f.supportedAssets.list(),
    f.wallets.list(ACCT_MAIN),
  ]);
  const byAddress = new Map(assets.items.map((a) => [a.contractAddress, a]));
  for (const row of wallets.items) {
    assert.ok(
      byAddress.has(row.contractAddress),
      `wallet asset ${row.asset} (${row.contractAddress}) must exist in supported-assets, or decimals lookups silently fall back`,
    );
  }
});

test("supported-assets: the sub-cent seed exists (a 2dp render would show 0.00 dust)", async () => {
  const f = mockFinance();
  const wallets = await f.wallets.list(ACCT_MAIN);
  const eurc = wallets.items.find((w) => w.asset === "EURC");
  assert.equal(eurc?.amount?.total, 8020.000875);
  assert.equal(eurc?.amount?.available, 8020.000875);
});

test("supported-assets: account view adds permitStatus, seeded states render-ready", async () => {
  const f = mockFinance();
  const page = await f.supportedAssets.listForAccount(ACCT_MAIN);

  assert.equal(page.resultPresent, true);
  const byCurrency = Object.fromEntries(page.items.map((a) => [a.cryptoCurrency, a.permitStatus]));
  assert.equal(byCurrency.USDC, "READY");
  assert.equal(byCurrency.EURC, "READY");
  assert.equal(byCurrency.USDT, "ACTION_REQUIRED", "a to-do state is part of the seed set");

  for (const asset of page.items) {
    assert.equal(
      asset.decimals,
      ON_CHAIN_DECIMALS[asset.contractAddress],
      "account rows carry the same real decimals as the tenant rows",
    );
  }
});

test("supported-assets: unseeded accounts derive permitStatus from wallet presence", async () => {
  const f = mockFinance();

  const withWallet = await f.supportedAssets.listForAccount(ACCT_OPS);
  assert.ok(withWallet.items.length > 0);
  assert.ok(
    withWallet.items.every((a) => a.permitStatus === "PENDING"),
    "an account holding a wallet defaults to PENDING",
  );

  const sparse = await f.supportedAssets.listForAccount(ACCT_SPARSE);
  assert.ok(
    sparse.items.every((a) => a.permitStatus === "NO_WALLET"),
    "an account without a wallet defaults to NO_WALLET",
  );
});

test("supported-assets: unknown account is a 404, not an empty list", async () => {
  const f = mockFinance();
  await assert.rejects(
    () => f.supportedAssets.listForAccount("00000000-0000-0000-0000-000000000000"),
    (err) => err instanceof VenlyApiError && err.status === 404,
  );
});

test("supported-assets: a malformed envelope surfaces resultPresent false, never an empty list", async () => {
  const f = mockFinance();

  f.mock.respondNext({ success: true }, "GET /supported-assets");
  const tenant = await f.supportedAssets.list();
  assert.equal(tenant.resultPresent, false);
  assert.deepEqual(tenant.items, []);

  f.mock.respondNext({ success: true }, "GET /accounts/{accountId}/supported-assets");
  const scoped = await f.supportedAssets.listForAccount(ACCT_MAIN);
  assert.equal(scoped.resultPresent, false);
  assert.deepEqual(scoped.items, []);
});

test("supported-assets: reset restores the seed rows", async () => {
  const f = mockFinance();
  const before = await f.supportedAssets.list();
  f.mock.reset();
  const after = await f.supportedAssets.list();
  assert.deepEqual(after.items, before.items);
});
