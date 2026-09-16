#!/usr/bin/env node
// Vendors the Finance API contract into specs/finance.yaml from a served
// OpenAPI document (springdoc /v3/api-docs JSON). The served contract is the
// contract of record; this script makes refreshing it a deterministic,
// reviewable diff instead of a hand edit.
//
//   node scripts/vendor-finance-spec.mjs <path-or-url> [--out specs/finance.yaml]
//
// Transformations applied, both documented here because they are load-bearing:
// 1. Paths are stripped of the leading `/v1` segment. The client's per-
//    environment base URLs already end in `/v1`, and the mock transport and
//    generated shape tables key on the unprefixed form.
// 2. A provenance header records the source KIND, retrieval date and version,
//    so the YAML itself says which served contract it mirrors. The header
//    deliberately never records a local absolute path or a host: specs/ ships
//    inside the published npm package, so anything written here is public.
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { stringify } from "yaml";

const src = process.argv[2];
if (!src) {
  console.error("usage: node scripts/vendor-finance-spec.mjs <path-or-url> [--out specs/finance.yaml]");
  process.exit(2);
}
const outIdx = process.argv.indexOf("--out");
const out = outIdx > -1 ? process.argv[outIdx + 1] : "specs/finance.yaml";

let raw;
if (/^https?:\/\//.test(src)) {
  const res = await fetch(src);
  if (!res.ok) throw new Error(`fetch ${src} -> HTTP ${res.status}`);
  raw = await res.text();
} else {
  raw = readFileSync(src, "utf8");
}
const spec = JSON.parse(raw);

const paths = {};
for (const [p, item] of Object.entries(spec.paths ?? {})) {
  const stripped = p.startsWith("/v1/") ? p.slice(3) : p;
  if (paths[stripped]) throw new Error(`path collision after /v1 strip: ${stripped}`);
  paths[stripped] = item;
}
spec.paths = paths;

// Describes WHERE the contract came from without publishing where it lives.
// A served document contributes its path only (never scheme, host or query);
// a local export contributes its basename only. Callers refresh with the usage
// line above, so the exact location is operator context, not artifact content.
function describeSource(s) {
  if (/^https?:\/\//.test(s)) {
    try {
      return `springdoc ${new URL(s).pathname}`;
    } catch {
      return "springdoc document";
    }
  }
  // Split on both separators: basename() alone leaves a Windows path intact on
  // POSIX, which the guard below would then reject as a refresh failure.
  return `springdoc export (${basename(s.replace(/\\/g, "/"))})`;
}

const today = new Date().toISOString().slice(0, 10);
const sourceLabel = describeSource(src);
// specs/ ships in the npm tarball. A location that escaped into the header
// would be published on the next release, so fail the refresh instead.
if (/(^|[\s(])([A-Za-z]:\\|\/(Users|home|root)\/)/.test(sourceLabel)) {
  throw new Error(`refusing to write a filesystem path into a published spec header: ${sourceLabel}`);
}
const header = [
  `# Vendored Finance API contract. DO NOT hand-edit; refresh with:`,
  `#   node scripts/vendor-finance-spec.mjs <source>`,
  `# source: ${sourceLabel}`,
  `# retrieved: ${today}`,
  `# upstream version: ${spec.info?.version ?? "unknown"}`,
  `# note: paths are stripped of the /v1 prefix (client base URLs carry it).`,
].join("\n");

writeFileSync(out, header + "\n" + stringify(spec, { aliasDuplicateObjects: false }));
console.log(`wrote ${out} (${spec.info?.version}); ${Object.keys(paths).length} paths`);
