/**
 * Tier 2: WRITE tools. Present but DISARMED by default.
 *
 * Every write tool is dry-run UNLESS all three hold: confirm===true AND
 * VENLY_MCP_LIVE==="1" AND credentials present (see safety.ts). When not armed
 * it returns the exact request it WOULD send and never touches the transport.
 * This is the core safety property, proven by test/write-tools.test.ts.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { VenlyClient } from "../types.js";
import { buildDryRun, evaluateWriteGate, type EnvLike } from "../safety.js";

function jsonResult(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

function errorResult(message: string) {
  return {
    content: [{ type: "text" as const, text: `Error: ${message}` }],
    isError: true,
  };
}

const WRITE_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
} as const;

const confirmField = z
  .boolean()
  .default(false)
  .describe(
    "Must be true to attempt a live call. Even then, VENLY_MCP_LIVE=1 and " +
      "credentials are also required, otherwise the tool dry-runs.",
  );

export function registerWriteTools(
  server: McpServer,
  client: VenlyClient,
  env: EnvLike,
): void {
  server.registerTool(
    "stage_transfer",
    {
      title: "Stage a fiat transfer (dry-run by default)",
      description:
        "Stage a fiat-to-crypto transfer (finance POST /accounts/{senderAccountId}/transfers/fiat). " +
        "DISARMED by default: returns the exact request it would send unless " +
        "confirm:true AND VENLY_MCP_LIVE=1 AND credentials are present.",
      inputSchema: {
        senderAccountId: z.string().describe("Account initiating the transfer"),
        receiverAccountId: z.string(),
        fiatAmount: z.string().describe("Decimal string, e.g. \"1000.00\""),
        fiatCurrency: z.string().describe("e.g. EUR"),
        cryptocurrency: z.string().optional(),
        description: z.string().optional(),
        merchantReference: z.string().optional(),
        confirm: confirmField,
      },
      annotations: WRITE_ANNOTATIONS,
    },
    async ({ senderAccountId, confirm, ...rest }) => {
      const gate = evaluateWriteGate(confirm, env);
      const body = {
        receiverAccountId: rest.receiverAccountId,
        fiatAmount: rest.fiatAmount,
        fiatCurrency: rest.fiatCurrency,
        cryptocurrency: rest.cryptocurrency,
        description: rest.description,
        merchantReference: rest.merchantReference,
      };
      if (!gate.armed) {
        return jsonResult(
          buildDryRun(
            "stage_transfer",
            "POST",
            "finance",
            `/accounts/${senderAccountId}/transfers/fiat`,
            body,
            gate,
          ),
        );
      }
      try {
        const result = await client.createFiatTransfer(senderAccountId, body);
        return jsonResult({ mode: "live", result });
      } catch (e) {
        return errorResult((e as Error).message);
      }
    },
  );

  server.registerTool(
    "approve_ramp_request",
    {
      title: "Approve a ramp request (dry-run by default)",
      description:
        "Approve a ramp request through four-eyes (fundflow POST /v1/ramp-requests/{id}/approve). " +
        "Requires the current optimistic-locking version. The API enforces that an " +
        "identity cannot approve a request it created; this tool surfaces that state, " +
        "it does not bypass it. DISARMED by default.",
      inputSchema: {
        id: z.string().describe("Ramp request UUID"),
        version: z
          .number()
          .int()
          .describe("Current version (from get_ramp_request) for optimistic locking"),
        confirm: confirmField,
      },
      annotations: WRITE_ANNOTATIONS,
    },
    async ({ id, version, confirm }) => {
      const gate = evaluateWriteGate(confirm, env);
      const body = { version };
      if (!gate.armed) {
        return jsonResult(
          buildDryRun(
            "approve_ramp_request",
            "POST",
            "fundflow",
            `/v1/ramp-requests/${id}/approve`,
            body,
            gate,
          ),
        );
      }
      try {
        const result = await client.approveRampRequest(id, body);
        return jsonResult({ mode: "live", result });
      } catch (e) {
        return errorResult((e as Error).message);
      }
    },
  );

  server.registerTool(
    "reject_ramp_request",
    {
      title: "Reject a ramp request (dry-run by default)",
      description:
        "Reject a ramp request (fundflow POST /v1/ramp-requests/{id}/reject). " +
        "Requires the current optimistic-locking version. DISARMED by default.",
      inputSchema: {
        id: z.string().describe("Ramp request UUID"),
        version: z
          .number()
          .int()
          .describe("Current version (from get_ramp_request) for optimistic locking"),
        confirm: confirmField,
      },
      annotations: WRITE_ANNOTATIONS,
    },
    async ({ id, version, confirm }) => {
      const gate = evaluateWriteGate(confirm, env);
      const body = { version };
      if (!gate.armed) {
        return jsonResult(
          buildDryRun(
            "reject_ramp_request",
            "POST",
            "fundflow",
            `/v1/ramp-requests/${id}/reject`,
            body,
            gate,
          ),
        );
      }
      try {
        const result = await client.rejectRampRequest(id, body);
        return jsonResult({ mode: "live", result });
      } catch (e) {
        return errorResult((e as Error).message);
      }
    },
  );

  server.registerTool(
    "create_payment_link",
    {
      title: "Create a fiat-to-crypto payment link (dry-run by default)",
      description:
        "Create a pay-in link (finance POST /accounts/{accountId}/fiat-to-crypto/payment-links). " +
        "DISARMED by default.",
      inputSchema: {
        accountId: z.string(),
        inAmount: z.string().describe("Decimal string, e.g. \"250.00\""),
        inCurrency: z.string().describe("e.g. EUR"),
        outCryptocurrency: z.string().optional().describe("e.g. USDC"),
        redirectUrl: z.string().optional(),
        externalRef: z.string().optional(),
        confirm: confirmField,
      },
      annotations: WRITE_ANNOTATIONS,
    },
    async ({ accountId, confirm, ...rest }) => {
      const gate = evaluateWriteGate(confirm, env);
      const body = {
        inAmount: rest.inAmount,
        inCurrency: rest.inCurrency,
        outCryptocurrency: rest.outCryptocurrency,
        redirectUrl: rest.redirectUrl,
        externalRef: rest.externalRef,
      };
      if (!gate.armed) {
        return jsonResult(
          buildDryRun(
            "create_payment_link",
            "POST",
            "finance",
            `/accounts/${accountId}/fiat-to-crypto/payment-links`,
            body,
            gate,
          ),
        );
      }
      try {
        const result = await client.createPaymentLink(accountId, body);
        return jsonResult({ mode: "live", result });
      } catch (e) {
        return errorResult((e as Error).message);
      }
    },
  );
}
