// `review` subcommand: the review_screen design audit as a CI gate.
//
//   npx @venlyfinance/settlement-mcp review "src/**/*.tsx"
//
// Exit codes: 0 clean (warnings allowed, printed either way) · 1 at least one
// error-severity finding · 2 usage error or a pattern that matched nothing
// (a typo'd path must never pass CI silently).
//
// Patterns are self-expanded (**, *, {a,b}) so the quoted form works on any
// shell; unquoted shell-expanded literal paths work too. No dependencies.
// (Line comments on purpose: a glob's **/ would terminate a block comment.)
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { reviewScreenSource } from "./frontend.js";

const SKIP_DIRS = new Set(["node_modules", ".git", "dist"]);

function braceExpand(pattern: string): string[] {
  const m = /\{([^{}]*)\}/.exec(pattern);
  if (!m) return [pattern];
  const before = pattern.slice(0, m.index);
  const after = pattern.slice(m.index + m[0].length);
  const out: string[] = [];
  for (const option of m[1].split(",")) {
    out.push(...braceExpand(before + option + after));
  }
  return out;
}

function patternToRegExp(pattern: string): RegExp {
  // Escape everything regex-special except the glob characters we translate.
  const escaped = pattern.replace(/[.+^$()|[\]\\?]/g, "\\$&");
  const translated = escaped
    .replace(/\*\*\//g, "\u0000") // **/ may match zero segments
    .replace(/\*\*/g, "\u0001") // a bare ** matches anything
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

/** Expand one glob pattern (posix-style separators) relative to cwd. */
export function expandPattern(pattern: string, cwd: string): string[] {
  const results: string[] = [];
  for (const variant of braceExpand(pattern)) {
    const segments = variant.split("/");
    const firstWild = segments.findIndex((s) => s.includes("*"));
    if (firstWild === -1) {
      if (existsSync(join(cwd, variant)) && statSync(join(cwd, variant)).isFile()) {
        results.push(variant);
      }
      continue;
    }
    const staticPrefix = segments.slice(0, firstWild).join("/");
    const root = staticPrefix ? join(cwd, staticPrefix) : cwd;
    const files: string[] = [];
    walk(root, files);
    const matcher = patternToRegExp(variant);
    for (const file of files) {
      const rel = file
        .slice(cwd.length + (cwd.endsWith("/") ? 0 : 1))
        .split("\\")
        .join("/");
      if (matcher.test(rel)) results.push(rel);
    }
  }
  return [...new Set(results)].sort();
}

export function expandPatterns(patterns: string[], cwd: string): string[] {
  const out: string[] = [];
  for (const pattern of patterns) {
    if (/[*{]/.test(pattern)) {
      out.push(...expandPattern(pattern.split("\\").join("/"), cwd));
    } else {
      out.push(pattern); // shell-expanded or literal; existence checked by caller
    }
  }
  return [...new Set(out)];
}

export async function runReviewCli(
  args: string[],
  out: NodeJS.WritableStream = process.stdout,
  err: NodeJS.WritableStream = process.stderr,
): Promise<0 | 1 | 2> {
  const patterns = args.filter((a) => !a.startsWith("-"));
  if (patterns.length === 0) {
    err.write(
      'Usage: review "<glob>" [more globs or files]\n' +
        '  e.g. review "src/**/*.tsx"\n' +
        "Exits 1 on any error-severity finding, 2 when nothing matched.\n",
    );
    return 2;
  }

  const cwd = process.cwd();
  const files = expandPatterns(patterns, cwd);
  const missing = files.filter((f) => !existsSync(f));
  if (missing.length > 0) {
    err.write(`No such file: ${missing.join(", ")}\n`);
    return 2;
  }
  if (files.length === 0) {
    err.write(`Nothing matched: ${patterns.join(" ")}\n`);
    return 2;
  }

  let errors = 0;
  let warnings = 0;
  for (const file of files) {
    const findings = reviewScreenSource(readFileSync(file, "utf8"));
    for (const finding of findings) {
      if (finding.severity === "error") errors++;
      else warnings++;
      const line = finding.line === undefined ? "" : `:${finding.line}`;
      out.write(`${file}${line}  ${finding.severity}  ${finding.rule}  ${finding.evidence}\n`);
      out.write(`  fix: ${finding.fix}\n`);
    }
  }
  out.write(
    `${errors} error(s), ${warnings} warning(s) across ${files.length} file(s)\n`,
  );
  return errors > 0 ? 1 : 0;
}
