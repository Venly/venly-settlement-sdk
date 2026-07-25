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

import { LIVE_FLAG } from "./constants.js";

export type EnvLike = Record<string, string | undefined>;

export interface GateDecision {
  /** true only when confirm + armed env + creds all hold. */
  armed: boolean;
  confirm: boolean;
  liveFlagArmed: boolean;
  credentialsPresent: boolean;
  /** Human-readable reasons a live call is blocked (empty when armed). */
  blockedReasons: string[];
}

export function credentialsPresent(env: EnvLike): boolean {
  return Boolean(env.VENLY_CLIENT_ID && env.VENLY_CLIENT_SECRET);
}

export function evaluateWriteGate(confirm: boolean, env: EnvLike): GateDecision {
  const liveFlagArmed = env[LIVE_FLAG] === "1";
  const creds = credentialsPresent(env);
  const blockedReasons: string[] = [];
  if (!confirm) blockedReasons.push("confirm arg is not true");
  if (!liveFlagArmed) blockedReasons.push(`${LIVE_FLAG} is not set to "1"`);
  if (!creds) blockedReasons.push("credentials are not present in env");
  return {
    armed: confirm && liveFlagArmed && creds,
    confirm,
    liveFlagArmed,
    credentialsPresent: creds,
    blockedReasons,
  };
}

export interface DryRunRequest {
  mode: "dry-run";
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
    tool,
    method,
    api,
    path,
    body,
    gate,
    note:
      "No live call was made. To execute, set confirm:true AND VENLY_MCP_LIVE=1 " +
      "AND provide VENLY_CLIENT_ID / VENLY_CLIENT_SECRET.",
  };
}
