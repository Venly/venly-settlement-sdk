import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  StdioClientTransport,
  getDefaultEnvironment,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { SERVER_VERSION } from "./constants.js";
import { sanitizeErrorMessage } from "./results.js";

export const EXPECTED_TOOLS = [
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
  "create_party",
  "create_account",
  "create_virtual_bank_account",
  "create_fiat_transfer",
  "create_crypto_transfer",
  "approve_ramp_request",
  "reject_ramp_request",
  "create_payment_session",
  "quote_x402_payment",
  "get_journey_blueprint",
  "review_screen",
] as const;

export const EXPECTED_RESOURCE_URIS = [
  "venly://capabilities",
  "venly://safety",
  "venly://workflows/international-account",
  "venly://workflows/mock-to-staging",
  "venly://frontend/agents",
] as const;

export const EXPECTED_PROMPTS = ["build_international_account"] as const;

export interface DiscoveryNames {
  tools: string[];
  resources: string[];
  prompts: string[];
}

function assertExactMembers(
  label: string,
  expected: readonly string[],
  actual: readonly string[],
): void {
  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);
  for (const name of expected) {
    if (!actualSet.has(name)) throw new Error(`missing ${label}: ${name}`);
  }
  for (const name of actual) {
    if (!expectedSet.has(name)) throw new Error(`unexpected ${label}: ${name}`);
  }
}

export function assertExpectedDiscovery(actual: DiscoveryNames): void {
  assertExactMembers("tool", EXPECTED_TOOLS, actual.tools);
  assertExactMembers("resource", EXPECTED_RESOURCE_URIS, actual.resources);
  assertExactMembers("prompt", EXPECTED_PROMPTS, actual.prompts);
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

export function assertDryRunResult(result: unknown): void {
  const record = asRecord(result, "write result");
  const gate = asRecord(record.gate, "write gate");
  if (
    record.mode !== "dry-run" ||
    record.environment !== "staging" ||
    gate.armed !== false ||
    gate.liveFlagArmed !== false
  ) {
    throw new Error("expected a staging dry-run with both write gates disarmed");
  }
}

function requireCredentials(env: NodeJS.ProcessEnv): {
  clientId: string;
  clientSecret: string;
} {
  const clientId = env.VENLY_CLIENT_ID;
  const clientSecret = env.VENLY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "Set VENLY_CLIENT_ID and VENLY_CLIENT_SECRET for the staging tenant.",
    );
  }
  return { clientId, clientSecret };
}

function optionalEnvironment(
  env: NodeJS.ProcessEnv,
): Record<string, string> {
  const keys = [
    "VENLY_FINANCE_BASE_URL",
    "VENLY_FUNDFLOW_BASE_URL",
    "VENLY_TOKEN_URL",
  ] as const;
  const out: Record<string, string> = {};
  for (const key of keys) {
    if (env[key]) out[key] = env[key];
  }
  return out;
}

function structuredContent(result: unknown, label: string): Record<string, unknown> {
  const record = asRecord(result, label);
  if (record.isError === true) {
    const detail = Array.isArray(record.content)
      ? record.content
          .map((item) =>
            item && typeof item === "object" && "text" in item
              ? String((item as { text: unknown }).text)
              : "",
          )
          .filter(Boolean)
          .join("; ")
      : "";
    throw new Error(
      `${label} returned an MCP error${detail ? `: ${sanitizeErrorMessage(detail)}` : ""}`,
    );
  }
  return asRecord(record.structuredContent, `${label} structuredContent`);
}

function countFrom(result: unknown, label: string): number {
  const content = structuredContent(result, label);
  if (typeof content.count !== "number") {
    throw new Error(`${label} did not return a numeric count`);
  }
  return content.count;
}

function referenceCounts(result: unknown): string {
  const content = structuredContent(result, "get_reference_data");
  const counts: string[] = [];
  for (const key of ["chains", "fiatCurrencies", "cryptocurrencies", "fees"] as const) {
    const value = content[key];
    if (!Array.isArray(value)) throw new Error(`get_reference_data missing ${key} array`);
    counts.push(`${key}=${value.length}`);
  }
  return counts.join(", ");
}

export interface StagingSmokeOptions {
  env?: NodeJS.ProcessEnv;
  serverEntry?: string;
  log?: (line: string) => void;
}

export function buildStagingChildEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const { clientId, clientSecret } = requireCredentials(env);
  return {
    ...getDefaultEnvironment(),
    ...optionalEnvironment(env),
    VENLY_ENV: "staging",
    VENLY_CLIENT_ID: clientId,
    VENLY_CLIENT_SECRET: clientSecret,
  };
}

export async function runStagingSmoke(options: StagingSmokeOptions = {}): Promise<void> {
  const env = options.env ?? process.env;
  const log = options.log ?? console.log;
  const serverEntry =
    options.serverEntry ?? fileURLToPath(new URL("./index.js", import.meta.url));

  // The builder allowlists inherited variables and never copies live-write flags.
  const childEnv = buildStagingChildEnv(env);

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverEntry],
    env: childEnv,
    stderr: "inherit",
  });
  const client = new Client({
    name: "venly-staging-smoke",
    version: SERVER_VERSION,
  });

  try {
    await client.connect(transport);
    const [toolResult, resourceResult, promptResult] = await Promise.all([
      client.listTools(),
      client.listResources(),
      client.listPrompts(),
    ]);
    assertExpectedDiscovery({
      tools: toolResult.tools.map((tool) => tool.name),
      resources: resourceResult.resources.map((resource) => resource.uri),
      prompts: promptResult.prompts.map((prompt) => prompt.name),
    });
    log(
      `OK   discovery - tools=${toolResult.tools.length}, resources=${resourceResult.resources.length}, prompts=${promptResult.prompts.length}`,
    );

    const parties = await client.callTool({ name: "list_parties", arguments: { size: 1 } });
    log(`OK   list_parties - count=${countFrom(parties, "list_parties")}`);

    const accounts = await client.callTool({ name: "list_accounts", arguments: { size: 1 } });
    log(`OK   list_accounts - count=${countFrom(accounts, "list_accounts")}`);

    try {
      const referenceData = await client.callTool({
        name: "get_reference_data",
        arguments: { dataset: "all" },
      });
      log(`OK   get_reference_data - ${referenceCounts(referenceData)}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const isScopeError = /\b(401|403)\b/.test(message);
      if (isScopeError && env.VENLY_SMOKE_ALLOW_FUNDFLOW_SKIP === "1") {
        log(
          "SKIP get_reference_data - credential lacks Fundflow scope (tolerated via VENLY_SMOKE_ALLOW_FUNDFLOW_SKIP=1); fundflow validated by spec-diff only",
        );
      } else {
        throw error;
      }
    }

    const dryRun = await client.callTool({
      name: "create_party",
      arguments: {
        partyType: "ORGANISATION",
        name: "Venly staging smoke dry-run",
        confirm: true,
      },
    });
    assertDryRunResult(structuredContent(dryRun, "create_party"));
    log("OK   create_party - confirmed request remained dry-run; zero mutation");
  } finally {
    await client.close();
  }
}
