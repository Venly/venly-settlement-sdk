/**
 * Tier 1: READ tools. Always on. Call SDK/transport GETs only. No mutation.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { VenlyClient } from "../types.js";
import { reconcileByReferenceCode } from "../reconcile.js";
import { errorResult, jsonResult } from "../results.js";

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

export function registerReadTools(server: McpServer, client: VenlyClient): void {
  server.registerTool(
    "list_ramp_requests",
    {
      title: "List ramp requests",
      description:
        "List on-ramp / off-ramp requests (fundflow GET /v1/ramp-requests). " +
        "Filter by rampType, status, date range, or paymentReference. Read-only.",
      inputSchema: {
        rampType: z.enum(["ON_RAMP", "OFF_RAMP"]).optional(),
        status: z
          .enum([
            "AWAITING_APPROVAL",
            "AWAITING_FUNDS",
            "PROCESSING",
            "SUCCEEDED",
            "FAILED",
            "BLOCKED",
            "DENIED",
            "REJECTED",
            "CANCELLED",
          ])
          .optional(),
        fromDate: z.string().optional().describe("YYYY-MM-DD inclusive"),
        toDate: z.string().optional().describe("YYYY-MM-DD inclusive"),
        paymentReference: z.string().optional(),
        page: z.number().int().min(1).optional(),
        size: z.number().int().min(1).max(200).optional(),
      },
      annotations: READ_ONLY,
    },
    async (params) => {
      try {
        const result = await client.listRampRequests(params);
        return jsonResult({ count: result.length, rampRequests: result });
      } catch (e) {
        return errorResult((e as Error).message);
      }
    },
  );

  server.registerTool(
    "get_ramp_request",
    {
      title: "Get ramp request",
      description:
        "Fetch a single ramp request with full detail incl. status and four-eyes " +
        "version (fundflow GET /v1/ramp-requests/{id}). Read-only.",
      inputSchema: { id: z.string().describe("Ramp request UUID") },
      annotations: READ_ONLY,
    },
    async ({ id }) => {
      try {
        return jsonResult(await client.getRampRequest(id));
      } catch (e) {
        return errorResult((e as Error).message);
      }
    },
  );

  server.registerTool(
    "list_accounts",
    {
      title: "List accounts",
      description:
        "List Venly Finance accounts before creating duplicates (finance GET /accounts). Read-only.",
      inputSchema: {
        page: z.number().int().min(1).optional(),
        size: z.number().int().min(1).max(200).optional(),
      },
      annotations: READ_ONLY,
    },
    async (params) => {
      try {
        const result = await client.listAccounts(params);
        return jsonResult({ count: result.length, accounts: result });
      } catch (e) {
        return errorResult((e as Error).message);
      }
    },
  );

  server.registerTool(
    "get_account",
    {
      title: "Get account",
      description: "Fetch a settlement account (finance GET /accounts/{accountId}). Read-only.",
      inputSchema: { accountId: z.string().describe("Account UUID") },
      annotations: READ_ONLY,
    },
    async ({ accountId }) => {
      try {
        return jsonResult(await client.getAccount(accountId));
      } catch (e) {
        return errorResult((e as Error).message);
      }
    },
  );

  server.registerTool(
    "list_wallets",
    {
      title: "List account wallets",
      description:
        "List wallets auto-provisioned for a Finance account (finance GET /accounts/{accountId}/wallets). Read-only.",
      inputSchema: {
        accountId: z.string().describe("Account UUID"),
        page: z.number().int().min(1).optional(),
        size: z.number().int().min(1).max(200).optional(),
      },
      annotations: READ_ONLY,
    },
    async ({ accountId, page, size }) => {
      try {
        const result = await client.listWallets(accountId, { page, size });
        return jsonResult({ count: result.length, wallets: result });
      } catch (e) {
        return errorResult((e as Error).message);
      }
    },
  );

  server.registerTool(
    "list_virtual_bank_accounts",
    {
      title: "List virtual bank accounts",
      description:
        "List the EUR vIBANs on an account, each with its reconciliation " +
        "referenceCode (finance GET /accounts/{accountId}/virtual-bank-accounts). Read-only.",
      inputSchema: { accountId: z.string().describe("Account UUID") },
      annotations: READ_ONLY,
    },
    async ({ accountId }) => {
      try {
        const result = await client.listVirtualBankAccounts(accountId);
        return jsonResult({ count: result.length, virtualBankAccounts: result });
      } catch (e) {
        return errorResult((e as Error).message);
      }
    },
  );

  server.registerTool(
    "get_virtual_bank_account",
    {
      title: "Get virtual bank account",
      description:
        "Fetch receiving-account details including status, IBAN/BIC and referenceCode. Read-only.",
      inputSchema: {
        accountId: z.string().describe("Account UUID"),
        virtualBankAccountId: z.string().describe("Virtual bank account UUID"),
      },
      annotations: READ_ONLY,
    },
    async ({ accountId, virtualBankAccountId }) => {
      try {
        return jsonResult(
          await client.getVirtualBankAccount(accountId, virtualBankAccountId),
        );
      } catch (e) {
        return errorResult((e as Error).message);
      }
    },
  );

  server.registerTool(
    "reconcile_by_reference_code",
    {
      title: "Reconcile by referenceCode",
      description:
        "Match observed incoming bank transactions on an account's EUR vIBANs to " +
        "the vIBAN whose referenceCode they carry. Fetches the account's vIBANs " +
        "(finance GET .../virtual-bank-accounts) and matches against the supplied " +
        "transactions. Matching is remittance-text tolerant: case- and " +
        "separator-insensitive, and a transaction matches when its normalized " +
        "reference CONTAINS the normalized code (real payers type 'invoice ref " +
        "abc 123 ty'). Codes under 4 alphanumeric characters are refused. " +
        "Read-only, no mutation. Returns the matched vIBAN, matched " +
        "transactions, and total amount.",
      inputSchema: {
        accountId: z.string().describe("Account UUID whose vIBANs to reconcile against"),
        referenceCode: z.string().describe("The reference code to reconcile"),
        transactions: z
          .array(
            z.object({
              referenceCode: z
                .string()
                .describe("Remittance text as received - free-form is fine; matching normalizes it"),
              amount: z.number(),
              currency: z.string(),
              remitterName: z.string().optional(),
              valueDate: z.string().optional(),
              bankTransactionId: z.string().optional(),
            }),
          )
          .default([])
          .describe("Observed incoming bank transactions (operator- or feed-supplied)"),
      },
      annotations: READ_ONLY,
    },
    async ({ accountId, referenceCode, transactions }) => {
      try {
        const vbans = await client.listVirtualBankAccounts(accountId);
        const result = reconcileByReferenceCode(referenceCode, vbans, transactions);
        return jsonResult(result);
      } catch (e) {
        return errorResult((e as Error).message);
      }
    },
  );

  server.registerTool(
    "list_transfers",
    {
      title: "List transfers",
      description:
        "List transfer history for an account (finance GET /accounts/{accountId}/transfers). Read-only.",
      inputSchema: {
        accountId: z.string().describe("Account UUID"),
        page: z.number().int().min(1).optional(),
        size: z.number().int().min(1).max(200).optional(),
      },
      annotations: READ_ONLY,
    },
    async ({ accountId, page, size }) => {
      try {
        const result = await client.listTransfers(accountId, { page, size });
        return jsonResult({ count: result.length, transfers: result });
      } catch (e) {
        return errorResult((e as Error).message);
      }
    },
  );

  server.registerTool(
    "get_transfer",
    {
      title: "Get transfer",
      description:
        "Fetch a transfer by id (finance GET /accounts/{accountId}/transfers/{transferId}). Read-only.",
      inputSchema: {
        accountId: z.string().describe("Account UUID"),
        transferId: z.string().describe("Transfer UUID"),
      },
      annotations: READ_ONLY,
    },
    async ({ accountId, transferId }) => {
      try {
        return jsonResult(await client.getTransfer(accountId, transferId));
      } catch (e) {
        return errorResult((e as Error).message);
      }
    },
  );

  server.registerTool(
    "list_parties",
    {
      title: "List parties",
      description:
        "List parties (individuals and organisations) (finance GET /parties). Read-only.",
      inputSchema: {
        page: z.number().int().min(1).optional(),
        size: z.number().int().min(1).max(200).optional(),
      },
      annotations: READ_ONLY,
    },
    async (params) => {
      try {
        const result = await client.listParties(params);
        return jsonResult({ count: result.length, parties: result });
      } catch (e) {
        return errorResult((e as Error).message);
      }
    },
  );

  server.registerTool(
    "get_party",
    {
      title: "Get party",
      description:
        "Fetch an individual or organisation party, including KYC/KYB state when present. Read-only.",
      inputSchema: { partyId: z.string().describe("Party UUID") },
      annotations: READ_ONLY,
    },
    async ({ partyId }) => {
      try {
        return jsonResult(await client.getParty(partyId));
      } catch (e) {
        return errorResult((e as Error).message);
      }
    },
  );

  server.registerTool(
    "get_reference_data",
    {
      title: "Get reference data",
      description:
        "Fetch settlement reference data: supported chains, fiat currencies, " +
        "cryptocurrencies, and company fees (fundflow GETs). Read-only. Choose one " +
        "dataset or 'all'.",
      inputSchema: {
        dataset: z
          .enum(["chains", "fiat_currencies", "cryptocurrencies", "fees", "all"])
          .default("all"),
      },
      annotations: READ_ONLY,
    },
    async ({ dataset }) => {
      try {
        const out: Record<string, unknown> = {};
        if (dataset === "chains" || dataset === "all")
          out.chains = await client.getSupportedChains();
        if (dataset === "fiat_currencies" || dataset === "all")
          out.fiatCurrencies = await client.getFiatCurrencies();
        if (dataset === "cryptocurrencies" || dataset === "all")
          out.cryptocurrencies = await client.getCryptocurrencies();
        if (dataset === "fees" || dataset === "all")
          out.fees = await client.getCompanyFees();
        return jsonResult(out);
      } catch (e) {
        return errorResult((e as Error).message);
      }
    },
  );
}
