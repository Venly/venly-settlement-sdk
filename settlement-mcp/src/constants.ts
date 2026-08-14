/** Shared constants. The default environment is MOCK so an unconfigured run
 * never touches real infrastructure; staging/production are explicit. */

export const SERVER_NAME = "venly-finance-mcp-server";
export const SERVER_VERSION = "0.5.0";

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
