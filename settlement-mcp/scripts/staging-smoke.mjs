#!/usr/bin/env node

import { sanitizeErrorMessage } from "../dist/results.js";
import { runStagingSmoke } from "../dist/staging-smoke.js";

try {
  await runStagingSmoke();
  console.log("\nSTAGING SMOKE PASSED: discovery and reads succeeded; the confirmed write was refused at the sandbox boundary before any request was sent; nothing was mutated.");
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\nSTAGING SMOKE FAILED: ${sanitizeErrorMessage(message)}`);
  process.exitCode = 1;
}
