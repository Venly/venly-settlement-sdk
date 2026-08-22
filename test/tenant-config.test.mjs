// The static mock tenant config is the CAUSAL half of what the consumer
// surfaces offer: its lanes explain the rails/assets the mock actually
// serves. A config row contradicting the consumer surface is a seeded
// falsehood, so the join is asserted here in both directions, against both
// seeded worlds (base seeds and the demo cast).
import test from "node:test";
import assert from "node:assert/strict";
import { VenlyFinanceClient, mockTenantConfig, demoCast } from "../dist/esm/index.js";

const mockFinance = () => new VenlyFinanceClient({ environment: "mock" });

/** Every (fiat -> crypto) pair the world's VBAs serve, plus route lanes. */
async function servedLanes(f) {
  const vbaPairs = new Set();
  const routeLanes = new Set();
  const railsInUse = new Set();
  const accounts = await f.accounts.list();
  for (const account of accounts.items) {
    const vbas = await f.virtualBankAccounts.list(account.id);
    for (const vba of vbas.items) {
      if (vba.currency && vba.targetCryptocurrency) {
        vbaPairs.add(`${vba.currency}->${vba.targetCryptocurrency}`);
      }
    }
    const routes = await f.payoutRoutes.list(account.id);
    for (const route of routes) {
      routeLanes.add(
        `${route.depositAsset.chain}:${route.depositAsset.name}->${route.fiatCurrency}`,
      );
    }
    const payouts = await f.payouts.list(account.id);
    for (const payout of payouts.items) {
      if (payout.rail) railsInUse.add(payout.rail);
    }
  }
  const assets = await f.supportedAssets.list();
  const supported = new Set(assets.items.map((a) => `${a.chain}:${a.cryptoCurrency}`));
  return { vbaPairs, routeLanes, railsInUse, supported };
}

function assertConfigMatchesWorld(world, label) {
  const { vbaPairs, routeLanes, railsInUse, supported } = world;

  // Direction 1: every consumer-served pay-in pair is covered by a lane.
  for (const pair of vbaPairs) {
    const [fiat, crypto] = pair.split("->");
    assert.ok(
      mockTenantConfig.vbaLanePreferences.some(
        (lane) => lane.fiatCurrency === fiat && lane.cryptoCurrency === crypto,
      ),
      `${label}: consumer serves a ${pair} virtual bank account with no tenant lane behind it`,
    );
  }

  // Direction 2: every configured pay-in lane names an asset the world's
  // supported-assets seeds actually carry on that chain.
  for (const lane of mockTenantConfig.vbaLanePreferences) {
    assert.ok(
      supported.has(`${lane.chain}:${lane.cryptoCurrency}`),
      `${label}: tenant lane ${lane.chain}:${lane.cryptoCurrency} names an unsupported asset`,
    );
  }

  // Direction 1, payouts: every served route lane is covered by config.
  for (const key of routeLanes) {
    const [chainAsset, fiat] = key.split("->");
    const [chain, asset] = chainAsset.split(":");
    assert.ok(
      mockTenantConfig.payoutLanePreferences.some(
        (lane) => lane.chain === chain && lane.sourceAsset === asset && lane.fiatCurrency === fiat,
      ),
      `${label}: consumer serves payout route ${key} with no tenant lane behind it`,
    );
  }

  // Direction 2, payouts: every configured rail is one the world's payouts use.
  for (const lane of mockTenantConfig.payoutLanePreferences) {
    if (railsInUse.size > 0) {
      assert.ok(
        railsInUse.has(lane.rail),
        `${label}: tenant payout lane rail ${lane.rail} never appears on a served payout`,
      );
    }
  }
}

test("tenant config: lanes match what the consumer mock serves (base seeds)", async () => {
  const f = mockFinance();
  assertConfigMatchesWorld(await servedLanes(f), "base seeds");
});

test("tenant config: lanes match what the consumer mock serves (demo cast)", async () => {
  const f = mockFinance();
  f.mock.simulations.seed(demoCast);
  assertConfigMatchesWorld(await servedLanes(f), "demo cast");
});

test("tenant config: read-only seeded constants - no drivers, no CRUD surface", () => {
  // The module exports data only. Nothing on it is callable, so no test can
  // mutate tenant state and no surface can pretend a write op exists.
  const walk = (value, path) => {
    assert.notEqual(typeof value, "function", `mockTenantConfig.${path} must not be callable`);
    if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) walk(v, path ? `${path}.${k}` : k);
    }
  };
  walk(mockTenantConfig, "");
  assert.ok(mockTenantConfig.vbaProviders.length > 0);
  assert.ok(mockTenantConfig.payoutProviders.length > 0);
});
