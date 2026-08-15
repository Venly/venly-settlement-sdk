#!/usr/bin/env node
/**
 * Copies the canonical root AGENTS.md into every surface that has to carry it:
 * the two published packages that are not the root package, and the registry
 * source that installs it into a consumer's repo.
 *
 * The copies are committed, like ui/r/, so any consumer or static host reads a
 * plain file. CI runs this script and fails on a diff, so a copy can never
 * drift from the canonical text.
 */
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(repoRoot, "AGENTS.md");

const targets = ["react/AGENTS.md", "settlement-mcp/AGENTS.md", "ui/registry/AGENTS.md"];

for (const target of targets) {
  const dest = join(repoRoot, target);
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(source, dest);
  console.log(`synced ${target}`);
}
