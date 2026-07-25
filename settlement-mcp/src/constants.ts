/** Shared constants. Defaults point at STAGING so an accidental run never
 * touches production. Override via env for a real sandbox test. */

export const SERVER_NAME = "venly-settlement-mcp-server";
export const SERVER_VERSION = "0.1.0";

/** The env flag that must equal "1" for any write tool to execute live. */
export const LIVE_FLAG = "VENLY_MCP_LIVE";

/** Default base URLs (STAGING). Production values live in the vendored specs:
 * finance https://api.venlyfinance.com/api/v1, fundflow https://api-fundflow.venly.io */
export const DEFAULT_FINANCE_BASE_URL =
  "https://api-staging.venlyfinance.com/api/v1";
export const DEFAULT_FUNDFLOW_BASE_URL = "https://api-fundflow-staging.venly.io";
export const DEFAULT_TOKEN_URL =
  "https://login.venly.io/auth/realms/VenlyFinance/protocol/openid-connect/token";

/** Cap on serialized tool output length to keep responses readable. */
export const CHARACTER_LIMIT = 30_000;
