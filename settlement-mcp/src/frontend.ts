/**
 * Frontend toolset: what no generic registry can provide.
 *
 * Delivery of UI source belongs to the shadcn registry standard (the
 * @venlyfinance registry under ui/r/ in this repo); these tools carry the
 * judgment layer instead – journey blueprints (what screens and states a
 * money product needs) and a deterministic design audit that pushes back
 * on the classic agent-built-dashboard failure modes.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export const REGISTRY_URL_TEMPLATE =
  "https://raw.githubusercontent.com/Venly/venly-settlement-sdk/main/ui/r/{name}.json";

const JOURNEYS = {
  "home-balances": `# Home / balances
Shell: left nav rail + thin top bar; full-width content.
Registry items: venly-tokens, balance-card, data-table, status-pill.
Hooks: useAccounts, useVirtualBankAccounts; balances rendered per account/currency.
States that must exist: loading, zero accounts (first-run guidance), balances with reserved buckets.
Rules that must hold: available is the emphasised figure and the only one above the rule; reserved is demoted by position and scale, never colour; unspendable buckets carry the padlock; never assume stablecoin parity - render the quoted rate.`,
  receive: `# Receive
Shell: content column - a warning callout, the field card, an advisory below.
Registry items: venly-tokens, field-list; block: receive.
Hooks: useVirtualBankAccounts (first active EUR account).
States that must exist: no virtual bank account yet (offer creation), details present, reference not yet assigned ("Not assigned yet" + Required pill - never "(not required)").
Rules that must hold: the payment reference is enforced as mandatory (amber Required pill, warning above the fields); per-field copy names the field it copied and only confirms on a successful write; rows never vanish - render the "(not required)" variant.`,
  send: `# Send
Shell: full page; form clamped ~600px; review step replaces the form.
Registry items: venly-tokens, arithmetic-ladder, timeline; block: send.
Hooks: useStagedTransfer (the machine IS the flow), useFeeQuote when fees apply.
States that must exist: draft (validation issues listed), staged review, submitting, pending (polling), completed, failed (reason shown, terminal).
Rules that must hold: money movement is stage-then-confirm - the review renders the exact staged request as an arithmetic ladder (working before the answer, uncertainty attached to the number); the commit button restates the amount and never carries a countdown; values are never masked on review; execution is single-shot on an idempotency key pinned at staging.`,
  activity: `# Activity
Shell: full-width table + side panel.
Registry items: venly-tokens, data-table, status-pill, side-panel, timeline; block: activity.
Hooks: useTransfers (and useRampRequests where ramps are in scope).
States that must exist: loading, empty ledger, rows with pending/failed pills, open detail panel that stays in sync with refetches.
Rules that must hold: a row click opens the panel, never navigates; no scrim - the source row stays tinted; settled rows stay quiet (colour is a budget; pills only where action or failure lives); the panel's hero is the amount; the failure reason rides the terminal timeline node.`,
  "onboarding-status": `# Onboarding / verification status
Shell: full page, form clamped ~600px; a status home once submitted.
Registry items: venly-tokens, timeline, status-pill, field-list.
Hooks: useParties, useCreateParty; verification status from the party/account records.
States that must exist: collecting (per-section progress), submitted/waiting (say who acts next, on which channel, what still works meanwhile), approved, declined (humane copy + what to do next), re-verification on a live account.
Rules that must hold: never render a fake progress percentage - use real per-item status; a waiting state answers how long / who acts / what still works; a decline explains and offers a next step, not a dead end; creating a party is NOT completed verification - show the honest state.`,
  reconciliation: `# Reconciliation
Shell: split pane (roughly one-third list, two-thirds evidence) - not a drawer.
Registry items: venly-tokens, data-table, side-panel, status-pill, field-list.
Hooks: reconcile_by_reference_code (MCP composite) or useVirtualBankAccounts + useTransfers joined on referenceCode.
States that must exist: matched, unmatched with candidate expectations, partial/many-to-one with a live shortfall figure, resolved.
Rules that must hold: show per-signal match rationale (which fields agree), never a bare score; keep zero-counts visible - an empty exception queue is information; keyboard row-stepping for review throughput.`,
  "proof-of-segregation": `# Proof of segregation
Shell: content column, single card.
Registry items: venly-tokens, field-list, balance-card.
Hooks: useWallets, useAccount; on-chain balance beside the ledger figure.
States that must exist: reconciled (figures agree, timestamped), reconciling, source unavailable (say so - never render a stale figure as current).
Rules that must hold: the wallet address renders monospace with copy; the on-chain figure and ledger figure sit side by side with their as-of times; discrepancies are stated, not smoothed.`,
  approvals: `# Approvals
Shell: full-width queue + side panel tailored to the approver.
Registry items: venly-tokens, data-table, status-pill, side-panel, timeline.
Hooks: useRampRequests, useFourEyesApproval (capability decides what renders), useRampLifecycle.
States that must exist: queue with awaiting-approval items, detail with the decision context beside the figures, applied, stale-version (someone acted first - refetch and re-decide), creator-view (cannot approve own request - render the rule, not a disabled mystery button).
Rules that must hold: the optimistic-locking version travels with every decision; a 409 means re-decide against fresh state, never auto-retry; reject requires a reason; the creator sees why they cannot approve.`,
} as const;

type JourneyKey = keyof typeof JOURNEYS;
const JOURNEY_KEYS = Object.keys(JOURNEYS) as [JourneyKey, ...JourneyKey[]];

interface Finding {
  rule: string;
  severity: "error" | "warn";
  evidence: string;
  fix: string;
}

/** Deterministic design audit. Text in, findings out - no model, no taste. */
export function reviewScreenSource(source: string): Finding[] {
  const findings: Finding[] = [];
  const push = (rule: string, severity: Finding["severity"], evidence: string, fix: string) =>
    findings.push({ rule, severity, evidence: evidence.slice(0, 120), fix });

  for (const match of source.matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g)) {
    push(
      "raw-colour",
      "error",
      match[0],
      "Read colours from the venly-tokens custom properties; a reskin must be tokens.css and nothing else.",
    );
  }

  for (const match of source.matchAll(/-\d[\d,]*\.\d{2}\s*(?:[A-Z]{3}|€|\$|£)/g)) {
    push(
      "hyphen-minus-amount",
      "error",
      match[0],
      "Use the true minus sign − before negative amounts (the Money primitive does this).",
    );
  }

  // Only a RENDERED cancelled state counts (a quoted/JSX label or a state
  // value), never the verb "cancel" in prose or a token file's comment; and
  // only the ✓ glyph counts as the violation, never the mere NAME of a
  // success token nearby.
  for (const match of source.matchAll(/(?:["'>`]|\bstate\s*[:=]\s*["'])\s*cancell?ed\b/gi)) {
    const idx = match.index ?? 0;
    const around = source.slice(Math.max(0, idx - 150), idx + 150);
    if (/✓/.test(around)) {
      push(
        "success-on-cancelled",
        "error",
        around.trim().slice(0, 80),
        "A cancelled or failed terminal step must never carry a success check - grey ↺ or red ✕.",
      );
      break;
    }
  }

  if (/review|confirm/i.test(source) && /[•*]{3,}/.test(source)) {
    push(
      "masked-review-value",
      "error",
      source.match(/[•*]{3,}/)![0],
      "Never mask values on a review screen; its only job is legibility of what is about to happen.",
    );
  }

  if (/nth-child\(\s*(?:even|odd|2n)/.test(source)) {
    push(
      "zebra-striping",
      "warn",
      "nth-child(even/odd) background",
      "No finance reference uses zebra striping - separate rows with hairlines and spacing.",
    );
  }

  if (/box-shadow/.test(source) && !/var\(--shadow-overlay\)/.test(source)) {
    push(
      "shadow-outside-overlay",
      "warn",
      source.match(/box-shadow[^;"}]*/)?.[0] ?? "box-shadow",
      "Elevation is only for overlays, and only via the --shadow-overlay token; the base layer is flat.",
    );
  }

  if (/linear-gradient|radial-gradient/.test(source)) {
    push(
      "gradient-surface",
      "warn",
      source.match(/\w+-gradient\([^)]*\)/)?.[0] ?? "gradient",
      "Gradient balance heroes read as template, not product; surfaces are flat neutrals with one accent.",
    );
  }

  if (/(?:status|state)/i.test(source) && /var\(--state-/.test(source)) {
    if (!/[✓✕↺⚠●○]|aria-hidden/.test(source)) {
      push(
        "colour-only-state",
        "warn",
        "state colours present without any glyph",
        "Pair every state hue with a glyph or word so status survives greyscale.",
      );
    }
  }

  return findings;
}

const AGENTS_TEXT = `# Composition rules for coding agents building on the Venly UI registry

Delivery: add the registry once to components.json -
  { "registries": { "@venlyfinance": "${REGISTRY_URL_TEMPLATE}" } }
then install blocks with the shadcn CLI, e.g. \`npx shadcn@latest add @venlyfinance/receive\`.
Each block auto-installs its components, the venly-tokens file and the
@venlyfinance/react data layer. Import tokens.css once at the app root.

1. Never hand-roll API calls, auth, retries, or transfer state - every read
   is a hook, every regulated lifecycle is a flow machine from
   @venlyfinance/react. Wrap the tree once in <VenlyProvider environment="mock">.
2. Mock mode is the default for any demo or first build: zero credentials,
   zero network. Never place a clientSecret in browser code - the provider
   throws; use proxyClientOptions() against your own backend for production.
3. Money movement is stage-then-confirm: render the review, restate the
   amount on the commit button, execute once.
4. Approval UIs render the rule, not the error: use the capability object;
   on "stale-version" refetch and let the operator re-decide.
5. Theme by editing the installed venly-tokens css file and nothing else.
6. Before declaring a screen done, run the review_screen tool on its source
   and fix every error-severity finding. Consult get_journey_blueprint
   before designing a screen the registry has no block for.
`;

export function registerFrontendTools(server: McpServer): void {
  server.registerTool(
    "get_journey_blueprint",
    {
      title: "Get a journey blueprint",
      description:
        "Screen inventory, required states, registry items and binding hooks for one money-product journey. Consult before designing any screen.",
      inputSchema: {
        journey: z.enum(JOURNEY_KEYS).describe("Which journey to blueprint"),
      },
    },
    async ({ journey }) => ({
      content: [{ type: "text", text: JOURNEYS[journey] }],
    }),
  );

  server.registerTool(
    "review_screen",
    {
      title: "Design-audit a screen",
      description:
        "Deterministic audit of component/markup source against the kit's design contract: raw colours, hyphen-minus amounts, success styling on cancelled steps, masked review values, zebra striping, off-token shadows, gradients, colour-only state. Returns findings, not a score.",
      inputSchema: {
        source: z.string().min(1).describe("The component/markup/CSS source to audit"),
      },
    },
    async ({ source }) => {
      const findings = reviewScreenSource(source);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                findings,
                summary:
                  findings.length === 0
                    ? "No contract violations detected."
                    : `${findings.filter((f) => f.severity === "error").length} error(s), ${findings.filter((f) => f.severity === "warn").length} warning(s). Fix every error before declaring the screen done.`,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.registerResource(
    "frontend-agents",
    "venly://frontend/agents",
    {
      title: "UI composition rules for coding agents",
      description:
        "How to assemble a money-product frontend from the @venlyfinance registry and react package.",
      mimeType: "text/markdown",
    },
    async () => ({
      contents: [
        {
          uri: "venly://frontend/agents",
          mimeType: "text/markdown",
          text: AGENTS_TEXT,
        },
      ],
    }),
  );
}
