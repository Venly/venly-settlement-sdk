#!/usr/bin/env node

import { sanitizeErrorMessage } from "../dist/results.js";
import { runStagingSmoke } from "../dist/staging-smoke.js";

try {
  await runStagingSmoke();
  console.log("\nSTAGING SMOKE PASSED: discovery and reads succeeded; writes stayed dry-run.");
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\nSTAGING SMOKE FAILED: ${sanitizeErrorMessage(message)}`);
  process.exitCode = 1;
}
