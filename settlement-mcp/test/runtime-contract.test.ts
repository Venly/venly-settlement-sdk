import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { makeHarness } from "./helpers.ts";

const reactExports = readFileSync(
  fileURLToPath(new URL("../../react/src/index.ts", import.meta.url)),
  "utf8",
);

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

const JOURNEY_BLOCKS = {
  auth: ["auth"],
  team: ["team"],
  "home-balances": ["balances"],
  receive: ["receive"],
  send: ["send"],
  activity: ["activity"],
  "onboarding-status": ["onboarding"],
  "withdraw-bank-accounts": ["bank-accounts", "withdraw"],
  reconciliation: ["reconciliation"],
  "proof-of-segregation": ["balances"],
  approvals: ["withdraw"],
  "console-review-queue": ["console-queue"],
  "console-decision-detail": ["console-decision"],
  "console-pricing-config": ["console-pricing"],
  "console-simulator": ["console-simulator"],
  "console-webhooks": ["console-webhooks"],
} as const;

/** Mirrors DATA_PLANE_PACKAGES in src/frontend.ts. */
const DATA_PLANE_PACKAGES = {
  "@venlyfinance/react": "^0.6.0",
  "@venlyfinance/sdk": "^0.7.0",
  "@tanstack/react-query": "^5.0.0",
} as const;

const DATA_PLANE_JOURNEYS = new Set([
  "console-review-queue",
  "console-decision-detail",
  "console-pricing-config",
  "console-simulator",
  "console-webhooks",
]);

function registryDependencies(blocks: readonly string[]): Record<string, string> {
  const packages: Record<string, string> = {};
  for (const block of blocks) {
    const item = JSON.parse(readFileSync(`${repoRoot}/ui/r/${block}.json`, "utf8"));
    for (const dependency of item.dependencies ?? []) {
      const splitAt = dependency.lastIndexOf("@");
      packages[dependency.slice(0, splitAt)] = dependency.slice(splitAt + 1);
    }
  }
  return packages;
}

const JOURNEY_HOOKS = {
  auth: [],
  team: [],
  "home-balances": ["useAccounts", "useWallets"],
  receive: ["useVirtualBankAccounts"],
  send: ["useStagedTransfer", "useFeeQuote"],
  activity: ["useTransfers", "useRampRequests"],
  "onboarding-status": ["useCreateParty", "useCreateAccount", "useParty", "useAccount"],
  "withdraw-bank-accounts": [
    "useCompanyBankAccounts",
    "useBankAccountConfig",
    "useCreateCompanyBankAccount",
    "useRampRequests",
    "useRampRequest",
    "useCreateRampRequest",
    "useFeeQuote",
    "useRampPairs",
    "useReferenceData",
    "useFourEyesApproval",
    "useInitiateRamp",
    "describeRampStatus",
  ],
  reconciliation: ["useVirtualBankAccounts", "useTransfers"],
  "proof-of-segregation": ["useWallets", "useAccount"],
  approvals: ["useRampRequests", "useFourEyesApproval", "useRampLifecycle"],
  "console-review-queue": ["useAccounts", "useParties"],
  "console-decision-detail": [
    "useAccount",
    "useParty",
    "useWallets",
    "useTransfers",
    "useVirtualBankAccounts",
    "useVenlyMock",
  ],
  "console-pricing-config": ["useCompanyFees"],
  "console-simulator": ["useVenlyMock"],
  "console-webhooks": [
    "useWebhooks",
    "useWebhook",
    "useCreateWebhook",
    "useUpdateWebhook",
    "useDeleteWebhook",
    "usePingWebhook",
  ],
} as const;

for (const [journey, expectedHooks] of Object.entries(JOURNEY_HOOKS)) {
  test(`get_journey_blueprint: ${journey} includes a resolvable runtime contract`, async () => {
    const h = await makeHarness({ VENLY_ENV: "mock" });
    try {
      const response: any = await h.client.callTool({
        name: "get_journey_blueprint",
        arguments: { journey },
      });
      assert.equal(response.content.length, 2);
      assert.match(response.content[0].text, /^# /);
      assert.match(response.content[1].text, /^```json\n/);

      const contract = response.structuredContent?.runtime_contract;
      assert.ok(contract, "structuredContent.runtime_contract must exist");
      assert.equal(contract.runtimeMode, "mock");
      assert.deepEqual(
        contract.requiredHooks,
        expectedHooks.map((name) => ({ import: name, from: "@venlyfinance/react" })),
      );
      assert.deepEqual(contract.provider, {
        import: "VenlyProvider",
        from: "@venlyfinance/react",
        props: { environment: "mock" },
      });
      const blocks = JOURNEY_BLOCKS[journey as keyof typeof JOURNEY_BLOCKS];
      assert.deepEqual(
        contract.requiredPackages,
        DATA_PLANE_JOURNEYS.has(journey)
          ? { ...DATA_PLANE_PACKAGES, ...registryDependencies(blocks) }
          : registryDependencies(blocks),
      );
      // A hook-using surface must never be told it needs no packages.
      if (expectedHooks.length > 0) {
        assert.ok(
          Object.keys(contract.requiredPackages).length > 0,
          `${journey} declares hooks, so requiredPackages must not be empty`,
        );
      }
      // Every install target must be a registry item that actually exists.
      for (const step of contract.install as string[]) {
        for (const match of step.matchAll(/@venlyfinance\/([a-z-]+)/g)) {
          if (match[1] === "settlement-mcp") continue;
          assert.ok(
            existsSync(`${repoRoot}/ui/r/${match[1]}.json`),
            `install references @venlyfinance/${match[1]}, which has no ui/r entry`,
          );
        }
      }
      assert.ok(contract.forbiddenPatterns.length >= 4);
      assert.equal(contract.completionChecks.length, 2);

      const fenced = response.content[1].text.slice("```json\n".length, -"\n```".length);
      assert.deepEqual(JSON.parse(fenced), response.structuredContent);

      for (const hook of expectedHooks) {
        assert.match(
          reactExports,
          new RegExp(`\\b${hook}\\b`),
          `${hook} must resolve against react/src/index.ts`,
        );
      }
    } finally {
      await h.close();
    }
  });
}

// The blueprint prose and the machine-readable contract are two halves of one
// promise, and nothing was checking them against each other: the simulator
// journey shipped `Hooks: useVenlyMock` in its prose and `hooks: []` in its
// contract, so an agent trusting requiredHooks - the entire point of shipping
// it - would have got none for a screen that is nothing but hooks. Caught by a
// cold reader, not by this suite. Now it is caught here.
for (const [journey, expectedHooks] of Object.entries(JOURNEY_HOOKS)) {
  test(`get_journey_blueprint: ${journey} prose and contract name the same hooks`, async () => {
    const h = await makeHarness({ VENLY_ENV: "mock" });
    try {
      const response: any = await h.client.callTool({
        name: "get_journey_blueprint",
        arguments: { journey },
      });
      const prose: string = response.content[0].text;

      // Every declared hook must be named somewhere in the prose, so a reader
      // of the blueprint is told about everything the contract requires.
      for (const hook of expectedHooks) {
        assert.ok(
          prose.includes(hook),
          `${journey}: contract requires ${hook}, prose never names it`,
        );
      }

      // And every use*-shaped identifier on the prose's Hooks line must be in
      // the contract, so prose cannot promise a hook the contract omits. The
      // line may also cite non-hook helpers (an MCP tool, a describe* fn),
      // which is why only use* identifiers are compared.
      const hooksLine = /^Hooks: (.*(?:\n(?!\w+:).*)*)$/m.exec(prose);
      if (hooksLine) {
        const named = new Set(hooksLine[1].match(/\buse[A-Z][A-Za-z]*/g) ?? []);
        for (const hook of named) {
          assert.ok(
            (expectedHooks as readonly string[]).includes(hook),
            `${journey}: prose names ${hook} on its Hooks line, contract omits it`,
          );
        }
      }
    } finally {
      await h.close();
    }
  });
}

// A blueprint must never name a package version this repo does not ship. The
// console entries pin the sdk range the 0.6.0-only APIs they describe actually
// need (channelInfo, balances that move), so if the root package version ever
// fell behind that range the blueprints would be telling an agent to install
// something that does not exist. Offline and deterministic on purpose: it
// asserts against the repo, not against the registry, so it cannot go red for
// a publish that has not happened yet.
test("blueprint package ranges are satisfied by the versions this repo ships", async () => {
  const shipped: Record<string, string> = {
    "@venlyfinance/sdk": JSON.parse(readFileSync(`${repoRoot}/package.json`, "utf8")).version,
    "@venlyfinance/react": JSON.parse(readFileSync(`${repoRoot}/react/package.json`, "utf8"))
      .version,
  };

  const h = await makeHarness({ VENLY_ENV: "mock" });
  try {
    for (const journey of Object.keys(JOURNEY_HOOKS)) {
      const response: any = await h.client.callTool({
        name: "get_journey_blueprint",
        arguments: { journey },
      });
      const packages: Record<string, string> =
        response.structuredContent.runtime_contract.requiredPackages;
      for (const [name, range] of Object.entries(packages)) {
        const version = shipped[name];
        if (version === undefined) continue; // third-party ranges are not ours to assert
        const [wantMajor, wantMinor] = range.replace(/^[^\d]*/, "").split(".").map(Number);
        const [haveMajor, haveMinor] = version.split(".").map(Number);
        assert.ok(
          haveMajor > wantMajor || (haveMajor === wantMajor && haveMinor >= wantMinor),
          `${journey}: blueprint asks for ${name}@${range}, repo ships ${version}`,
        );
      }
    }
  } finally {
    await h.close();
  }
});
