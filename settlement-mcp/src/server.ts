/**
 * Build the MCP server: registers all three tool tiers over an injected
 * VenlyClient. Kept transport-agnostic so tests can construct the server with a
 * mock client and no network.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SERVER_NAME, SERVER_VERSION } from "./constants.js";
import type { VenlyClient } from "./types.js";
import type { EnvLike } from "./safety.js";
import { registerReadTools } from "./tools/read-tools.js";
import { registerWriteTools } from "./tools/write-tools.js";
import { registerX402Tools } from "./tools/x402-tools.js";

export interface CreateServerOptions {
  client: VenlyClient;
  /** Env used for the write gate. Defaults to process.env. */
  env?: EnvLike;
}

export function createServer(options: CreateServerOptions): McpServer {
  const env = options.env ?? process.env;
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  registerReadTools(server, options.client);
  registerWriteTools(server, options.client, env);
  registerX402Tools(server);

  return server;
}
