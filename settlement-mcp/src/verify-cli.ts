// `verify` subcommand: deterministic runtime-contract checks for generated apps.
//
// Exit codes: 0 clean (warnings allowed) · 1 at least one error · 2 usage or
// no-match. The three unresolved false-positive boundaries intentionally warn:
// missing React in direct-sdk, app-owned money routes, and in-memory stores.
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

export type VerifyProfile = "direct-sdk" | "backend-proxy";

export interface VerifySourceFile {
  path: string;
  source: string;
}

export interface VerifyFinding {
  rule: string;
  severity: "error" | "warn";
  path: string;
  evidence: string;
  fix: string;
  line?: number;
}

export interface VerifyResult {
  profile: VerifyProfile;
  findings: VerifyFinding[];
  summary: string;
}

const BLUEPRINT_HOOKS = new Set([
  "useAccount",
  "useAccounts",
  "useBankAccountConfig",
  "useCompanyBankAccounts",
  "useCreateAccount",
  "useCreateCompanyBankAccount",
  "useCreateParty",
  "useCreateRampRequest",
  "useFeeQuote",
  "useFourEyesApproval",
  "useInitiateRamp",
  "useParty",
  "useRampLifecycle",
  "useRampPairs",
  "useRampRequest",
  "useRampRequests",
  "useReferenceData",
  "useStagedTransfer",
  "useTransfers",
  "useVirtualBankAccounts",
  "useWallets",
]);

function lineFor(source: string, index: number): number {
  return source.slice(0, index).split("\n").length;
}

function suppressed(source: string, rule: string, line?: number): boolean {
  const token = `venly-allow:${rule}`;
  if (line === undefined) return source.includes(token);
  const lines = source.split("\n");
  return Boolean(lines[line - 1]?.includes(token) || lines[line - 2]?.includes(token));
}

function dependencies(packageJson: Record<string, unknown>): Record<string, string> {
  return Object.assign(
    {},
    packageJson.dependencies ?? {},
    packageJson.devDependencies ?? {},
    packageJson.peerDependencies ?? {},
  ) as Record<string, string>;
}

function importsFrom(source: string, packageName: string): string[] {
  const names: string[] = [];
  const expression = new RegExp(
    `import\\s*\\{([^}]*)\\}\\s*from\\s*["']${packageName.replaceAll("/", "\\/")}["']`,
    "g",
  );
  for (const match of source.matchAll(expression)) {
    for (const item of (match[1] ?? "").split(",")) {
      const name = item.trim().split(/\s+as\s+/)[0]?.trim();
      if (name) names.push(name);
    }
  }
  return names;
}

function isServerFile(file: VerifySourceFile): boolean {
  return (
    /(?:^|\/)(?:server|backend|api)(?:\/|\.)/i.test(file.path) ||
    /(?:^|\/)route\.[cm]?[jt]sx?$/i.test(file.path) ||
    /[.]server\.[cm]?[jt]sx?$/i.test(file.path) ||
    /^\s*["']use server["'];?/m.test(file.source)
  );
}

function isMoneyRoute(file: VerifySourceFile): boolean {
  const routeHandler =
    /(?:^|\/)route\.[cm]?[jt]sx?$/i.test(file.path) ||
    /export\s+(?:async\s+)?function\s+(?:GET|POST|PUT|PATCH|DELETE)\b/.test(file.source);
  const moneySignal =
    /(?:transfers?|payouts?|balances?|ramps?|rampRequests|virtual[-_/ ]bank)/i.test(
      `${file.path}\n${file.source}`,
    );
  return routeHandler && moneySignal;
}

function autoDetectProfile(files: VerifySourceFile[]): VerifyProfile {
  return files.some(
    (file) => file.source.includes("proxyClientOptions") || isMoneyRoute(file),
  )
    ? "backend-proxy"
    : "direct-sdk";
}

export function verifyRuntimeContract(options: {
  files: VerifySourceFile[];
  packageJson: Record<string, unknown>;
  profile?: VerifyProfile;
}): VerifyResult {
  const { files, packageJson } = options;
  const profile = options.profile ?? autoDetectProfile(files);
  const deps = dependencies(packageJson);
  const findings: VerifyFinding[] = [];

  function addProjectFinding(finding: Omit<VerifyFinding, "path">): void {
    const source = files.map((file) => file.source).join("\n");
    if (!suppressed(source, finding.rule)) {
      findings.push({ ...finding, path: "package.json" });
    }
  }

  function addSourceFinding(
    file: VerifySourceFile,
    finding: Omit<VerifyFinding, "path">,
  ): void {
    if (!suppressed(file.source, finding.rule, finding.line)) {
      findings.push({ ...finding, path: file.path });
    }
  }

  if (!("@venlyfinance/react" in deps) && !("@venlyfinance/sdk" in deps)) {
    addProjectFinding({
      rule: "venly-package-missing",
      severity: "error",
      evidence: "package.json declares zero @venlyfinance runtime packages",
      fix: "Install the registry block for the journey or add the required @venlyfinance package.",
    });
  }

  if (profile === "direct-sdk") {
    if (!("@venlyfinance/react" in deps)) {
      addProjectFinding({
        rule: "react-package-missing",
        severity: "warn",
        evidence: "direct-sdk profile has no @venlyfinance/react dependency",
        fix: "Install the journey's registry block, or suppress this warning for an intentionally headless integration.",
      });
    }

    const providerImported = files.some((file) =>
      importsFrom(file.source, "@venlyfinance/react").includes("VenlyProvider"),
    );
    const mockProviderRendered = files.some((file) =>
      /<VenlyProvider\b[^>]*\benvironment\s*=\s*(?:["']mock["']|\{[^}]+\})/s.test(file.source),
    );
    if (!providerImported || !mockProviderRendered) {
      addProjectFinding({
        rule: "provider-missing",
        severity: "error",
        evidence: "no VenlyProvider import and mock/environment expression wrapper were found",
        fix: 'Import VenlyProvider from @venlyfinance/react and wrap the tree with environment="mock".',
      });
    }

    const importedHooks = files.flatMap((file) =>
      importsFrom(file.source, "@venlyfinance/react").filter((name) => BLUEPRINT_HOOKS.has(name)),
    );
    if (importedHooks.length === 0) {
      addProjectFinding({
        rule: "blueprint-hook-missing",
        severity: "error",
        evidence: "no journey-blueprint hook is imported from @venlyfinance/react",
        fix: "Use the qualified hooks named by get_journey_blueprint instead of rebuilding the data layer.",
      });
    }

    for (const file of files) {
      if (!/(?:@venlyfinance\/react|["']react["']|["']use client["'])/.test(file.source)) continue;
      for (const match of file.source.matchAll(/\bclientSecret\b/g)) {
        addSourceFinding(file, {
          rule: "browser-client-secret",
          severity: "error",
          line: lineFor(file.source, match.index ?? 0),
          evidence: "clientSecret appears in browser/React source",
          fix: "Keep secrets server-side; use proxyClientOptions() for browser traffic.",
        });
      }
    }
  } else {
    if (!("@venlyfinance/sdk" in deps)) {
      addProjectFinding({
        rule: "sdk-package-missing",
        severity: "error",
        evidence: "backend-proxy profile has no @venlyfinance/sdk dependency",
        fix: "Add @venlyfinance/sdk and make money routes wrap the official client.",
      });
    }

    for (const file of files) {
      if (isMoneyRoute(file) && !/from\s*["']@venlyfinance\/sdk["']/.test(file.source)) {
        addSourceFinding(file, {
          rule: "money-route-without-sdk",
          severity: "warn",
          line: 1,
          evidence: "money-route heuristic matched but no @venlyfinance/sdk import was found",
          fix: "Wrap this route with @venlyfinance/sdk, or suppress if it is an unrelated consumer-owned ledger.",
        });
      }
      if (!isServerFile(file)) {
        for (const match of file.source.matchAll(/\bclientSecret\b/g)) {
          addSourceFinding(file, {
            rule: "client-secret-outside-server",
            severity: "error",
            line: lineFor(file.source, match.index ?? 0),
            evidence: "clientSecret appears outside a server-only file",
            fix: "Move the secret into a server route or server-only module.",
          });
        }
      }
    }

    const proxyImported = files.some((file) =>
      importsFrom(file.source, "@venlyfinance/react").includes("proxyClientOptions"),
    );
    if (!proxyImported) {
      addProjectFinding({
        rule: "proxy-client-options-missing",
        severity: "warn",
        evidence: "backend-proxy profile has no browser-side proxyClientOptions import",
        fix: "Use proxyClientOptions() in the browser provider, or suppress for a server-only consumer.",
      });
    }
  }

  for (const file of files) {
    if (
      /\buseEffect\b/.test(file.source) &&
      /\bset(?:Interval|Timeout)\b/.test(file.source) &&
      /(?:status|state)/i.test(file.source) &&
      /\b(?:transfer|ramp)/i.test(file.source)
    ) {
      const match = /\buseEffect\b/.exec(file.source);
      addSourceFinding(file, {
        rule: "status-polling",
        severity: "warn",
        line: lineFor(file.source, match?.index ?? 0),
        evidence: "useEffect timer polling appears beside transfer/ramp state",
        fix: "Use useStagedTransfer or useRampLifecycle for lifecycle polling.",
      });
    }

    const store = /(?:^|\n)\s*export\s+(?:const|let)\s+(transfers|balances|payouts|rampRequests)\s*=\s*(?:\[|new\s+(?:Map|Set)\b)/g;
    for (const match of file.source.matchAll(store)) {
      addSourceFinding(file, {
        rule: "in-memory-money-store",
        severity: "warn",
        line: lineFor(file.source, match.index ?? 0),
        evidence: `module exports mutable in-memory money state named ${match[1]}`,
        fix: "Use @venlyfinance/react hooks/flows or the SDK; suppress only for a deliberate fixture.",
      });
    }
  }

  findings.sort(
    (a, b) =>
      a.path.localeCompare(b.path) ||
      (a.line ?? 0) - (b.line ?? 0) ||
      a.rule.localeCompare(b.rule),
  );
  const errors = findings.filter((finding) => finding.severity === "error").length;
  const warnings = findings.length - errors;
  return {
    profile,
    findings,
    summary: `${errors} error(s), ${warnings} warning(s) across ${files.length} file(s)`,
  };
}

const SKIP_DIRS = new Set(["node_modules", ".git", "dist"]);

function braceExpand(pattern: string): string[] {
  const match = /\{([^{}]*)\}/.exec(pattern);
  if (!match) return [pattern];
  const before = pattern.slice(0, match.index);
  const after = pattern.slice(match.index + match[0].length);
  return (match[1] ?? "").split(",").flatMap((option) => braceExpand(before + option + after));
}

function patternToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^$()|[\]\\?]/g, "\\$&");
  const translated = escaped
    .replace(/\*\*\//g, "\u0000")
    .replace(/\*\*/g, "\u0001")
    .replace(/\*/g, "[^/]*")
    .replace(/\u0000/g, "(?:.*/)?")
    .replace(/\u0001/g, ".*");
  return new RegExp(`^${translated}$`);
}

function walk(dir: string, into: string[]): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(join(dir, entry.name), into);
    } else if (entry.isFile()) {
      into.push(join(dir, entry.name));
    }
  }
}

function expandPattern(pattern: string, cwd: string): string[] {
  const results: string[] = [];
  for (const variant of braceExpand(pattern)) {
    const segments = variant.split("/");
    const firstWild = segments.findIndex((segment) => segment.includes("*"));
    if (firstWild === -1) {
      if (existsSync(join(cwd, variant)) && statSync(join(cwd, variant)).isFile()) results.push(variant);
      continue;
    }
    const staticPrefix = segments.slice(0, firstWild).join("/");
    const root = staticPrefix ? join(cwd, staticPrefix) : cwd;
    const files: string[] = [];
    walk(root, files);
    const matcher = patternToRegExp(variant);
    for (const file of files) {
      const rel = relative(cwd, file).split("\\").join("/");
      if (matcher.test(rel)) results.push(rel);
    }
  }
  return [...new Set(results)].sort();
}

function expandPatterns(patterns: string[], cwd: string): string[] {
  return [...new Set(patterns.flatMap((pattern) => expandPattern(pattern, cwd)))];
}

function findPackageJson(file: string, cwd: string): string | undefined {
  let dir = dirname(resolve(cwd, file));
  while (true) {
    const candidate = join(dir, "package.json");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

function parseArgs(args: string[]): {
  patterns: string[];
  profile?: VerifyProfile;
  error?: string;
} {
  const patterns: string[] = [];
  let profile: VerifyProfile | undefined;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index] ?? "";
    if (arg === "--profile") {
      const value = args[++index];
      if (value !== "direct-sdk" && value !== "backend-proxy") {
        return { patterns, error: "--profile must be direct-sdk or backend-proxy" };
      }
      profile = value;
    } else if (arg.startsWith("--profile=")) {
      const value = arg.slice("--profile=".length);
      if (value !== "direct-sdk" && value !== "backend-proxy") {
        return { patterns, error: "--profile must be direct-sdk or backend-proxy" };
      }
      profile = value;
    } else if (arg.startsWith("-")) {
      return { patterns, error: `Unknown option: ${arg}` };
    } else {
      patterns.push(arg);
    }
  }
  return { patterns, profile };
}

export async function runVerifyCli(
  args: string[],
  out: NodeJS.WritableStream = process.stdout,
  err: NodeJS.WritableStream = process.stderr,
): Promise<0 | 1 | 2> {
  const parsed = parseArgs(args);
  if (parsed.error || parsed.patterns.length === 0) {
    if (parsed.error) err.write(`${parsed.error}\n`);
    err.write(
      'Usage: verify [--profile direct-sdk|backend-proxy] "<glob>" [more globs or files]\n' +
        '  e.g. verify "src/**/*.{ts,tsx}"\n' +
        "Exits 1 on any error-severity finding, 2 when nothing matched.\n",
    );
    return 2;
  }

  const cwd = process.cwd();
  const files = expandPatterns(parsed.patterns, cwd);
  if (files.length === 0) {
    err.write(`Nothing matched: ${parsed.patterns.join(" ")}\n`);
    return 2;
  }

  const groups = new Map<string, string[]>();
  for (const file of files) {
    const packagePath = findPackageJson(file, cwd) ?? join(cwd, "package.json");
    groups.set(packagePath, [...(groups.get(packagePath) ?? []), file]);
  }

  let errors = 0;
  let warnings = 0;
  for (const [packagePath, groupFiles] of [...groups.entries()].sort()) {
    let packageJson: Record<string, unknown> = {};
    if (existsSync(packagePath)) {
      try {
        packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
      } catch (error) {
        err.write(`Invalid package.json at ${relative(cwd, packagePath)}: ${(error as Error).message}\n`);
        return 2;
      }
    }
    const result = verifyRuntimeContract({
      files: groupFiles.map((path) => ({ path, source: readFileSync(path, "utf8") })),
      packageJson,
      profile: parsed.profile,
    });
    out.write(`profile: ${result.profile}\n`);
    for (const finding of result.findings) {
      if (finding.severity === "error") errors++;
      else warnings++;
      const line = finding.line === undefined ? "" : `:${finding.line}`;
      out.write(`${finding.path}${line}  ${finding.severity}  ${finding.rule}  ${finding.evidence}\n`);
      out.write(`  fix: ${finding.fix}\n`);
    }
  }
  out.write(`${errors} error(s), ${warnings} warning(s) across ${files.length} file(s)\n`);
  return errors > 0 ? 1 : 0;
}
