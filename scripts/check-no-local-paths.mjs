#!/usr/bin/env node
// Fails if a local filesystem path appears in a tracked file.
//
// This repo is public and `specs/*.yaml` ships inside the npm tarball, so a
// path written by a local tool is published on the next release. That happened:
// vendor-finance-spec.mjs recorded `# source: <absolute path>`, and
// @venlyfinance/sdk 0.5.0, 0.7.0 and 0.8.0 each shipped a home directory, a
// worktree branch name and an internal project name to the public registry.
//
// The existing `provenance` CI job cannot catch this. It greps a whole-word
// term list held in a repo secret; a filesystem path is not a term in a list.
// This check is the shape-based counterpart and runs beside it, not instead.
//
// Wired into `npm run check`, so it gates every CI run AND every publish
// without needing a workflow edit.
import { execFileSync } from "node:child_process";

// Home-directory roots on the three platforms a contributor might use. Anchored
// so an API path like "/v1/accounts" or a URL path cannot match.
const PATTERNS = [
  "/Users/[A-Za-z0-9._-]+/",
  "/home/[A-Za-z0-9._-]+/",
  "[A-Za-z]:\\\\Users\\\\",
];

// Lockfiles legitimately carry resolved paths in some npm versions, and they do
// not ship (`files` does not include them). Excluded for the same reason the
// provenance job excludes them.
const EXCLUDE = [":!package-lock.json", ":!*/package-lock.json"];

let hits = "";
try {
  hits = execFileSync(
    "git",
    ["grep", "-I", "-n", "-E", PATTERNS.join("|"), "--", ".", ...EXCLUDE],
    { encoding: "utf8" },
  );
} catch (err) {
  // git grep exits 1 when nothing matched, which is the success case here.
  if (err.status === 1) {
    console.log("no local filesystem paths in tracked files");
    process.exit(0);
  }
  throw err;
}

console.error("Local filesystem paths found in tracked files:\n");
console.error(hits.trimEnd());
console.error(
  "\nThis repository is public and specs/*.yaml ships in the npm tarball." +
    "\nRecord a source KIND rather than a location; see scripts/vendor-finance-spec.mjs.",
);
process.exit(1);
