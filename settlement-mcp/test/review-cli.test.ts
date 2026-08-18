/**
 * The `review` CLI: glob expansion, exit-code contract, and the kit
 * regression - the design audit run over the registry's own screens must
 * report zero error-severity findings, or a rule is too greedy to live with.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PassThrough } from "node:stream";
import { expandPatterns, runReviewCli } from "../src/review-cli.js";
import { reviewScreenSource } from "../src/frontend.js";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

function capture(): { stream: PassThrough; text: () => string } {
  const stream = new PassThrough();
  const chunks: Buffer[] = [];
  stream.on("data", (c) => chunks.push(Buffer.from(c)));
  return { stream, text: () => Buffer.concat(chunks).toString("utf8") };
}

async function runFrom(cwd: string, args: string[]) {
  const prev = process.cwd();
  process.chdir(cwd);
  const out = capture();
  const err = capture();
  try {
    const code = await runReviewCli(args, out.stream, err.stream);
    return { code, out: out.text(), err: err.text() };
  } finally {
    process.chdir(prev);
  }
}

test("expandPatterns: ** and * find the kit's block sources", () => {
  const files = expandPatterns(["ui/registry/**/*.tsx"], repoRoot);
  assert.ok(files.length >= 15, `expected the kit's tsx sources, got ${files.length}`);
  assert.ok(files.every((f) => f.endsWith(".tsx")));
  assert.ok(files.some((f) => f.endsWith("blocks/receive.tsx")));
  assert.ok(files.every((f) => !f.includes("node_modules")));
});

test("expandPatterns: brace alternation expands", () => {
  const files = expandPatterns(["ui/registry/{blocks,components}/*.tsx"], repoRoot);
  assert.ok(files.some((f) => f.includes("blocks/")));
  assert.ok(files.some((f) => f.includes("components/")));
});

test("expandPatterns: a literal path passes through untouched", () => {
  const files = expandPatterns(["ui/registry/lib/money.tsx"], repoRoot);
  assert.deepEqual(files, ["ui/registry/lib/money.tsx"]);
});

test("review CLI: exit 0 over the kit's own screens (warnings allowed)", async () => {
  const result = await runFrom(repoRoot, [
    "ui/registry/**/*.tsx",
    "examples/mock-bank/src/**/*.tsx",
  ]);
  assert.equal(result.code, 0, `stdout:\n${result.out}\nstderr:\n${result.err}`);
  assert.match(result.out, /0 error\(s\)/);
});

test("review CLI: exit 1 on a screen with error-severity findings", async () => {
  const result = await runFrom(fileURLToPath(new URL("..", import.meta.url)), [
    "test/fixtures/bad-screen.tsx",
  ]);
  assert.equal(result.code, 1);
  assert.match(result.out, /raw-colour/);
  assert.match(result.out, /invented-timing-claim/);
});

test("review CLI: exit 2 when a pattern matches nothing", async () => {
  const result = await runFrom(repoRoot, ["ui/registry/**/*.nothing-matches-this"]);
  assert.equal(result.code, 2);
});

test("review CLI: exit 2 with usage on no arguments", async () => {
  const result = await runFrom(repoRoot, []);
  assert.equal(result.code, 2);
  assert.match(result.err, /Usage/);
});

test("kit regression: zero error-severity findings across registry and example sources", () => {
  const files = expandPatterns(
    ["ui/registry/**/*.tsx", "examples/mock-bank/src/**/*.tsx"],
    repoRoot,
  );
  assert.ok(files.length >= 15);
  const errors: string[] = [];
  for (const file of files) {
    const findings = reviewScreenSource(readFileSync(`${repoRoot}/${file}`, "utf8"));
    for (const finding of findings) {
      if (finding.severity === "error") errors.push(`${file}: ${finding.rule} ${finding.evidence}`);
    }
  }
  assert.deepEqual(errors, [], "a rule fired error-severity on the kit's own sources");
});
