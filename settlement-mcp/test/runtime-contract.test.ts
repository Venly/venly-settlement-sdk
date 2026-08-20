import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
} as const;

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
      assert.deepEqual(contract.requiredPackages, registryDependencies(JOURNEY_BLOCKS[journey as keyof typeof JOURNEY_BLOCKS]));
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
