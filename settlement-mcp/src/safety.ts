/**
 * The write-tool safety gate. This is the core safety property of the server.
 *
 * A write tool executes a live call ONLY when ALL THREE hold:
 *   1. the tool arg `confirm === true`
 *   2. the env flag VENLY_MCP_LIVE === "1"
 *   3. credentials are present (client id + secret in env)
 *
 * If ANY is missing the tool returns a dry-run object describing the exact
 * request it WOULD have sent, and never calls the transport. Fail closed.
 */

import {
  LIVE_FLAG,
  PRODUCTION_FLAG,
  resolveVenlyEnvironment,
  type VenlyEnvironment,
} from "./constants.js";

export type EnvLike = Record<string, string | undefined>;

export interface GateDecision {
  /** True in explicit mock mode, or when every live environment gate holds. */
  armed: boolean;
  environment: VenlyEnvironment;
  confirm: boolean;
  liveFlagArmed: boolean;
  productionFlagArmed: boolean;
  credentialsPresent: boolean;
  /** Human-readable reasons a live call is blocked (empty when armed). */
  blockedReasons: string[];
}

export function credentialsPresent(env: EnvLike): boolean {
  return Boolean(env.VENLY_CLIENT_ID && env.VENLY_CLIENT_SECRET);
}

export function evaluateWriteGate(confirm: boolean, env: EnvLike): GateDecision {
  const environment = resolveVenlyEnvironment(env);
  const liveFlagArmed = env[LIVE_FLAG] === "1";
  const productionFlagArmed = env[PRODUCTION_FLAG] === "1";
  const creds = credentialsPresent(env);

  if (environment === "mock") {
    return {
      armed: true,
      environment,
      confirm,
      liveFlagArmed,
      productionFlagArmed,
      credentialsPresent: creds,
      blockedReasons: [],
    };
  }

  const blockedReasons: string[] = [];
  if (!confirm) blockedReasons.push("confirm arg is not true");
  if (!liveFlagArmed) blockedReasons.push(`${LIVE_FLAG} is not set to "1"`);
  if (!creds) blockedReasons.push("credentials are not present in env");
  if (environment === "production" && !productionFlagArmed) {
    blockedReasons.push(`${PRODUCTION_FLAG} is not set to "1"`);
  }
  return {
    armed:
      confirm &&
      liveFlagArmed &&
      creds &&
      (environment !== "production" || productionFlagArmed),
    environment,
    confirm,
    liveFlagArmed,
    productionFlagArmed,
    credentialsPresent: creds,
    blockedReasons,
  };
}

export interface DryRunRequest {
  mode: "dry-run";
  environment: VenlyEnvironment;
  tool: string;
  method: "GET" | "POST" | "PUT" | "DELETE";
  /** Which API this maps to. */
  api: "finance" | "fundflow";
  path: string;
  body?: unknown;
  gate: GateDecision;
  note: string;
}

export function buildDryRun(
  tool: string,
  method: DryRunRequest["method"],
  api: DryRunRequest["api"],
  path: string,
  body: unknown,
  gate: GateDecision,
): DryRunRequest {
  return {
    mode: "dry-run",
    environment: gate.environment,
    tool,
    method,
    api,
    path,
    body,
    gate,
    note:
      "No live call was made. To execute outside mock mode, set confirm:true AND " +
      "VENLY_MCP_LIVE=1 AND provide VENLY_CLIENT_ID / VENLY_CLIENT_SECRET. " +
      "Production additionally requires VENLY_MCP_PRODUCTION=1.",
  };
}
