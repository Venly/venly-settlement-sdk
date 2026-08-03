import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export function registerBuilderPrompts(server: McpServer): void {
  server.registerPrompt(
    "build_international_account",
    {
      title: "Build an international account experience",
      description:
        "Guide a coding agent to build a mock-first international account product over Venly Finance.",
      argsSchema: {
        productName: z.string().optional().describe("Working product name"),
        customerType: z
          .enum(["individual", "organisation", "both"])
          .default("organisation"),
        targetGeography: z
          .string()
          .optional()
          .describe("Target geography to validate; never treated as supported by assumption"),
      },
    },
    async ({ productName, customerType, targetGeography }) => ({
      description: "Mock-first Venly Finance application-building brief",
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Build an international account reference experience${productName ? ` called ${productName}` : ""} for ${customerType} customers${targetGeography ? ` targeting ${targetGeography}` : ""}.

Use this operating brief:

1. Read venly://capabilities, venly://safety and venly://workflows/international-account before writing code.
2. Start in explicit mock mode with VENLY_ENV=mock. Keep all simulated states visibly labelled Mock.
3. Use @venlyfinance/sdk in server-side code. Never put Venly credentials or access tokens in browser code.
4. Build the customer experience around atomic Finance capabilities: party, account, auto-provisioned wallet and balances, EUR receiving account, transfer and status/reconciliation.
5. Do not claim that creating a party completes KYC/KYB. Display verification and pending states honestly.
6. Venly supplies financial infrastructure through regulated partners. Do not describe the application or its customer as a licensed bank unless separately verified.
7. EUR/SEPA virtual bank accounts are documented. Validate ${targetGeography ?? "the requested geography"} and any broader currency/coverage requirement instead of inferring support.
8. Card issuing is not exposed by the current Finance contract; do not invent a card feature.
9. Require an explicit user decision before switching to staging, adding credentials or arming writes. Dry-run staging mutations before confirmation.
10. Produce a concise README showing mock setup, the unchanged SDK business logic and the explicit staging transition.

Success means a credible money-product experience backed by real Venly contract shapes—not a generic dashboard and not a claim that the MCP itself generated a regulated bank.`,
          },
        },
      ],
    }),
  );
}
