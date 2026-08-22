/** Shared constants. The default environment is MOCK so an unconfigured run
 * never touches real infrastructure; staging/production are explicit. */

export const SERVER_NAME = "venly-finance-mcp-server";
export const SERVER_VERSION = "0.8.0";
export const INSTRUCTIONS = `Venly Finance build advisor. This server is a build-time advisor, not your app's data plane. The data plane is the published packages: every read is a hook and every regulated lifecycle a flow machine from \`@venlyfinance/react\`, inside \`<VenlyProvider environment="mock">\` – zero credentials, zero network; server-side code uses \`@venlyfinance/sdk\`. Hand-rolled fetch layers, in-memory money stores, or route handlers that re-implement transfers, balances, or approvals are off-contract and fail review. UI installs from the @venlyfinance shadcn registry: \`npx shadcn@latest add @venlyfinance/balances @venlyfinance/send …\` (auto-installs the npm packages). Before scaffolding, read \`venly://frontend/agents\` – it is the composition doctrine (AGENTS.md). Consult \`get_journey_blueprint\` per screen; gate finished screens with \`review_screen\` and \`npx @venlyfinance/settlement-mcp review "src/**/*.tsx"\`.`;

export const ENVIRONMENT_FLAG = "VENLY_ENV";
export type VenlyEnvironment = "mock" | "qa" | "staging" | "production";

export function resolveVenlyEnvironment(
  env: Record<string, string | undefined>,
): VenlyEnvironment {
  // Default is MOCK (since 0.3.0): the mock-first product must not point at
  // real infrastructure when unconfigured. Set VENLY_ENV explicitly for
  // staging or production.
  const value = env[ENVIRONMENT_FLAG] ?? "mock";
  if (value === "mock" || value === "qa" || value === "staging" || value === "production") {
    return value;
  }
  throw new Error(
    `${ENVIRONMENT_FLAG} must be one of mock, qa, staging, production; received ${JSON.stringify(value)}`,
  );
}

/** The env flag that must equal "1" for any write tool to execute live. */
export const LIVE_FLAG = "VENLY_MCP_LIVE";
export const PRODUCTION_FLAG = "VENLY_MCP_PRODUCTION";

/** Default base URLs (STAGING). Production values live in the vendored specs:
 * finance https://api.venlyfinance.com/v1, fundflow https://api-fundflow.venly.io */
export const DEFAULT_FINANCE_BASE_URL =
  "https://api-staging.venlyfinance.com/v1";
export const DEFAULT_FUNDFLOW_BASE_URL = "https://api-fundflow-staging.venly.io";
export const DEFAULT_TOKEN_URL =
  "https://login-staging.venly.io/auth/realms/VenlyFinance/protocol/openid-connect/token";

/** Cap on serialized tool output length to keep responses readable. */
export const CHARACTER_LIMIT = 30_000;
