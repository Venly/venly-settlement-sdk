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
import { verifyRuntimeContract } from "./verify-cli.js";

export const REGISTRY_URL_TEMPLATE =
  "https://raw.githubusercontent.com/Venly/venly-settlement-sdk/main/ui/r/{name}.json";

const JOURNEYS = {
  auth: `# Auth (sign-in, 2FA, sign-up)
Shell: outside the app shell - a centred card column.
Registry items: venly-tokens; block: auth (SignInForm, TwoFactorForm, SignUpForm).
Binding: an AuthAdapter YOU implement - the Venly APIs authenticate machines
(client credentials), never people, so end-user auth is your identity layer
(OAuth/OIDC, Better Auth, Auth0, Clerk, Keycloak). createMockAuthAdapter ships
for demos: deterministic 2FA code 000000, expireSession() driver.
States that must exist: signed out, bad credentials (ONE combined message -
no user enumeration), 2FA challenge with wrong-code path, session expired
(session() returns null - redirect, no other signal), duplicate sign-up email.
Rules that must hold: credential errors never confirm which half was wrong;
the code field is six slots with paste distribution and full keyboard support;
the mock never claims an email was sent.`,
  team: `# Team
Shell: in-shell content column.
Registry items: venly-tokens, data-table, status-pill; block: team (TeamTable, InviteDialog).
Binding: a TeamAdapter over your auth provider (createMockTeamAdapter for demos).
States that must exist: ACTIVE/INVITED/DISABLED members on first paint, invite
created (display-only link in mock - never a fake sent-email claim), role
change persisting, self-actions blocked with the reason.
Rules that must hold: member status is word + glyph; role controls live in the
row; you cannot change your own role or disable yourself - the control is
disabled AND explains why.`,
  "home-balances": `# Home / balances
Shell: left nav rail + thin top bar; full-width content.
Registry items: venly-tokens, balance-card, data-table, status-pill; block: balances (BalancesBlock, BalanceMiniature).
Hooks: useAccounts, useWallets; balances rendered per asset across the account's wallets.
States that must exist: loading, zero balances (first-run guidance), reserved buckets, entirely reserved (available 0 rendered honestly - the acct-escrow seed exercises it), balance load error degrading locally with a retry.
Rules that must hold: available is the emphasised figure and the only one above the rule; reserved is demoted by position and scale, never colour, and carries the still-yours qualifier; unspendable buckets carry the padlock; masking covers every figure including the chrome miniature; arithmetic mismatches are surfaced, never corrected; never assume stablecoin parity - render the quoted rate.`,
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
Registry items: venly-tokens, timeline, status-pill, field-list; block: onboarding (CompanyForm, VerificationStatusHome, RestrictedBanner).
Hooks: useCreateParty, useCreateAccount, useParty, useAccount; verification status from the party/account records verbatim.
States that must exist: collecting (review before submit), submitted/waiting (say who acts next, on which channel, what still works meanwhile), approved, declined (humane copy, review-request as the primary action), re-verification on a live account (banner naming what pauses and what keeps working).
Rules that must hold: never render a fake progress percentage - use real status; a waiting state answers how long / who acts / what still works, and where no review window is published the copy says so instead of inventing one; a decline explains and offers a next step, not a dead end; creating a party is NOT completed verification - show the honest state.`,
  "withdraw-bank-accounts": `# Withdraw + bank accounts (off-ramp)
Shell: settings page for the whitelist; full page for the flow, form clamped ~600px.
Registry items: venly-tokens, data-table, status-pill, timeline, field-list, arithmetic-ladder; blocks: bank-accounts (BankAccountsBlock, AddBankAccountForm), withdraw (WithdrawFlow, WithdrawalsTable, ConnectedWithdrawDetail).
Hooks: useCompanyBankAccounts, useBankAccountConfig, useCreateCompanyBankAccount, useRampRequests, useRampRequest, useCreateRampRequest, useFeeQuote, useRampPairs, useReferenceData, useFourEyesApproval, useInitiateRamp, describeRampStatus.
States that must exist: empty whitelist (one CTA), account in review / verified / declined, no-verified-destination block, amount over balance (two-place signal), fee quote with its unit, awaiting approval (creator sees why they can't approve), stale decision (409 - refetch and re-decide, never auto-retry), awaiting funds (deposit instructions + mandatory reference + tx-hash report), processing, paid out, failed, rejected, cancelled, on hold.
Rules that must hold: destinations are the company's OWN verified accounts - unverified rows are disabled with the reason, never hidden; the pre-create review renders only known figures (no invented rate, no bank-receives placeholder - the created record carries the fiat arithmetic and the detail opens on it); a refusal never reads as a wait; the event timeline renders actor, role and absolute timestamps.`,
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
  "console-review-queue": `# Console review queue (the operator worklist)
Shell: left nav rail + thin top bar, full-width content, and a page-edge
environment banner naming mock mode. Not a consumer surface - density rules
apply.
Registry items: venly-tokens, data-table, status-pill, money, list-error. The
registry has no console block yet: compose these primitives.
Hooks: useAccounts, useParties. The queue's own state is DERIVED on every
render - never stored, never cached as a status.
Grouping: sections are ACTORS, not statuses - your move, waiting on the
customer, waiting on a provider, then a collapsed closed section. Grouping by
actor makes the reviewer's own worklist the top band by construction, which is
the whole job of the screen.
States that must exist: loading, your move, waiting on the customer, waiting on a provider, closed, empty queue, filtered to nothing, list error.
Rules that must hold: the whose-move value is a pure function of enum values on
the row - no clock reading, no threshold, no configuration and no default, and a
combination the mapping does not cover renders NO value plus an explicit
not-recognised line, which is a bug report rather than a guess; never a target
time, a breach colour or an overdue state, because the API publishes no targets
and an invented one is the same defect as an invented fee; an age column is
labelled for what it actually measures - a created-at delta is "Age", and only a
duration the API itself computes may be called time in state; empty sections are
still drawn as a zero header row, because nothing-to-do is information; loading
is a skeleton that preserves column geometry exactly, never prose; a row click
opens a side panel and never navigates; one status pill per row - the whose-move
value is plain text, because two pills read as two states.`,
  "console-decision-detail": `# Console decision detail (evidence, ceremony, audit trail)
Shell: side panel about 30% wide over the queue - no scrim, the table stays
visible clipped at the panel edge and the source row stays tinted. Escalate to a
35/65 split only when the evidence outgrows the panel. Evidence goes on the
LEFT: this is a judging task, not an authoring one.
Registry items: venly-tokens, side-panel, timeline, field-list, status-pill,
money, data-table.
Hooks: useAccount, useParty, useWallets, useTransfers,
useVirtualBankAccounts.
Two timeline columns, not one feed: the decision chain (who decided what, when,
in which seat) beside money movement on the same subject. Different actors,
different audiences; merging them is what makes an audit trail unreadable.
States that must exist: loading, evidence present, evidence unavailable, decision owed, decision applied, stale decision, terminal decision, frozen, empty trail.
Rules that must hold: every evidence row is either a real field path or a
labelled omission, and an omission is a FIRST-CLASS type in the component's
props so a build cannot accidentally render a placeholder where a gap belongs;
omission copy states only what is verified and never implies a result, a
pending state, or a clean one - and never mentions the API contract, which is
developer diagnostics rather than operator language; a field the API cannot
carry is captured anyway when the work needs it, and rendered with a visible
badge saying it is a console note rather than API state - hiding that asymmetry
is the dishonesty, showing it is the product; every decision carries the
optimistic-locking version, and a conflict means refetch and re-decide against
fresh state, never auto-retry; every transition the console causes leaves a
timeline node with actor, role and a timezone-qualified absolute timestamp, so a
status change with no node is a bug; a store resync is a system line, not a
decision node; the panel footer carries row-stepping key chips so the reviewer
moves row to row without closing.`,
  "console-pricing-config": `# Console pricing configuration
Shell: in-shell content column. A config screen, not a queue: no whose-move
value and no aging.
Registry items: venly-tokens, data-table, arithmetic-ladder, field-list.
Hooks: useCompanyFees.
Binding: the fee data the packages actually serve is a VOLUME-TIER model - tier
name, ramp direction, minimum and maximum volume, percentage, version - and it
is the same model the shipped withdrawal quote consumes, so this screen shows
where a real quote comes from. A second, richer per-rail configuration model
exists on an internal plane and is NOT served here; it renders as a labelled
omission, never as an empty form.
States that must exist: loading, tiers present, no tiers, configuration unavailable, worked example, save failed.
Rules that must hold: a worked arithmetic ladder is mandatory on the tier
section - a sample amount times the tier percentage, with the operator glyphs in
a left gutter - because a pricing screen that shows only stored numbers teaches
nothing; the ladder renders ONLY over data that exists, never over the omitted
section, since arithmetic over absent numbers is invented arithmetic; the tier
a sample amount falls into is highlighted in the table so the row and the ladder
are visibly the same fact; a single-member enum renders as a disabled
single-value field that says so, not a select pretending at choice; a date
window that has not opened reads scheduled, never active; forms are single
column with the field width capped, label above input, helper text between them
and the error below.`,
  "console-simulator": `# Sandbox simulator (play the counterparty)
Shell: its own chrome - a scrimmed right-hand drawer on a distinct surface with
a persistent sandbox label, reachable from ONE fixed affordance in the top bar.
It is the only scrimmed drawer in the console, so the surface change alone
signals the register change.
Registry items: venly-tokens, field-list, status-pill, money.
Hooks: useVenlyMock. Every control maps to exactly one call on the mock's
simulations namespace - no control without a call, and no call renamed.
Why it is separate: inbound credits, provider progression and screening verdicts
are things OTHER parties do. Putting them in the operator's workflow recreates
the role confusion with better styling, which is the failure this drawer exists
to prevent.
States that must exist: drawer closed, drawer open, sharing, not sharing, credit landed, verdict returned, payout advanced, books balanced, books do not balance, reset.
Rules that must hold: controls are phrased as events that happen to you, in the
third person, while operator controls elsewhere are imperative decisions - a
control phrased in the wrong voice is in the wrong surface; a simulated
transition emits the SAME event the real path emits, and the trail attributes it
to the simulator plainly rather than to an operator; the drawer is reachable
only from the top bar, never from a queue row or a decision panel, because those
paths make another party's action look like the operator's; the ledger check gets
a visible surface, because it is the one control here that is not a fiction - it
is an assertion about the fiction's consistency; the channel footer states the
adapter, session and peer count, and says so IN WORDS when the surface is not
actually sharing - the default channel shares nothing and cross-context sharing
is same-origin only, so a demo that silently is not sharing renders a green
screen while proving nothing.`,
} as const;

type JourneyKey = keyof typeof JOURNEYS;
const JOURNEY_KEYS = Object.keys(JOURNEYS) as [JourneyKey, ...JourneyKey[]];

const RUNTIME_PACKAGES_BY_BLOCK = {
  activity: {
    "@venlyfinance/react": "^0.4.0",
    "@venlyfinance/sdk": "^0.5.0",
    "@tanstack/react-query": "^5.0.0",
  },
  auth: { "@radix-ui/react-one-time-password-field": "^0.1.16" },
  balances: {
    "@venlyfinance/react": "^0.4.0",
    "@venlyfinance/sdk": "^0.5.0",
    "@tanstack/react-query": "^5.0.0",
  },
  "bank-accounts": {
    "@venlyfinance/react": "^0.4.0",
    "@venlyfinance/sdk": "^0.5.0",
    "@tanstack/react-query": "^5.0.0",
  },
  onboarding: {
    "@venlyfinance/react": "^0.4.0",
    "@venlyfinance/sdk": "^0.5.0",
    "@tanstack/react-query": "^5.0.0",
  },
  receive: {
    "@venlyfinance/react": "^0.4.0",
    "@venlyfinance/sdk": "^0.5.0",
    "@tanstack/react-query": "^5.0.0",
  },
  reconciliation: {
    "@venlyfinance/react": "^0.4.0",
    "@venlyfinance/sdk": "^0.5.0",
    "@tanstack/react-query": "^5.0.0",
  },
  send: {
    "@venlyfinance/react": "^0.4.0",
    "@venlyfinance/sdk": "^0.5.0",
    "@tanstack/react-query": "^5.0.0",
  },
  team: { "@radix-ui/react-dialog": "^1.1.23" },
  withdraw: {
    "@venlyfinance/react": "^0.4.0",
    "@venlyfinance/sdk": "^0.5.0",
    "@tanstack/react-query": "^5.0.0",
  },
} as const;

type RuntimeBlock = keyof typeof RUNTIME_PACKAGES_BY_BLOCK;

/**
 * The package set any hook-using screen needs, for journeys the registry has no
 * composite block for yet - the console screens are built from primitives
 * (data-table, side-panel, timeline …), and a primitive registry item declares
 * no npm dependencies, so deriving `requiredPackages` from blocks alone would
 * tell an agent that a surface living entirely on hooks needs no packages.
 *
 * Pinned to the sdk major this repo actually ships. The composite blocks still
 * carry `^0.5.0`, stamped into ui/r/*.json from ui/package.json - a stale pin
 * across the 0.6.0 release that made mock transfers debit balances. Fixing it
 * is one line there plus a registry regeneration, not a change here.
 */
const DATA_PLANE_PACKAGES = {
  "@venlyfinance/react": "^0.4.0",
  "@venlyfinance/sdk": "^0.6.0",
  "@tanstack/react-query": "^5.0.0",
} as const;

const JOURNEY_RUNTIME: Record<JourneyKey, {
  blocks: RuntimeBlock[];
  hooks: string[];
  demoBindings?: { import: string; from: string }[];
  /**
   * Registry items to install when the journey has no composite block of its
   * own. Names are registry item ids, not block ids: they carry no npm
   * dependencies, so they inform `install` and never `requiredPackages`.
   */
  registryItems?: string[];
  /** Lives on the hooks, so it needs DATA_PLANE_PACKAGES regardless of blocks. */
  dataPlane?: boolean;
  /** Journey-specific additions to the standard forbidden list. */
  extraForbidden?: string[];
}> = {
  auth: {
    blocks: ["auth"],
    hooks: [],
    demoBindings: [{ import: "createMockAuthAdapter", from: "registry:block/auth" }],
  },
  team: {
    blocks: ["team"],
    hooks: [],
    demoBindings: [{ import: "createMockTeamAdapter", from: "registry:block/team" }],
  },
  "home-balances": { blocks: ["balances"], hooks: ["useAccounts", "useWallets"] },
  receive: { blocks: ["receive"], hooks: ["useVirtualBankAccounts"] },
  send: { blocks: ["send"], hooks: ["useStagedTransfer", "useFeeQuote"] },
  activity: { blocks: ["activity"], hooks: ["useTransfers", "useRampRequests"] },
  "onboarding-status": {
    blocks: ["onboarding"],
    hooks: ["useCreateParty", "useCreateAccount", "useParty", "useAccount"],
  },
  "withdraw-bank-accounts": {
    blocks: ["bank-accounts", "withdraw"],
    hooks: [
      "useCompanyBankAccounts",
      "useBankAccountConfig",
      "useCreateCompanyBankAccount",
      "useRampRequests",
      "useRampRequest",
      "useCreateRampRequest",
      "useFeeQuote",
      "useRampPairs",
      "useReferenceData",
      "useFourEyesApproval",
      "useInitiateRamp",
      "describeRampStatus",
    ],
  },
  reconciliation: {
    blocks: ["reconciliation"],
    hooks: ["useVirtualBankAccounts", "useTransfers"],
  },
  "proof-of-segregation": { blocks: ["balances"], hooks: ["useWallets", "useAccount"] },
  approvals: {
    blocks: ["withdraw"],
    hooks: ["useRampRequests", "useFourEyesApproval", "useRampLifecycle"],
  },
  "console-review-queue": {
    blocks: [],
    registryItems: ["venly-tokens", "data-table", "status-pill", "money", "list-error"],
    dataPlane: true,
    hooks: ["useAccounts", "useParties"],
    extraForbidden: [
      "a whose-move or needs-attention value computed from anything other than enum values on the row",
      "a target time, breach threshold or overdue state (the API publishes no targets)",
      "an age column labelled time-in-state over a created-at delta",
    ],
  },
  "console-decision-detail": {
    blocks: [],
    registryItems: [
      "venly-tokens",
      "side-panel",
      "timeline",
      "field-list",
      "status-pill",
      "money",
      "data-table",
    ],
    dataPlane: true,
    hooks: [
      "useAccount",
      "useParty",
      "useWallets",
      "useTransfers",
      "useVirtualBankAccounts",
    ],
    extraForbidden: [
      "a rendered placeholder where an unavailable field belongs (omission is a prop type, not a string)",
      "a captured field the API cannot carry, rendered without the console-note badge",
      "a status change that leaves no timeline node with actor, role and timezone-qualified stamp",
      "auto-retry on a version conflict (refetch and let the operator re-decide)",
    ],
  },
  "console-pricing-config": {
    blocks: [],
    registryItems: ["venly-tokens", "data-table", "arithmetic-ladder", "field-list"],
    dataPlane: true,
    hooks: ["useCompanyFees"],
    extraForbidden: [
      "an arithmetic ladder over figures the API does not serve",
      "a single-member enum rendered as a select",
    ],
  },
  "console-simulator": {
    blocks: [],
    registryItems: ["venly-tokens", "field-list", "status-pill", "money"],
    dataPlane: true,
    hooks: [],
    extraForbidden: [
      "counterparty or provider simulation rendered inside operator chrome",
      "a simulator control reachable from a queue row or a decision panel",
      "a simulator control phrased as an imperative operator decision",
      "a cross-context demo that does not state its channel adapter and peer count",
    ],
  },
};

const RUNTIME_CONTRACT_SCHEMA = z.object({
  runtimeMode: z.enum(["mock", "staging", "production"]),
  requiredPackages: z.record(z.string()),
  requiredHooks: z.array(z.object({ import: z.string(), from: z.string() })),
  demoBindings: z.array(z.object({ import: z.string(), from: z.string() })).optional(),
  provider: z.object({
    import: z.string(),
    from: z.string(),
    props: z.object({ environment: z.literal("mock") }),
  }),
  forbiddenPatterns: z.array(z.string()),
  install: z.array(z.string()),
  completionChecks: z.array(z.string()),
});

function runtimeContractForJourney(journey: JourneyKey): z.infer<typeof RUNTIME_CONTRACT_SCHEMA> {
  const definition = JOURNEY_RUNTIME[journey];
  // Base first, blocks last: a composite block's own stamped dependencies are
  // what the registry will actually install, so they win where the two differ.
  const requiredPackages: Record<string, string> = definition.dataPlane
    ? { ...DATA_PLANE_PACKAGES }
    : {};
  for (const block of definition.blocks) {
    Object.assign(requiredPackages, RUNTIME_PACKAGES_BY_BLOCK[block]);
  }
  const installItems = definition.blocks.length
    ? definition.blocks.map((block) => `@venlyfinance/${block}`)
    : (definition.registryItems ?? []).map((item) => `@venlyfinance/${item}`);
  return {
    runtimeMode: "mock",
    requiredPackages,
    requiredHooks: definition.hooks.map((name) => ({
      import: name,
      from: "@venlyfinance/react",
    })),
    ...(definition.demoBindings ? { demoBindings: definition.demoBindings } : {}),
    provider: {
      import: "VenlyProvider",
      from: "@venlyfinance/react",
      props: { environment: "mock" },
    },
    forbiddenPatterns: [
      "in-memory store of transfer/balance/approval state",
      "fetch()/axios to self-owned money routes that do not wrap @venlyfinance/sdk",
      "useEffect polling loops for transfer status (useStagedTransfer/useRampLifecycle exist)",
      "clientSecret in browser code (provider throws; use proxyClientOptions())",
      ...(definition.extraForbidden ?? []),
    ],
    install: [
      "npx shadcn@latest init -y -b radix -p nova",
      'add { "registries": { "@venlyfinance": "https://raw.githubusercontent.com/Venly/venly-settlement-sdk/main/ui/r/{name}.json" } } to components.json',
      `npx shadcn@latest add ${installItems.join(" ")} -y -o`,
    ],
    completionChecks: [
      'npx @venlyfinance/settlement-mcp review "src/**/*.tsx" exits 0',
      'npx @venlyfinance/settlement-mcp verify "src/**/*.{ts,tsx}" exits 0',
    ],
  };
}

interface Finding {
  rule: string;
  severity: "error" | "warn";
  evidence: string;
  fix: string;
  /** 1-based line the finding fired on - lets a CLI print path:line. */
  line?: number;
}

// ---------------------------------------------------------------------------
// Shared mechanics. Three cross-cutting behaviours every rule participates in:
//
// 1. Suppression: `venly-allow:<rule-id>` on the offending line or the line
//    immediately above drops the finding silently - no counter, no second
//    severity tier. A consumer's own API may legitimately return what ours
//    does not; without this hatch the audit is uninstallable for them.
// 2. Comment lines are not copy: rules that judge words skip lines whose
//    trimmed form starts with `*`, `//`, `/*` or `{/*` - otherwise the rule
//    fires on the comment that documents the rule itself.
// 3. Findings carry the character index they fired at, so suppression can be
//    resolved against the exact offending line.
// ---------------------------------------------------------------------------

const COMMENT_LINE = /^\s*(?:\*|\/\/|\/\*|\{\/\*)/;

function lineBoundsAt(source: string, idx: number): { start: number; end: number } {
  const at = Math.min(Math.max(idx, 0), source.length);
  const start = source.lastIndexOf("\n", Math.max(0, at - 1)) + 1;
  const nl = source.indexOf("\n", at);
  return { start, end: nl === -1 ? source.length : nl };
}

function lineAt(source: string, idx: number): string {
  const { start, end } = lineBoundsAt(source, idx);
  return source.slice(start, end);
}

function lineAboveAt(source: string, idx: number): string {
  const { start } = lineBoundsAt(source, idx);
  if (start === 0) return "";
  const prevEnd = start - 1; // the \n terminating the previous line
  const prevStart = source.lastIndexOf("\n", prevEnd - 1) + 1;
  return source.slice(prevStart, prevEnd);
}

function isCommentLineAt(source: string, idx: number): boolean {
  return COMMENT_LINE.test(lineAt(source, idx));
}

function isSuppressedAt(source: string, idx: number, ruleId: string): boolean {
  const token = `venly-allow:${ruleId}`;
  return lineAt(source, idx).includes(token) || lineAboveAt(source, idx).includes(token);
}

function lineNumberAt(source: string, idx: number): number {
  let line = 1;
  for (let i = 0; i < idx && i < source.length; i++) if (source[i] === "\n") line++;
  return line;
}

/** Deterministic design audit. Text in, findings out - no model, no taste. */
export function reviewScreenSource(source: string, journey?: JourneyKey): Finding[] {
  const findings: Finding[] = [];
  // Returns whether the finding was recorded, so rules that stop after the
  // first hit can keep scanning past a suppressed occurrence instead of
  // letting one venly-allow blind them to a later real violation.
  const push = (
    rule: string,
    severity: Finding["severity"],
    evidence: string,
    fix: string,
    atIndex: number,
  ): boolean => {
    if (isSuppressedAt(source, atIndex, rule)) return false;
    findings.push({
      rule,
      severity,
      evidence: evidence.slice(0, 120),
      fix,
      line: lineNumberAt(source, atIndex),
    });
    return true;
  };

  for (const match of source.matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g)) {
    push(
      "raw-colour",
      "error",
      match[0],
      "Read colours from the venly-tokens custom properties; a reskin must be tokens.css and nothing else.",
      match.index ?? 0,
    );
  }

  for (const match of source.matchAll(/-\d[\d,]*\.\d{2}\s*(?:[A-Z]{3}|€|\$|£)/g)) {
    push(
      "hyphen-minus-amount",
      "error",
      match[0],
      "Use the true minus sign − before negative amounts (the Money primitive does this).",
      match.index ?? 0,
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
      if (
        push(
          "success-on-cancelled",
          "error",
          around.trim().slice(0, 80),
          "A cancelled or failed terminal step must never carry a success check - grey ↺ or red ✕.",
          idx,
        )
      )
        break;
    }
  }

  // The once-per-source rules below scan every occurrence and stop at the
  // first RECORDED finding, so a venly-allow on one occurrence never hides a
  // later unsuppressed one.

  if (/review|confirm/i.test(source)) {
    for (const masked of source.matchAll(/[•*]{3,}/g)) {
      if (
        push(
          "masked-review-value",
          "error",
          masked[0],
          "Never mask values on a review screen; its only job is legibility of what is about to happen.",
          masked.index ?? 0,
        )
      )
        break;
    }
  }

  for (const zebra of source.matchAll(/nth-child\(\s*(?:even|odd|2n)/g)) {
    if (
      push(
        "zebra-striping",
        "warn",
        "nth-child(even/odd) background",
        "No finance reference uses zebra striping - separate rows with hairlines and spacing.",
        zebra.index ?? 0,
      )
    )
      break;
  }

  if (!/var\(--shadow-overlay\)/.test(source)) {
    for (const shadow of source.matchAll(/box-shadow[^;"}]*/g)) {
      if (
        push(
          "shadow-outside-overlay",
          "warn",
          shadow[0],
          "Elevation is only for overlays, and only via the --shadow-overlay token; the base layer is flat.",
          shadow.index ?? 0,
        )
      )
        break;
    }
  }

  for (const gradient of source.matchAll(/(?:linear|radial)-gradient(?:\([^)]*\))?/g)) {
    if (
      push(
        "gradient-surface",
        "warn",
        gradient[0],
        "Gradient balance heroes read as template, not product; surfaces are flat neutrals with one accent.",
        gradient.index ?? 0,
      )
    )
      break;
  }

  if (/(?:status|state)/i.test(source) && !/[✓✕↺⚠●○]|aria-hidden/.test(source)) {
    for (const stateVar of source.matchAll(/var\(--state-/g)) {
      if (
        push(
          "colour-only-state",
          "warn",
          "state colours present without any glyph",
          "Pair every state hue with a glyph or word so status survives greyscale.",
          stateVar.index ?? 0,
        )
      )
        break;
    }
  }

  // --- New rule classes (invented timing copy, crypto currency formatting,
  // required-rendered-optional, blueprint state coverage, fixture honesty)
  // are registered below. Each judges text only, honours the suppression
  // hatch, and skips comment lines wherever it judges copy.

  checkInventedTimingClaim(source, push);
  checkIntlCurrencyCrypto(source, push);
  checkRequiredRenderedOptional(source, push);
  checkBlueprintStateCoverage(source, journey, push);
  checkFixtureHonesty(source, push);

  return findings;
}

type PushFn = (
  rule: string,
  severity: Finding["severity"],
  evidence: string,
  fix: string,
  atIndex: number,
) => boolean;

/**
 * invented-timing-claim - copy that promises a duration, a settlement window
 * or custody behaviour ("1-2 business days", "held until claimed",
 * "estimated arrival") that no API in this stack returns. Rendering such a
 * promise invents a guarantee the backend cannot honour; the journey
 * contracts require a labelled omission instead. Copy rule: comment lines
 * are not copy, so matches on them are skipped.
 */
function checkInventedTimingClaim(source: string, push: PushFn): void {
  const pattern =
    /\b(?:typically|usually|normally|generally)\s+(?:arrives?|takes?|clears?|settles?)\b|\b\d+\s*(?:-|–|to)\s*\d+\s+business\s+days?\b|\bwithin\s+\d+\s+(?:seconds?|minutes?|hours?|days?|business\s+days?)\b|\bheld\s+until\s+claimed\b|\bestimated\s+(?:arrival|delivery|completion)\b/gi;
  for (const match of source.matchAll(pattern)) {
    const at = match.index ?? 0;
    if (isCommentLineAt(source, at)) continue;
    push(
      "invented-timing-claim",
      "error",
      match[0],
      "No API in this stack returns a duration, settlement window or custody guarantee. Render the labelled omission the contract specifies, or - if your own API does return it - name the field path on the line and add venly-allow:invented-timing-claim.",
      at,
    );
  }
}

// --- intl-currency-crypto -------------------------------------------------
// Intl.NumberFormat validates `currency` against ISO 4217, so a crypto asset
// code ("USDC", "DAI", ...) throws RangeError the moment the formatter is
// constructed - a screen that compiles fine crashes on first render. Each
// Intl.NumberFormat call site is judged by the 200 characters that follow it:
// a literal crypto code next to style:"currency" is a certain crash (error);
// a variable-fed `currency:` is a latent one (warn) - it only survives until
// a crypto asset reaches it. Not a copy rule, so comment lines are not
// skipped; suppression still applies via the shared venly-allow hatch.
function checkIntlCurrencyCrypto(source: string, push: PushFn): void {
  const currencyStyle = /style\s*:\s*["']currency["']/;
  const cryptoCode = /["'](?:USDC|EURC|USDT|USDS|DAI|PYUSD|USDG|RLUSD)["']/;
  // `\s*` lives inside the lookahead: with `currency\s*:\s*(?!["'])` the
  // greedy whitespace backtracks to zero and the lookahead inspects the
  // space instead of the quote, flagging `currency: "USD"` as a variable.
  const variableCurrency = /currency\s*:(?!\s*["'])/;

  for (const match of source.matchAll(/Intl\.NumberFormat/g)) {
    const at = match.index ?? 0;
    const window = source.slice(at, at + 200);

    const style = currencyStyle.exec(window);
    if (!style) continue; // plain decimal formatting (the kit's own formatAmount) is safe
    const styleAt = style.index ?? 0;

    const crypto = cryptoCode.exec(window);
    if (crypto) {
      const cryptoAt = crypto.index ?? 0;
      const from = Math.min(styleAt, cryptoAt);
      const to = Math.max(styleAt + style[0].length, cryptoAt + crypto[0].length);
      push(
        "intl-currency-crypto",
        "error",
        window.slice(from, to),
        "Intl.NumberFormat with style:\"currency\" throws RangeError on a non-ISO-4217 code. Render crypto amounts with the Money primitive, which places the code beside the digits instead of inside the formatter.",
        at,
      );
      continue; // one finding per call site; the certain crash outranks the latent one
    }

    const variable = variableCurrency.exec(window);
    if (variable) {
      const variableAt = variable.index ?? 0;
      const from = Math.min(styleAt, variableAt);
      const to = Math.min(
        window.length,
        Math.max(styleAt + style[0].length, variableAt) + 40,
      );
      push(
        "intl-currency-crypto",
        "warn",
        window.slice(from, to),
        "This formatter takes its currency from a variable. If a crypto asset can reach it, it throws at runtime. Use the Money primitive, or narrow the variable to ISO-4217 codes.",
        at,
      );
    }
  }
}

/**
 * A required field labelled as optional. The kit deliberately ships a
 * "(not required)" variant for genuinely optional rows, so the net is scoped
 * tightly: only the payment reference is required-by-contract, and a payer
 * who omits it produces an unmatched credit that someone has to reconcile by
 * hand. The rule therefore fires only when "(not required)" appears on a real
 * code line AND the surrounding code (comments removed) mentions the
 * reference - a comment that merely documents this contract must not trip it.
 */
function checkRequiredRenderedOptional(source: string, push: PushFn): void {
  for (const match of source.matchAll(/\(not required\)/gi)) {
    const idx = match.index ?? 0;
    // Copy rule: only judge rendered copy, never commentary about it.
    if (isCommentLineAt(source, idx)) continue;

    const winStart = Math.max(0, idx - 200);
    const winEnd = Math.min(source.length, idx + match[0].length + 200);

    // Rebuild the window with every comment line removed. Each line is
    // classified on its FULL text (a fragment cut by the window edge could
    // hide its comment marker), but only the in-window portion of surviving
    // code lines feeds the reference test.
    let pos = source.lastIndexOf("\n", Math.max(0, winStart - 1)) + 1;
    let window = "";
    while (pos < winEnd) {
      let lineEnd = source.indexOf("\n", pos);
      if (lineEnd === -1) lineEnd = source.length;
      const line = source.slice(pos, lineEnd);
      if (!COMMENT_LINE.test(line)) {
        const from = Math.max(pos, winStart);
        const to = Math.min(lineEnd, winEnd);
        if (to > from) window += source.slice(from, to) + "\n";
      }
      pos = lineEnd + 1;
    }

    if (!/reference/i.test(window)) continue;

    push(
      "required-rendered-optional",
      "error",
      lineAt(source, idx).trim(),
      'The payment reference is required - a payer who omits it produces an unmatched credit. Render the amber Required pill; never label it "(not required)".',
      idx,
    );
  }
}

function checkBlueprintStateCoverage(
  source: string,
  journey: JourneyKey | undefined,
  push: PushFn,
): void {
  // Only meaningful when the caller declared which journey this screen serves.
  if (journey === undefined) return;

  // Whole-source suppression: this finding has no single offending line (it
  // reports blueprint states absent from the entire file), so the escape
  // hatch is whole-source too - the venly-allow token anywhere drops it.
  if (source.includes("venly-allow:blueprint-state-missing")) return;

  const blueprint: string = JOURNEYS[journey];
  const startMarker = "States that must exist:";
  const startIdx = blueprint.indexOf(startMarker);
  if (startIdx === -1) return;

  let statesText = blueprint.slice(startIdx + startMarker.length);
  const end = /^Rules that must hold/m.exec(statesText);
  if (end) statesText = statesText.slice(0, end.index);
  // Blueprint prose wraps across lines mid-sentence; collapse before parsing.
  statesText = statesText.replace(/\n/g, " ");

  // One state per " · " or "," separator - but only at parenthesis depth 0:
  // a comma inside a parenthetical is part of that state's description, not
  // a state boundary. Naive splitting yields fragments like "terminal)" that
  // no source can contain, making a journey structurally unable to pass.
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of statesText) {
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    if (depth === 0 && (ch === "," || ch === "·")) {
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  parts.push(current);

  // Each state's keyword is the text before the first parenthetical,
  // normalised for a case-insensitive substring probe.
  const keywords: string[] = [];
  for (const part of parts) {
    const keyword = part
      .split("(")[0]
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ")
      .replace(/\.$/, "");
    if (keyword) keywords.push(keyword);
  }

  const lowered = source.toLowerCase();
  const missing = keywords.filter((keyword) => !lowered.includes(keyword));
  if (missing.length === 0) return;

  // One aggregate warn, never per-keyword findings and never an empty-list
  // finding. Warn (not error) because blueprint phrases are prose - a state
  // can be fully implemented under different wording.
  const list = missing.join(", ");
  push(
    "blueprint-state-missing",
    "warn",
    list,
    `The ${journey} blueprint names ${keywords.length} states. These were not found by name in this source: ${list}. Either they are missing or they render under different wording - check each by hand.`,
    0,
  );
}

function checkFixtureHonesty(source: string, push: PushFn): void {
  // Fixture honesty. A demo that seeds parity rates or round-number amounts
  // teaches false patterns: parity hides the crypto/fiat unit distinction,
  // and round numbers let a total look derivable when it is coincidence.

  // ERROR - an explicit parity rate seeded on a rate-named field. Anchored to
  // the three rate names so counters like `rateLimit: 1` never trip it.
  for (const match of source.matchAll(
    /\b(?:exchangeRate|rate|fxRate)\s*[:=]\s*1(?:\.0+)?\b/g,
  )) {
    push(
      "parity-fixture",
      "error",
      match[0],
      "A parity exchange rate makes the crypto/fiat unit distinction numerically invisible, which is the falsehood a real quoted rate exists to prevent. Seed a real non-parity rate.",
      match.index ?? 0,
    );
  }

  // WARN - three or more round-number amounts (x.00) in one source. Comment
  // lines are skipped: this sibling judges seeded copy/fixtures, and prose
  // like "may display as 0.00" is documentation, not a seeded amount. One
  // finding per source, anchored at the first counted match.
  let roundCount = 0;
  let firstRoundIdx = -1;
  for (const match of source.matchAll(/\b\d+\.00\b/g)) {
    const idx = match.index ?? 0;
    if (isCommentLineAt(source, idx)) continue;
    if (firstRoundIdx === -1) firstRoundIdx = idx;
    roundCount++;
  }
  if (roundCount >= 3) {
    push(
      "round-number-coincidence",
      "warn",
      `${roundCount} round-number (.00) amounts seeded in one source`,
      "Round-number fixtures hide arithmetic. If a total is coincidentally equal to a part, the screen teaches a false pattern - use amounts that do not divide evenly.",
      firstRoundIdx,
    );
  }
}

const AGENTS_TEXT = `# Composition rules for coding agents building on the Venly UI registry

Delivery: the shadcn CLI expects a working shadcn environment BEFORE any
registry install. On a fresh Vite/React app that means, in order:
1. Install Tailwind (\`npm i tailwindcss @tailwindcss/vite\`) and wire the
   \`@/\` path alias in tsconfig + vite config - \`shadcn init\` refuses to
   run without both.
2. \`npx shadcn@latest init -y -b radix -p nova\` (the -b/-p flags keep it
   non-interactive; the kit is plain React + Radix-compatible, so any base
   works - it never imports base-library components itself).
3. Add the registry once to components.json -
  { "registries": { "@venlyfinance": "${REGISTRY_URL_TEMPLATE}" } }
4. \`npx shadcn@latest add @venlyfinance/balances @venlyfinance/activity @venlyfinance/receive @venlyfinance/send @venlyfinance/auth @venlyfinance/team @venlyfinance/onboarding -y -o\`.
   Each block auto-installs its components, the venly-tokens file AND its
   npm dependencies (@venlyfinance/react, @venlyfinance/sdk, TanStack
   Query) - no separate npm install step is needed.

Install layout: files land under \`components/venly/\` at the PROJECT ROOT
(not src/), preserving their relative imports - import them with a relative
path (e.g. \`../components/venly/blocks/receive.js\`), not the \`@/\` alias.
The sources use TypeScript-style \`.js\` extensions on .tsx imports: fine
under Vite/esbuild/Next; webpack needs \`extensionAlias\`. Import the
installed venly-tokens css once at the app root.

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
   (pass the journey key so blueprint state coverage is checked too) and fix
   every error-severity finding. Consult get_journey_blueprint before
   designing a screen the registry has no block for.
7. Wire the same audit into the app you generate as a CI step - it is what
   turns the design contract into a gate:
   \`npx @venlyfinance/settlement-mcp review "src/**/*.tsx"\`
   (exit 1 on any error-severity finding). A deliberate, justified exception
   carries venly-allow:<rule-id> on the offending line or the line above.
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
      outputSchema: {
        runtime_contract: RUNTIME_CONTRACT_SCHEMA,
      },
    },
    async ({ journey }) => {
      const structuredContent = {
        runtime_contract: runtimeContractForJourney(journey),
      };
      return {
        content: [
          { type: "text", text: JOURNEYS[journey] },
          {
            type: "text",
            text: `\`\`\`json\n${JSON.stringify(structuredContent, null, 2)}\n\`\`\``,
          },
        ],
        structuredContent,
      };
    },
  );

  server.registerTool(
    "verify_runtime_contract",
    {
      title: "Verify an app's Venly runtime contract",
      description:
        "Deterministically checks supplied app source and package.json against the direct-sdk or backend-proxy runtime contract. The same rules power the verify CLI.",
      inputSchema: {
        files: z
          .array(z.object({ path: z.string().min(1), source: z.string() }))
          .min(1),
        packageJson: z.string().describe("The app's package.json contents"),
        profile: z.enum(["direct-sdk", "backend-proxy"]).optional(),
      },
    },
    async ({ files, packageJson, profile }) => {
      let parsedPackageJson: Record<string, unknown>;
      try {
        parsedPackageJson = JSON.parse(packageJson);
      } catch (error) {
        const message = `Invalid packageJson: ${(error as Error).message}`;
        return {
          content: [{ type: "text", text: message }],
          structuredContent: { error: message },
          isError: true,
        };
      }
      const result = verifyRuntimeContract({ files, packageJson: parsedPackageJson, profile });
      const structuredContent = {
        profile: result.profile,
        findings: result.findings,
        summary: result.summary,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent,
      };
    },
  );

  server.registerTool(
    "review_screen",
    {
      title: "Design-audit a screen",
      description:
        "Deterministic audit of component/markup source against the kit's design contract: raw colours, hyphen-minus amounts, success styling on cancelled steps, masked review values, invented timing/custody copy, crypto codes inside Intl currency formatting, required fields rendered optional, parity and round-number fixtures, zebra striping, off-token shadows, gradients, colour-only state. Pass the journey key to also check the source against that journey's required blueprint states. Suppress a deliberate exception with venly-allow:<rule-id> on the offending line or the line above. Returns findings, not a score.",
      inputSchema: {
        source: z.string().min(1).describe("The component/markup/CSS source to audit"),
        journey: z
          .enum(JOURNEY_KEYS)
          .optional()
          .describe(
            "Optional: which journey this screen implements - enables the blueprint state-coverage check",
          ),
      },
    },
    async ({ source, journey }) => {
      const findings = reviewScreenSource(source, journey);
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
