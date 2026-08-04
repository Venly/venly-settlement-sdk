import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

interface StaticResource {
  name: string;
  uri: string;
  title: string;
  description: string;
  text: string;
}

const RESOURCES: StaticResource[] = [
  {
    name: "venly-finance-capabilities",
    uri: "venly://capabilities",
    title: "Venly Finance capabilities",
    description: "Contract-backed builder capabilities and explicit product boundaries.",
    text: `# Venly Finance capabilities

Venly Finance provides financial infrastructure through several regulated partners. The public Finance contract exposes:

- individual and organisation party records with KYC/KYB state;
- accounts with an auto-provisioned wallet;
- wallet balances split into total, available and reserved token amounts;
- EUR SEPA virtual bank accounts with IBAN, BIC and reconciliation reference code;
- fiat-to-crypto payment sessions;
- account-to-account fiat-denominated and crypto-denominated transfers;
- payment-request authorization, settlement and reversal primitives;
- Fundflow on/off-ramp workflows with four-eyes approval.

Current boundaries:

- EUR is the currently documented virtual-bank-account currency. Do not infer global bank-account coverage.
- Creating a party does not complete KYC/KYB. Live virtual-bank-account provisioning requires a VERIFIED account.
- Card issuing is not exposed by the current Finance OpenAPI contract.
- A bank charter, deposit insurance and external-bank payout coverage are not supplied or implied by this MCP.
- Production x402 settlement is not implemented; the x402 tool is a quote-only stub.
`,
  },
  {
    name: "venly-finance-safety",
    uri: "venly://safety",
    title: "Venly Finance safety model",
    description: "Environment, write, compliance and secret-handling rules.",
    text: `# Venly Finance MCP safety

- Set VENLY_ENV explicitly to mock, staging or production. An absent value remains staging for 0.x compatibility.
- Mock mode uses synthetic SDK fixtures, no credentials and no network. Every mutation result is labelled mode=mock.
- Staging writes require confirm=true, VENLY_MCP_LIVE=1 and VENLY_CLIENT_ID/VENLY_CLIENT_SECRET.
- Production requires every staging gate plus VENLY_MCP_PRODUCTION=1.
- There is no implicit fallback from staging or production to mock.
- Mutations use idempotency keys where supported. Preserve a caller-supplied key across retries.
- Fundflow approvals retain four-eyes and optimistic-locking rules.
- Creating a party does not mean KYC/KYB has passed. A live virtual bank account requires KYC status VERIFIED.
- Keep Venly credentials and access tokens server-side. Never place them in browser code, tool output or logs.
- Never arm writes or move from mock to staging/production without an explicit user decision.
`,
  },
  {
    name: "international-account-workflow",
    uri: "venly://workflows/international-account",
    title: "International account golden workflow",
    description: "Atomic tool order for an international-account reference experience.",
    text: `# International account workflow

Start with VENLY_ENV=mock.

1. Call get_reference_data to inspect supported chains and assets.
2. Call create_party for an INDIVIDUAL or ORGANISATION. Treat returned KYC/KYB state as a state, not an approval.
3. Call create_account with the party ID and selected chain. The Finance API auto-provisions the account wallet.
4. Call list_wallets and display returned total, available and reserved token balances.
5. Call create_virtual_bank_account for EUR -> USDC. In live environments this requires a VERIFIED account.
6. Call get_virtual_bank_account to display IBAN/BIC/referenceCode where returned.
7. Call create_fiat_transfer or create_crypto_transfer using one stable idempotency key.
8. Call list_transfers/get_transfer to display status.
9. Use reconcile_by_reference_code when observed incoming bank transactions are available.

Do not collapse this workflow into an autonomous mega-tool. Each mutation remains visible, inspectable and separately confirmed outside mock mode.
`,
  },
  {
    name: "mock-to-staging-workflow",
    uri: "venly://workflows/mock-to-staging",
    title: "Mock-to-staging transition",
    description: "Configuration and compliance checklist for leaving simulation.",
    text: `# Mock to staging

Application business logic should continue to use @venlyfinance/sdk on the server side.

1. Keep the mock experience working and visibly labelled.
2. Set VENLY_ENV=staging and provide the VENLY_CLIENT_ID/VENLY_CLIENT_SECRET credentials through server-side secret storage.
3. Confirm the tenant's custody model, enabled chains/assets and regulated-partner coverage.
4. Use a documented VERIFIED test party/account before provisioning a live EUR virtual bank account.
5. Run read-only smoke checks first. Do not set VENLY_MCP_LIVE until those checks pass.
6. Dry-run every intended write, review its normalized request, then explicitly confirm it.

There is no implicit fallback to mock. Authentication or capability failures must remain visible rather than returning synthetic data.
`,
  },
];

export function registerBuilderResources(server: McpServer): void {
  for (const resource of RESOURCES) {
    server.registerResource(
      resource.name,
      resource.uri,
      {
        title: resource.title,
        description: resource.description,
        mimeType: "text/markdown",
      },
      async () => ({
        contents: [
          {
            uri: resource.uri,
            mimeType: "text/markdown",
            text: resource.text,
          },
        ],
      }),
    );
  }
}
