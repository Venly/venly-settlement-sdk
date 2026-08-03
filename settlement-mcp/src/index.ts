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
  const armed = process.env[LIVE_FLAG] === "1";
  process.stderr.write(
    `venly-finance-mcp started in ${client.environment}. write tools ${armed ? "ARMED (VENLY_MCP_LIVE=1)" : "DISARMED (read-only default)"}.\n`,
  );
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${(err as Error).message}\n`);
  process.exit(1);
});
