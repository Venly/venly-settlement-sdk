import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_FINANCE_BASE_URL,
  DEFAULT_FUNDFLOW_BASE_URL,
  DEFAULT_TOKEN_URL,
  SERVER_VERSION,
  resolveVenlyEnvironment,
} from "../src/constants.ts";
import { SdkVenlyClient } from "../src/client/sdk-client.ts";

// Regression net for the v0.1.0 stale-spec bug: pin the default URLs to the
// exact strings in the live published specs. The mocked-client suite cannot
// catch a wrong hardcoded URL any other way.
test("default URLs are pinned to the live published spec values", () => {
  assert.equal(DEFAULT_FINANCE_BASE_URL, "https://api-staging.venlyfinance.com/v1");
  assert.equal(DEFAULT_FUNDFLOW_BASE_URL, "https://api-fundflow-staging.venly.io");
  assert.equal(
    DEFAULT_TOKEN_URL,
    "https://login-staging.venly.io/auth/realms/VenlyFinance/protocol/openid-connect/token",
  );
});

// The README's config example and defaults table must not drift from the
// constants module (they did once: the v0.1.1 customer review found the old
// /api/v1 base documented three paragraphs after the CHANGELOG announced the
// fix). This test fails the suite if they diverge again.
test("README documents the same defaults the code exports", () => {
  const readme = readFileSync(
    fileURLToPath(new URL("../README.md", import.meta.url)),
    "utf8",
  );
  for (const url of [DEFAULT_FINANCE_BASE_URL, DEFAULT_FUNDFLOW_BASE_URL, DEFAULT_TOKEN_URL]) {
    assert.ok(readme.includes(url), `README missing documented default: ${url}`);
  }
  assert.ok(
    !readme.includes("venlyfinance.com/api/v1"),
    "README documents the retired /api/v1 base path",
  );
});

test("environment selection is explicit and defaults to mock (0.3.0 behavior change)", () => {
  // Since 0.3.0 an unconfigured server never points at real infrastructure.
  assert.equal(resolveVenlyEnvironment({}), "mock");
  assert.equal(resolveVenlyEnvironment({ VENLY_ENV: "mock" }), "mock");
  assert.equal(resolveVenlyEnvironment({ VENLY_ENV: "qa" }), "qa");
  assert.equal(resolveVenlyEnvironment({ VENLY_ENV: "staging" }), "staging");
  assert.equal(resolveVenlyEnvironment({ VENLY_ENV: "production" }), "production");
  assert.throws(
    () => resolveVenlyEnvironment({ VENLY_ENV: "sandbox" }),
    /VENLY_ENV must be one of mock, qa, staging, production/,
  );
});

test("SDK client factory constructs explicit mock mode without credentials", () => {
  const client = SdkVenlyClient.fromEnv({ VENLY_ENV: "mock" });
  assert.equal(client.environment, "mock");
});

test("package exposes finance and settlement compatibility binaries from one implementation", () => {
  const packageJson = JSON.parse(
    readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"),
  );
  assert.equal(packageJson.bin["venly-finance-mcp"], "dist/index.js");
  assert.equal(packageJson.bin["venly-settlement-mcp"], "dist/index.js");
  assert.match(packageJson.repository.url, /github\.com\/Venly\/venly-settlement-sdk/);
});

test("package and MCP server versions stay aligned", () => {
  const packageJson = JSON.parse(
    readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"),
  );
  assert.equal(packageJson.version, "0.6.0");
  assert.equal(SERVER_VERSION, packageJson.version);
});
