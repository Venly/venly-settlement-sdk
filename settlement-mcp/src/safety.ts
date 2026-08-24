/**
 * The write/prepare-tool safety gate. This is the core safety property of the
 * server, enforced in code with a test per tool, not a policy note:
 *
 *   Every write/prepare tool REFUSES any non-mock base URL and any
 *   credential-shaped parameter. There is no arming path around it.
 *
 * Two rules, both fail closed at tool level:
 *   1. non-mock-base-url – the session resolves to anything other than the
 *      mock sandbox (VENLY_ENV != mock), or a base-URL override points at
 *      real infrastructure. The tool refuses before touching any client.
 *   2. credential-shaped-parameter – an argument's KEY looks like a
 *      credential (secret, api key, token, password, private key) or its
 *      VALUE is shaped like one (Bearer header, JWT, prefixed API key, PEM
 *      private key). Credentials never belong in tool arguments, and the
 *      sandbox needs none.
 *
 * Reads are unaffected: this gate covers mutations and preparation tools
 * only. Live mutations belong to a reviewed integration over
 * `@venlyfinance/sdk`, never to this MCP.
 */

import { ENVIRONMENT_FLAG, resolveVenlyEnvironment } from "./constants.js";
import { errorResult } from "./results.js";

export type EnvLike = Record<string, string | undefined>;

/** Env vars that can point this process at real infrastructure. */
export const BASE_URL_VARS = [
  "VENLY_FINANCE_BASE_URL",
  "VENLY_FUNDFLOW_BASE_URL",
  "VENLY_TOKEN_URL",
] as const;

export type SandboxRefusalRule = "non-mock-base-url" | "credential-shaped-parameter";

export interface SandboxRefusal {
  rule: SandboxRefusalRule;
  message: string;
}

/**
 * Rule 1: the sandbox boundary. Null means the session is the mock sandbox
 * (zero credentials, zero network) and the tool may execute against fixtures.
 */
export function checkSandboxBoundary(tool: string, env: EnvLike): SandboxRefusal | null {
  let environment: string;
  try {
    environment = resolveVenlyEnvironment(env);
  } catch {
    // An unrecognised environment value is not a reason to guess: fail closed.
    return {
      rule: "non-mock-base-url",
      message:
        `${tool} refused: ${ENVIRONMENT_FLAG} is set to an unrecognised value, so this session ` +
        `cannot be confirmed as the mock sandbox. Write and prepare tools on this MCP execute ` +
        `only against the mock sandbox – never a live base URL. No request was sent. ` +
        `Set ${ENVIRONMENT_FLAG}=mock to execute.`,
    };
  }
  if (environment !== "mock") {
    return {
      rule: "non-mock-base-url",
      message:
        `${tool} refused: this session resolves to ${ENVIRONMENT_FLAG}=${environment}, which is a ` +
        `real base URL, and the write/prepare tools on this MCP execute only against the mock ` +
        `sandbox – enforced in code, not by convention. No request was sent and nothing changed. ` +
        `Run with ${ENVIRONMENT_FLAG}=mock (zero credentials, zero network) to execute this tool; ` +
        `live mutations belong to your own reviewed integration over @venlyfinance/sdk.`,
    };
  }
  const pointed = BASE_URL_VARS.filter((key) => Boolean(env[key]));
  if (pointed.length > 0) {
    return {
      rule: "non-mock-base-url",
      message:
        `${tool} refused: ${pointed.join(", ")} ${pointed.length === 1 ? "is" : "are"} set, so this ` +
        `session is pointed at a non-mock base URL even though ${ENVIRONMENT_FLAG} resolves to mock. ` +
        `Write and prepare tools execute only against the mock sandbox, so an ambiguous target is ` +
        `refused rather than guessed at. No request was sent. Unset the base-URL override(s) to ` +
        `execute in the sandbox.`,
    };
  }
  return null;
}

/**
 * Key names that read as credentials. Keys are normalised (lowercase,
 * separators stripped) so `client_secret`, `clientSecret` and `client-secret`
 * all match. Deliberately narrow: `idempotencyKey` and `referenceCode` are
 * legitimate parameters and must never trip this.
 */
function credentialShapedKey(key: string): string | null {
  const normalised = key.toLowerCase().replace(/[-_.]/g, "");
  if (normalised.includes("secret")) return "the key names a secret";
  if (normalised.includes("password") || normalised.includes("passphrase")) {
    return "the key names a password";
  }
  if (normalised.includes("credential")) return "the key names a credential";
  if (normalised.includes("apikey")) return "the key names an API key";
  if (normalised.includes("bearer")) return "the key names a bearer token";
  if (
    normalised.includes("privatekey") ||
    normalised.includes("privkey") ||
    normalised.includes("signingkey") ||
    normalised.includes("signerkey")
  ) {
    return "the key names a private key";
  }
  if (normalised.includes("mnemonic") || normalised.includes("seedphrase")) {
    return "the key names a wallet seed";
  }
  if (normalised === "token" || normalised.endsWith("token")) {
    return "the key names a token";
  }
  return null;
}

/**
 * Value shapes that are unambiguously credentials. Deliberately conservative:
 * long opaque strings are NOT flagged, because legitimate parameters carry
 * them (0x addresses, ownership-proof signatures, IBANs).
 */
function credentialShapedValue(value: string, keyHint = ""): string | null {
  if (/^Bearer\s+\S+/i.test(value)) return "the value is a Bearer authorization header";
  if (/^eyJ[\w-]{4,}\.[\w-]{4,}\.[\w-]*$/.test(value)) return "the value is shaped like a JWT";
  if (/^(sk|rk|pk)[-_](live|test|prod)[-_][A-Za-z0-9]{8,}$/i.test(value)) {
    return "the value is shaped like a prefixed API key";
  }
  if (value.includes("-----BEGIN") && value.includes("PRIVATE KEY-----")) {
    return "the value is a PEM private key";
  }
  // 0x + 64 hex is ambiguous: a transaction hash and a raw 32-byte private
  // key share the shape. The key name resolves it - hash-named parameters
  // (blockchainTransactionHash et al.) are the one legitimate carrier; the
  // same value under any other name is treated as a raw private key.
  if (/^0x[0-9a-fA-F]{64}$/.test(value) && !keyHint.toLowerCase().includes("hash")) {
    return "the value is shaped like a raw 32-byte private key";
  }
  return null;
}

/**
 * Rule 2: recursive scan of a tool's arguments for credential-shaped keys and
 * values. Returns the first offending path, or null when the args are clean.
 */
export function findCredentialShapedParam(
  args: unknown,
  path = "",
): { path: string; reason: string } | null {
  if (typeof args === "string") {
    const keyHint = path.split(".").pop()?.replace(/\[\d+\]$/, "") ?? "";
    const reason = credentialShapedValue(args, keyHint);
    return reason ? { path: path || "(value)", reason } : null;
  }
  if (Array.isArray(args)) {
    for (let i = 0; i < args.length; i += 1) {
      const hit = findCredentialShapedParam(args[i], `${path}[${i}]`);
      if (hit) return hit;
    }
    return null;
  }
  if (args !== null && typeof args === "object") {
    for (const [key, value] of Object.entries(args)) {
      const keyPath = path ? `${path}.${key}` : key;
      const keyReason = credentialShapedKey(key);
      if (keyReason) return { path: keyPath, reason: keyReason };
      const hit = findCredentialShapedParam(value, keyPath);
      if (hit) return hit;
    }
  }
  return null;
}

/**
 * The combined gate every write/prepare tool calls FIRST, before validation
 * and before any client access. Returns a ready-to-return MCP error result
 * when the call must be refused, or null when the sandbox may execute it.
 */
export function refuseNonSandbox(
  tool: string,
  args: unknown,
  env: EnvLike,
): ReturnType<typeof errorResult> | null {
  const credential = findCredentialShapedParam(args);
  if (credential) {
    return errorResult(
      `${tool} refused: parameter "${credential.path}" looks like a credential (${credential.reason}). ` +
        `Write and prepare tools on this MCP never accept credential-shaped parameters – the mock ` +
        `sandbox needs none, and a live credential never belongs in a tool argument. Nothing was ` +
        `sent or stored.`,
    );
  }
  const boundary = checkSandboxBoundary(tool, env);
  if (boundary) return errorResult(boundary.message);
  return null;
}
