/**
 * Tier 3: x402 tool. Position + stub, no execution.
 *
 * The machine-to-machine agent-payments rail is consolidating on x402
 * (Cloudflare + Coinbase x402 Foundation; MCP tools return HTTP 402). This tool
 * returns an HTTP-402-shaped quote for a settlement action, documenting the rail
 * without executing it. It NEVER moves funds and NEVER calls a facilitator.
 *
 * Shape follows the x402 `PaymentRequirements` model: a 402 response carrying an
 * `accepts` array of payment options (scheme, network, asset, payTo, amount).
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

function jsonResult(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

/** Minimal chain -> x402 network + default USDC asset address map (stub data). */
const CHAIN_META: Record<string, { network: string; usdc: string }> = {
  base: {
    network: "base",
    usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  },
  "base-sepolia": {
    network: "base-sepolia",
    usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  },
  polygon: {
    network: "polygon",
    usdc: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
  },
};

export function registerX402Tools(server: McpServer): void {
  server.registerTool(
    "quote_x402_payment",
    {
      title: "Quote an x402 machine payment (stub)",
      description:
        "Return an HTTP-402-shaped quote (price, asset, payTo, chain) for a " +
        "settlement action on the x402 machine-to-machine rail. STUB: documents " +
        "the rail and returns a well-formed 402 PaymentRequirements object. It does " +
        "NOT execute a payment, call a facilitator, or move funds. Production x402 " +
        "settlement needs a facilitator decision and live rails.",
      inputSchema: {
        action: z
          .string()
          .describe("The settlement action being priced, e.g. 'stage_transfer' or 'reconcile'"),
        amount: z.string().describe("Price as a decimal string, e.g. \"1.50\""),
        asset: z.string().default("USDC").describe("Settlement asset symbol"),
        chain: z
          .enum(["base", "base-sepolia", "polygon"])
          .default("base")
          .describe("Settlement chain"),
        payTo: z
          .string()
          .describe("Recipient address that would receive the machine payment"),
        resource: z
          .string()
          .optional()
          .describe("Optional resource/endpoint the payment unlocks"),
        description: z.string().optional(),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ action, amount, asset, chain, payTo, resource, description }) => {
      const meta = CHAIN_META[chain] ?? CHAIN_META.base;
      const quote = {
        mode: "stub",
        httpStatus: 402,
        error: "payment_required",
        x402Version: 1,
        action,
        accepts: [
          {
            scheme: "exact",
            network: meta.network,
            asset,
            // For USDC the canonical on-chain asset address for the network.
            assetAddress: asset.toUpperCase() === "USDC" ? meta.usdc : undefined,
            maxAmountRequired: amount,
            payTo,
            resource: resource ?? `venly-settlement:${action}`,
            description:
              description ?? `x402 quote for settlement action '${action}' (stub, not executable).`,
            mimeType: "application/json",
            maxTimeoutSeconds: 60,
          },
        ],
        note:
          "This is a position stub. No payment is executed and no facilitator is " +
          "called. Venly's stance: the MCP is the human-gated operator surface; " +
          "x402 is the machine-to-machine rail.",
      };
      return jsonResult(quote);
    },
  );
}
