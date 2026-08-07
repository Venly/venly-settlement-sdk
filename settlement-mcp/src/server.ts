/**
 * Build the MCP server: registers all three tool tiers over an injected
 * VenlyClient. Kept transport-agnostic so tests can construct the server with a
 * mock client and no network.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  ENVIRONMENT_FLAG,
  SERVER_NAME,
  SERVER_VERSION,
  resolveVenlyEnvironment,
} from "./constants.js";
import type { VenlyClient } from "./types.js";
import type { EnvLike } from "./safety.js";
import { registerReadTools } from "./tools/read-tools.js";
import { registerWriteTools } from "./tools/write-tools.js";
import { registerX402Tools } from "./tools/x402-tools.js";
import { registerBuilderResources } from "./resources.js";
import { registerBuilderPrompts } from "./prompts.js";
import { registerFrontendTools } from "./frontend.js";

export interface CreateServerOptions {
  client: VenlyClient;
  /** Env used for the write gate. Defaults to process.env. */
  env?: EnvLike;
}

export function createServer(options: CreateServerOptions): McpServer {
  const env = options.env ?? process.env;

  // The write gate auto-arms every mutation in mock mode on the assumption
  // that the injected client is also mock. Refuse to start when a client that
  // declares its environment disagrees with the env the gate will read –
  // otherwise a mock env over a live client would execute un-gated writes.
  const gateEnvironment = resolveVenlyEnvironment(env);
  if (
    options.client.environment !== undefined &&
    options.client.environment !== gateEnvironment
  ) {
    throw new Error(
      `client targets "${options.client.environment}" but ${ENVIRONMENT_FLAG} resolves to ` +
        `"${gateEnvironment}"; the write gate and client must agree on the environment`,
    );
  }

  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  registerReadTools(server, options.client);
  registerWriteTools(server, options.client, env);
  registerX402Tools(server);
  registerFrontendTools(server);
  registerBuilderResources(server);
  registerBuilderPrompts(server);

  return server;
}
