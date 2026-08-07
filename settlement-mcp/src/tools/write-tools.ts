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
import { errorResult, jsonResult } from "../results.js";
import { normalizeLegacyFiatTransfer } from "../client/sdk-client.js";

function executionResult(gate: ReturnType<typeof evaluateWriteGate>, result: unknown) {
  return jsonResult({
    mode: gate.environment === "mock" ? "mock" : "live",
    // Explicit on every mutation result: this call DID execute (against local
    // fixtures in mock, against the real API when armed).
    dryRun: false,
    environment: gate.environment,
    result,
  });
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

const addressSchema = z
  .object({
    addressLine1: z.string().optional(),
    addressLine2: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    postalCode: z.string().optional(),
    country: z.string().regex(/^[A-Z]{2}$/).optional(),
  })
  .optional();

const partySchema = z.object({
  partyType: z.enum(["INDIVIDUAL", "ORGANISATION"]),
  externalId: z.string().optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  name: z.string().optional(),
  vatNumber: z.string().optional(),
  address: addressSchema,
});

function partyValidationError(party: z.infer<typeof partySchema>): string | undefined {
  if (party.partyType === "INDIVIDUAL" && (!party.firstName || !party.lastName)) {
    return "INDIVIDUAL parties require firstName and lastName";
  }
  if (party.partyType === "ORGANISATION" && !party.name) {
    return "ORGANISATION parties require name";
  }
  return undefined;
}

export function registerWriteTools(
  server: McpServer,
  client: VenlyClient,
  env: EnvLike,
): void {
  server.registerTool(
    "create_party",
    {
      title: "Create a customer or organisation party",
      description:
        "Create a Finance party. This creates the party record; it does not complete KYC/KYB. Dry-run by default outside explicit mock mode.",
      inputSchema: {
        partyType: z.enum(["INDIVIDUAL", "ORGANISATION"]),
        externalId: z.string().optional(),
        firstName: z.string().optional(),
        lastName: z.string().optional(),
        name: z.string().optional(),
        vatNumber: z.string().optional(),
        address: addressSchema,
        confirm: confirmField,
      },
      annotations: WRITE_ANNOTATIONS,
    },
    async ({ confirm, ...party }) => {
      const validationError = partyValidationError(party);
      if (validationError) return errorResult(validationError);
      const gate = evaluateWriteGate(confirm, env);
      if (!gate.armed) {
        return jsonResult(buildDryRun("create_party", "POST", "finance", "/parties", party, gate));
      }
      try {
        return executionResult(gate, await client.createParty(party));
      } catch (e) {
        return errorResult((e as Error).message);
      }
    },
  );

  server.registerTool(
    "create_account",
    {
      title: "Create an account and provision its wallet",
      description:
        "Create a Finance account. Venly auto-provisions its wallet on the selected chain. Supply partyId or an inline party. Dry-run by default.",
      inputSchema: {
        externalId: z.string().min(1),
        name: z.string().optional(),
        chain: z.enum(["AVALANCHE", "BASE", "POLYGON"]),
        address: z.string().optional().describe("Required for SELF_CUSTODY tenants"),
        partyId: z.string().optional(),
        party: partySchema.optional(),
        confirm: confirmField,
      },
      annotations: WRITE_ANNOTATIONS,
    },
    async ({ confirm, ...body }) => {
      if (!body.partyId && !body.party) {
        return errorResult("create_account requires partyId or an inline party");
      }
      if (body.party) {
        const validationError = partyValidationError(body.party);
        if (validationError) return errorResult(validationError);
      }
      const gate = evaluateWriteGate(confirm, env);
      if (!gate.armed) {
        return jsonResult(buildDryRun("create_account", "POST", "finance", "/accounts", body, gate));
      }
      try {
        return executionResult(gate, await client.createAccount(body));
      } catch (e) {
        return errorResult((e as Error).message);
      }
    },
  );

  server.registerTool(
    "create_virtual_bank_account",
    {
      title: "Create a EUR receiving account",
      description:
        "Provision a EUR SEPA virtual bank account and conversion target. Outside mock mode the Finance account must have KYC status VERIFIED. Dry-run by default.",
      inputSchema: {
        accountId: z.string(),
        name: z.string().min(1),
        inCurrency: z.literal("EUR"),
        targetCryptocurrency: z.enum(["USDC", "EURC", "USDT", "USDS"]),
        idempotencyKey: z.string().min(1).optional(),
        confirm: confirmField,
      },
      annotations: WRITE_ANNOTATIONS,
    },
    async ({ accountId, confirm, ...input }) => {
      const body = {
        ...input,
        idempotencyKey: input.idempotencyKey ?? crypto.randomUUID(),
      };
      const gate = evaluateWriteGate(confirm, env);
      if (!gate.armed) {
        const dryRun = buildDryRun(
          "create_virtual_bank_account",
          "POST",
          "finance",
          `/accounts/${accountId}/virtual-bank-accounts`,
          body,
          gate,
        );
        dryRun.note += " The account must have KYC status VERIFIED before live provisioning.";
        return jsonResult(dryRun);
      }
      try {
        return executionResult(
          gate,
          await client.createVirtualBankAccount(accountId, body),
        );
      } catch (e) {
        return errorResult((e as Error).message);
      }
    },
  );

  server.registerTool(
    "create_fiat_transfer",
    {
      title: "Create a fiat-denominated internal transfer",
      description:
        "Create an account-to-account transfer using the current Finance OpenAPI fields. Dry-run by default outside explicit mock mode.",
      inputSchema: {
        senderAccountId: z.string(),
        receiverAccountId: z
          .string()
          .optional()
          .describe("Receiver's Venly account id. Exactly one of receiverAccountId / receiverExternalId is required."),
        receiverExternalId: z
          .string()
          .optional()
          .describe("Receiver's integrator-assigned externalId. Exactly one of receiverAccountId / receiverExternalId is required."),
        currency: z.enum(["EUR", "GBP", "USD"]),
        amount: z.number(),
        description: z.string().optional(),
        merchantReference: z.string().optional(),
        idempotencyKey: z.string().min(1).optional(),
        confirm: confirmField,
      },
      annotations: WRITE_ANNOTATIONS,
    },
    async ({ senderAccountId, confirm, ...input }) => {
      if (!input.receiverAccountId === !input.receiverExternalId) {
        return errorResult(
          "Provide exactly one of receiverAccountId or receiverExternalId - a transfer needs one receiver, addressed one way.",
        );
      }
      const body = {
        ...input,
        idempotencyKey: input.idempotencyKey ?? crypto.randomUUID(),
      };
      const gate = evaluateWriteGate(confirm, env);
      if (!gate.armed) {
        return jsonResult(
          buildDryRun(
            "create_fiat_transfer",
            "POST",
            "finance",
            `/accounts/${senderAccountId}/transfers/fiat`,
            body,
            gate,
          ),
        );
      }
      try {
        return executionResult(
          gate,
          await client.createCurrentFiatTransfer(senderAccountId, body),
        );
      } catch (e) {
        return errorResult((e as Error).message);
      }
    },
  );

  server.registerTool(
    "create_crypto_transfer",
    {
      title: "Create a crypto-denominated internal transfer",
      description:
        "Create an account-to-account asset transfer using the current Finance OpenAPI fields. Dry-run by default outside explicit mock mode.",
      inputSchema: {
        senderAccountId: z.string(),
        receiverAccountId: z
          .string()
          .optional()
          .describe("Receiver's Venly account id. Exactly one of receiverAccountId / receiverExternalId is required."),
        receiverExternalId: z
          .string()
          .optional()
          .describe("Receiver's integrator-assigned externalId. Exactly one of receiverAccountId / receiverExternalId is required."),
        chain: z.enum(["AVALANCHE", "BASE", "POLYGON"]),
        asset: z.string().min(1),
        amount: z.number(),
        description: z.string().optional(),
        merchantReference: z.string().optional(),
        idempotencyKey: z.string().min(1).optional(),
        confirm: confirmField,
      },
      annotations: WRITE_ANNOTATIONS,
    },
    async ({ senderAccountId, confirm, ...input }) => {
      if (!input.receiverAccountId === !input.receiverExternalId) {
        return errorResult(
          "Provide exactly one of receiverAccountId or receiverExternalId - a transfer needs one receiver, addressed one way.",
        );
      }
      const body = {
        ...input,
        idempotencyKey: input.idempotencyKey ?? crypto.randomUUID(),
      };
      const gate = evaluateWriteGate(confirm, env);
      if (!gate.armed) {
        return jsonResult(
          buildDryRun(
            "create_crypto_transfer",
            "POST",
            "finance",
            `/accounts/${senderAccountId}/transfers/crypto`,
            body,
            gate,
          ),
        );
      }
      try {
        return executionResult(
          gate,
          await client.createCryptoTransfer(senderAccountId, body),
        );
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
        return executionResult(gate, result);
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
        return executionResult(gate, result);
      } catch (e) {
        return errorResult((e as Error).message);
      }
    },
  );

  server.registerTool(
    "create_payment_session",
    {
      title: "Create a fiat-to-crypto payment session (dry-run by default)",
      description:
        "Create a hosted pay-in session (finance POST " +
        "/accounts/{accountId}/fiat-to-crypto/payment-sessions); redirect the " +
        "payer to the returned paymentUrl. DISARMED by default.",
      inputSchema: {
        accountId: z.string(),
        inAmount: z.string().describe("Decimal string, e.g. \"250.00\""),
        inCurrency: z.string().describe("e.g. EUR"),
        outCryptocurrency: z.string().describe("e.g. USDC"),
        callbackUrl: z.string().describe("Webhook URL notified on completion"),
        successRedirectUrl: z.string().optional(),
        failureRedirectUrl: z.string().optional(),
        externalRef: z.string().optional(),
        idempotencyKey: z
          .string()
          .optional()
          .describe("UUID; generated when omitted"),
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
        callbackUrl: rest.callbackUrl,
        successRedirectUrl: rest.successRedirectUrl,
        failureRedirectUrl: rest.failureRedirectUrl,
        externalRef: rest.externalRef,
        idempotencyKey: rest.idempotencyKey ?? crypto.randomUUID(),
      };
      if (!gate.armed) {
        return jsonResult(
          buildDryRun(
            "create_payment_session",
            "POST",
            "finance",
            `/accounts/${accountId}/fiat-to-crypto/payment-sessions`,
            body,
            gate,
          ),
        );
      }
      try {
        const result = await client.createPayInSession(accountId, body);
        return executionResult(gate, result);
      } catch (e) {
        return errorResult((e as Error).message);
      }
    },
  );
}
