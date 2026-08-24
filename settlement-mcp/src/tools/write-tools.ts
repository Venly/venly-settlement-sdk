/**
 * Tier 2: WRITE/PREPARE tools. Sandbox-only, enforced in code.
 *
 * Every tool in this file refuses any non-mock base URL and any
 * credential-shaped parameter BEFORE validation and before any client access
 * (see safety.ts). In the mock sandbox the call executes against local
 * fixtures – zero credentials, zero network. There is no arming path to a
 * live write from this server; live mutations belong to a reviewed
 * integration over @venlyfinance/sdk. Proven per tool by
 * test/sandbox-boundary.test.ts.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { VenlyClient } from "../types.js";
import { refuseNonSandbox, type EnvLike } from "../safety.js";
import { errorResult, jsonResult } from "../results.js";

function executionResult(result: unknown) {
  return jsonResult({
    mode: "mock",
    // Explicit on every mutation result: this call DID execute, against the
    // local mock fixtures (the only plane these tools can touch).
    dryRun: false,
    environment: "mock",
    result,
  });
}

const WRITE_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const;

const confirmField = z
  .boolean()
  .default(false)
  .describe(
    "No effect: write/prepare tools execute only in the mock sandbox and " +
      "refuse any non-sandbox base URL in code. Retained for call-shape " +
      "compatibility. Unrelated to the react package's stage-then-confirm() " +
      "flow, which is a UI review ceremony, not an arming flag.",
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
        "Create a Finance party in the mock sandbox. This creates the party record; it does not complete KYC/KYB. Refuses any non-sandbox base URL.",
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
      const refusal = refuseNonSandbox("create_party", { ...party, confirm }, env);
      if (refusal) return refusal;
      const validationError = partyValidationError(party);
      if (validationError) return errorResult(validationError);
      try {
        return executionResult(await client.createParty(party));
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
        "Create a Finance account in the mock sandbox. Venly auto-provisions its wallet on the selected chain. Supply partyId or an inline party. Refuses any non-sandbox base URL.",
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
      const refusal = refuseNonSandbox("create_account", { ...body, confirm }, env);
      if (refusal) return refusal;
      if (!body.partyId && !body.party) {
        return errorResult("create_account requires partyId or an inline party");
      }
      if (body.party) {
        const validationError = partyValidationError(body.party);
        if (validationError) return errorResult(validationError);
      }
      try {
        return executionResult(await client.createAccount(body));
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
        "Provision a EUR SEPA virtual bank account and conversion target in the mock sandbox. The account must have KYC status VERIFIED. Refuses any non-sandbox base URL.",
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
      const refusal = refuseNonSandbox(
        "create_virtual_bank_account",
        { accountId, ...input, confirm },
        env,
      );
      if (refusal) return refusal;
      const body = {
        ...input,
        idempotencyKey: input.idempotencyKey ?? crypto.randomUUID(),
      };
      try {
        return executionResult(await client.createVirtualBankAccount(accountId, body));
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
        "Create an account-to-account transfer in the mock sandbox, using the current Finance OpenAPI fields. Refuses any non-sandbox base URL.",
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
      const refusal = refuseNonSandbox(
        "create_fiat_transfer",
        { senderAccountId, ...input, confirm },
        env,
      );
      if (refusal) return refusal;
      if (!input.receiverAccountId === !input.receiverExternalId) {
        return errorResult(
          "Provide exactly one of receiverAccountId or receiverExternalId - a transfer needs one receiver, addressed one way.",
        );
      }
      const body = {
        ...input,
        idempotencyKey: input.idempotencyKey ?? crypto.randomUUID(),
      };
      try {
        return executionResult(await client.createCurrentFiatTransfer(senderAccountId, body));
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
        "Create an account-to-account asset transfer in the mock sandbox, using the current Finance OpenAPI fields. Refuses any non-sandbox base URL.",
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
      const refusal = refuseNonSandbox(
        "create_crypto_transfer",
        { senderAccountId, ...input, confirm },
        env,
      );
      if (refusal) return refusal;
      if (!input.receiverAccountId === !input.receiverExternalId) {
        return errorResult(
          "Provide exactly one of receiverAccountId or receiverExternalId - a transfer needs one receiver, addressed one way.",
        );
      }
      const body = {
        ...input,
        idempotencyKey: input.idempotencyKey ?? crypto.randomUUID(),
      };
      try {
        return executionResult(await client.createCryptoTransfer(senderAccountId, body));
      } catch (e) {
        return errorResult((e as Error).message);
      }
    },
  );

  server.registerTool(
    "approve_ramp_request",
    {
      title: "Approve a ramp request (mock sandbox only)",
      description:
        "Approve a ramp request through four-eyes (fundflow POST /v1/ramp-requests/{id}/approve) " +
        "in the mock sandbox. Requires the current optimistic-locking version. The API enforces " +
        "that an identity cannot approve a request it created; this tool surfaces that state, " +
        "it does not bypass it. Refuses any non-sandbox base URL.",
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
      const refusal = refuseNonSandbox("approve_ramp_request", { id, version, confirm }, env);
      if (refusal) return refusal;
      try {
        return executionResult(await client.approveRampRequest(id, { version }));
      } catch (e) {
        return errorResult((e as Error).message);
      }
    },
  );

  server.registerTool(
    "reject_ramp_request",
    {
      title: "Reject a ramp request (mock sandbox only)",
      description:
        "Reject a ramp request (fundflow POST /v1/ramp-requests/{id}/reject) in the mock " +
        "sandbox. Requires the current optimistic-locking version. Refuses any non-sandbox base URL.",
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
      const refusal = refuseNonSandbox("reject_ramp_request", { id, version, confirm }, env);
      if (refusal) return refusal;
      try {
        return executionResult(await client.rejectRampRequest(id, { version }));
      } catch (e) {
        return errorResult((e as Error).message);
      }
    },
  );

  server.registerTool(
    "create_payment_session",
    {
      title: "Create a fiat-to-crypto payment session (mock sandbox only)",
      description:
        "Create a hosted pay-in session (finance POST " +
        "/accounts/{accountId}/fiat-to-crypto/payment-sessions) in the mock sandbox; redirect " +
        "the payer to the returned paymentUrl. Refuses any non-sandbox base URL.",
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
      const refusal = refuseNonSandbox(
        "create_payment_session",
        { accountId, ...rest, confirm },
        env,
      );
      if (refusal) return refusal;
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
      try {
        return executionResult(await client.createPayInSession(accountId, body));
      } catch (e) {
        return errorResult((e as Error).message);
      }
    },
  );
  server.registerTool(
    "register_payout_bank_account",
    {
      title: "Register a beneficiary bank account",
      description:
        "Register a payout (beneficiary) bank account on a party (finance POST " +
        "/v1/parties/{partyId}/payout-bank-accounts) in the mock sandbox. The account starts " +
        "PENDING; an operator activates it before it can back a payout route. Rail details come " +
        "back masked. Refuses any non-sandbox base URL.",
      inputSchema: {
        partyId: z.string(),
        rail: z.enum(["SEPA", "US_ACH"]),
        fiatCurrency: z.string().min(3).max(3),
        label: z.string().optional(),
        accountHolderName: z.string().min(1),
        iban: z.string().optional().describe("SEPA rail"),
        bic: z.string().optional().describe("SEPA rail"),
        accountNumber: z.string().optional().describe("US_ACH rail"),
        abaRoutingNumber: z.string().optional().describe("US_ACH rail"),
        accountType: z.enum(["CHECKING", "SAVINGS"]).optional().describe("US_ACH rail"),
        bankName: z.string().optional(),
        confirm: confirmField,
      },
      annotations: WRITE_ANNOTATIONS,
    },
    async ({ partyId, confirm, iban, bic, accountNumber, abaRoutingNumber, accountType, ...rest }) => {
      const refusal = refuseNonSandbox(
        "register_payout_bank_account",
        { partyId, iban, bic, accountNumber, abaRoutingNumber, accountType, ...rest, confirm },
        env,
      );
      if (refusal) return refusal;
      const body = {
        ...rest,
        railDetails: { iban, bic, accountNumber, abaRoutingNumber, accountType },
      };
      try {
        return executionResult(await client.registerPayoutBankAccount(partyId, body));
      } catch (e) {
        return errorResult((e as Error).message);
      }
    },
  );

  server.registerTool(
    "create_payout_route",
    {
      title: "Create a payout route",
      description:
        "Bind an ACTIVE beneficiary bank account to an account and a deposit asset (finance " +
        "POST /v1/accounts/{accountId}/payout-routes) in the mock sandbox. The route starts " +
        "AWAITING_OWNERSHIP_PROOF; complete_payout_ownership_proof activates it. Refuses any " +
        "non-sandbox base URL.",
      inputSchema: {
        accountId: z.string(),
        payoutBankAccountId: z.string(),
        chain: z.enum(["AVALANCHE", "BASE", "ETHEREUM", "POLYGON", "SOLANA"]),
        asset: z.string().min(1).describe("Deposit asset name, e.g. USDC"),
        confirm: confirmField,
      },
      annotations: WRITE_ANNOTATIONS,
    },
    async ({ accountId, payoutBankAccountId, chain, asset, confirm }) => {
      const refusal = refuseNonSandbox(
        "create_payout_route",
        { accountId, payoutBankAccountId, chain, asset, confirm },
        env,
      );
      if (refusal) return refusal;
      const body = { payoutBankAccountId, depositAsset: { chain, name: asset } };
      try {
        return executionResult(await client.createPayoutRoute(accountId, body));
      } catch (e) {
        return errorResult((e as Error).message);
      }
    },
  );

  server.registerTool(
    "prepare_payout_ownership_proof",
    {
      title: "Prepare route ownership proof",
      description:
        "Get the message the route's funding wallet must sign (finance POST " +
        "/v1/accounts/{accountId}/payout-routes/{routeId}/ownership-proof/prepare) in the mock " +
        "sandbox. Takes no body: the server derives the wallet and chain from the route. The " +
        "signature itself is produced by the wallet owner, never by this server. Refuses any " +
        "non-sandbox base URL.",
      inputSchema: {
        accountId: z.string(),
        routeId: z.string(),
        confirm: confirmField,
      },
      annotations: WRITE_ANNOTATIONS,
    },
    async ({ accountId, routeId, confirm }) => {
      const refusal = refuseNonSandbox(
        "prepare_payout_ownership_proof",
        { accountId, routeId, confirm },
        env,
      );
      if (refusal) return refusal;
      try {
        return executionResult(await client.preparePayoutOwnershipProof(accountId, routeId));
      } catch (e) {
        return errorResult((e as Error).message);
      }
    },
  );

  server.registerTool(
    "complete_payout_ownership_proof",
    {
      title: "Complete route ownership proof",
      description:
        "Submit the signed ownership-proof message; on success the route becomes ACTIVE " +
        "(finance POST /v1/accounts/{accountId}/payout-routes/{routeId}/ownership-proof/complete). " +
        "Mock sandbox only; refuses any non-sandbox base URL.",
      inputSchema: {
        accountId: z.string(),
        routeId: z.string(),
        message: z.string().min(1),
        signature: z.string().min(1),
        confirm: confirmField,
      },
      annotations: WRITE_ANNOTATIONS,
    },
    async ({ accountId, routeId, confirm, ...body }) => {
      const refusal = refuseNonSandbox(
        "complete_payout_ownership_proof",
        { accountId, routeId, ...body, confirm },
        env,
      );
      if (refusal) return refusal;
      try {
        return executionResult(
          await client.completePayoutOwnershipProof(accountId, routeId, body),
        );
      } catch (e) {
        return errorResult((e as Error).message);
      }
    },
  );

  server.registerTool(
    "request_payout",
    {
      title: "Request a payout",
      description:
        "Move crypto out of the account and settle fiat to the route's beneficiary bank " +
        "account (finance POST /v1/accounts/{accountId}/payouts) in the mock sandbox. Requires " +
        "an ACTIVE payout route. This is money leaving the (simulated) platform. Refuses any " +
        "non-sandbox base URL.",
      inputSchema: {
        accountId: z.string(),
        payoutRouteId: z.string(),
        cryptoAmount: z.number().positive(),
        idempotencyKey: z
          .string()
          .optional()
          .describe("UUID; generated when omitted"),
        confirm: confirmField,
      },
      annotations: WRITE_ANNOTATIONS,
    },
    async ({ accountId, confirm, ...rest }) => {
      const refusal = refuseNonSandbox("request_payout", { accountId, ...rest, confirm }, env);
      if (refusal) return refusal;
      const body = {
        payoutRouteId: rest.payoutRouteId,
        cryptoAmount: rest.cryptoAmount,
        idempotencyKey: rest.idempotencyKey ?? crypto.randomUUID(),
      };
      try {
        return executionResult(await client.requestPayout(accountId, body));
      } catch (e) {
        return errorResult((e as Error).message);
      }
    },
  );

  server.registerTool(
    "prepare_decision",
    {
      title: "Prepare a decision draft for a human to review",
      description:
        "Attach an agent-prepared decision draft to a record in the mock sandbox: a proposal, " +
        "the reason, and references to the evidence read. The draft NEVER applies anything - " +
        "business-judgment decisions (KYC, reconciliation matches, payout exceptions) are " +
        "maker/checker, and the checker's click in the console is the only mutation. The draft " +
        "renders in the console decision panel, badged as a sandbox agent draft, and a later " +
        "human decision marks it superseded. Mock sandbox only; refuses any non-sandbox base URL.",
      inputSchema: {
        recordType: z
          .enum(["verification", "reconciliation", "payout_exception"])
          .describe("Which decision queue the record belongs to"),
        recordId: z
          .string()
          .min(1)
          .describe(
            "verification: a party or account id · reconciliation: an inbound credit id · payout_exception: a payout id",
          ),
        proposal: z
          .string()
          .min(1)
          .describe("The decision you propose, in operator language (e.g. \"Approve verification\")"),
        reason: z.string().min(1).describe("Why - cite the evidence you read"),
        evidenceRefs: z
          .array(z.string())
          .default([])
          .describe("References into the evidence: field paths, event ids, record ids"),
        confirm: confirmField,
      },
      annotations: WRITE_ANNOTATIONS,
    },
    async ({ confirm, ...input }) => {
      const refusal = refuseNonSandbox("prepare_decision", { ...input, confirm }, env);
      if (refusal) return refusal;
      try {
        return executionResult(await client.prepareDecision(input));
      } catch (e) {
        return errorResult((e as Error).message);
      }
    },
  );
}
