#!/usr/bin/env node
/**
 * Entry point. Builds the server over the official Venly Finance SDK and
 * connects it over stdio. Read-only by default outside explicit mock mode;
 * staging/production write tools stay disarmed unless VENLY_MCP_LIVE=1 and
 * credentials are set.
 *
 * Credentials are read from env inside SdkVenlyClient and never logged.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";
import { SdkVenlyClient } from "./client/sdk-client.js";
import { LIVE_FLAG } from "./constants.js";

async function main(): Promise<void> {
  const client = SdkVenlyClient.fromEnv(process.env);
  const server = createServer({ client, env: process.env });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Log to stderr only (stdout is the MCP channel). No credentials here.
  // The banner states what writes actually do in THIS environment - wording is
  // the agent's safety surface, so it must match observed behavior exactly.
  const armed = process.env[LIVE_FLAG] === "1";
  const writeState =
    client.environment === "mock"
      ? "writes execute against local fixtures - no network, no credentials, nothing real"
      : armed
        ? "writes ARMED (VENLY_MCP_LIVE=1): confirmed writes hit the live API"
        : "writes DISARMED: mutations return dry-run previews (arming needs confirm:true + VENLY_MCP_LIVE=1 + credentials)";
  process.stderr.write(`venly-finance-mcp started in ${client.environment}. ${writeState}.\n`);
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${(err as Error).message}\n`);
  process.exit(1);
});
