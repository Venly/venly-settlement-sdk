/**
 * Builds the shadcn-standard registry from ui/registry sources.
 *
 * Emits ui/r/{name}.json (one per item, file content inlined) plus
 * ui/r/registry.json (the index). The output is committed so any static
 * host can serve it; until venlyfinance.com/r/ is wired, consumers point
 * their components.json at the raw GitHub URL template:
 *
 *   { "registries": { "@venlyfinance":
 *     "https://raw.githubusercontent.com/Venly/venly-settlement-sdk/main/ui/r/{name}.json" } }
 *
 * Install targets mirror the registry layout under components/venly/ so the
 * sources' relative imports keep working verbatim after installation.
 *
 * CI runs this script and fails on any diff: the committed JSON can never
 * drift from the sources.
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const uiRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(uiRoot, "r");

const HOMEPAGE = "https://github.com/Venly/venly-settlement-sdk/tree/main/ui";
const SCHEMA_ITEM = "https://ui.shadcn.com/schema/registry-item.json";
const SCHEMA_INDEX = "https://ui.shadcn.com/schema/registry.json";

const RUNTIME_DEPENDENCIES = [
  "@venlyfinance/react@^0.4.0",
  "@venlyfinance/sdk@^0.5.0",
  "@tanstack/react-query@^5.0.0",
];

/** target root that keeps the sources' relative imports intact */
const TARGET_ROOT = "~/components/venly";

function file(relPath, fileType, target) {
  return {
    path: `registry/${relPath}`,
    type: fileType,
    target: target ?? `${TARGET_ROOT}/${relPath}`,
    content: readFileSync(join(uiRoot, "registry", relPath), "utf8"),
  };
}

const TOKENS = {
  $schema: SCHEMA_ITEM,
  name: "venly-tokens",
  type: "registry:item",
  title: "Venly design tokens",
  description:
    "The white-label contract: every colour, radius, type size, density and spacing value the kit reads. A reskin edits this file and nothing else.",
  files: [file("styles/tokens.css", "registry:file", `${TARGET_ROOT}/styles/tokens.css`)],
};

const AGENTS = {
  $schema: SCHEMA_ITEM,
  name: "agents",
  type: "registry:item",
  title: "Agent composition rules",
  description:
     "The rules a coding agent must follow when assembling a money product on this kit: hooks over hand-rolled calls, stage-then-confirm, no clientSecret in the browser, render the rule not the error. Installs at your repo root so it sits beside the code being written.",
  files: [file("AGENTS.md", "registry:file", "~/AGENTS.md")],
};

const MONEY = {
  $schema: SCHEMA_ITEM,
  name: "money",
  type: "registry:lib",
  title: "Money rendering",
  description:
    "Tabular figures, trailing currency code at 0.6x, true minus, debits never red, em-dash empty values.",
  // money.tsx reads --font-size-* and --text-* custom properties, so a
  // standalone `add @venlyfinance/money` must land the tokens file too.
  registryDependencies: ["@venlyfinance/venly-tokens"],
  files: [file("lib/money.tsx", "registry:lib")],
};

const COMPONENTS = [
  {
    name: "status-pill",
    title: "Status pill",
    description:
      "Word plus glyph on every state so status survives greyscale; tinted background, 4px data-value rectangle.",
    deps: [],
  },
  {
    name: "data-table",
    title: "Data table",
    description:
      "The ledger register: token-driven row pitch, hairline-only header, right-aligned tabular money, em-dash empties, no zebra, no shadow.",
    deps: [],
  },
  {
    name: "timeline",
    title: "Vertical timeline",
    description:
      "Three-axis state story: solid past, dotted future, donut current; terminal failure is never a green check.",
    deps: [],
  },
  {
    name: "balance-card",
    title: "Balance card",
    description:
      "The available/reserved composition: available is the only figure above the rule; reserved demoted by position and scale, padlocked when unspendable.",
    deps: ["money"],
  },
  {
    name: "side-panel",
    title: "Side panel",
    description:
      "Record detail beside the table, never a navigation: scrimless, the amount is the hero, arrow-key row stepping.",
    deps: ["money"],
  },
  {
    name: "field-list",
    title: "Field list with copy",
    description:
      "The receive surface: bare values, per-field copy naming the field, amber Required pill, '(not required)' variants instead of vanishing rows.",
    deps: [],
  },
  {
    name: "list-error",
    title: "List load error",
    description:
      "Error state for list-bearing surfaces: a missing result collection (resultPresent === false) renders as an explicit alert with retry, never as an empty list claiming 'all clear'.",
    deps: [],
  },
  {
    name: "arithmetic-ladder",
    title: "Arithmetic ladder",
    description:
      "Transfer review: literal operators in the gutter, working before the answer, tint-band total, uncertainty attached to the number.",
    deps: ["money"],
  },
].map((c) => ({
  $schema: SCHEMA_ITEM,
  name: c.name,
  type: "registry:component",
  title: c.title,
  description: c.description,
  registryDependencies: ["@venlyfinance/venly-tokens", ...c.deps.map((d) => `@venlyfinance/${d}`)],
  files: [file(`components/${c.name}.tsx`, "registry:component")],
}));

const BLOCKS = [
  {
    name: "auth",
    title: "Auth block",
    description:
      "Sign-in, two-factor challenge and sign-up over a bring-your-own-auth adapter: the Venly APIs authenticate machines, not people, so these forms render YOUR identity layer. Ships a zero-credential mock adapter with a deterministic 2FA path.",
    deps: [],
    // Adapter-backed: no SDK/react-query runtime, just the behavior primitive.
    npm: ["@radix-ui/react-one-time-password-field@^0.1.16"],
    money: false,
  },
  {
    name: "team",
    title: "Team block",
    description:
      "Member list, invites and role control over the same bring-your-own-auth boundary: status as word plus glyph, row-level role controls, self-actions disabled with the reason, and a mock invite that mints a link instead of claiming an email went out.",
    deps: ["data-table", "status-pill", "auth"],
    npm: ["@radix-ui/react-dialog@^1.1.23"],
    money: false,
  },
  {
    name: "onboarding",
    title: "Onboarding block",
    description:
      "Company details in, an application status out: creates the organisation and its account through the real operations, renders the verification status verbatim with a humane waiting state, decline-with-review, and a restricted-mode banner.",
    deps: ["status-pill", "timeline", "field-list"],
    money: false,
  },
  {
    name: "bank-accounts",
    title: "Bank accounts block",
    description:
      "The whitelisting surface withdrawals depend on: your company's own accounts (never third-party payees), seven account-type variants asking exactly the fields each requires, identifier re-entry against transcription slips, and verification status rendered verbatim.",
    deps: ["data-table", "status-pill", "list-error"],
    money: false,
  },
  {
    name: "withdraw",
    title: "Withdraw block",
    description:
      "Fiat out to your own verified bank account, rendered truthfully: destination picker that disables unverified accounts with the reason, a fee quote in the unit you typed, four-eyes approval that renders the rule instead of the error, deposit instructions with the mandatory reference, and an event timeline with actors and absolute timestamps.",
    deps: ["data-table", "status-pill", "timeline", "field-list", "arithmetic-ladder", "bank-accounts", "list-error"],
  },
  {
    name: "receive",
    title: "Receive block",
    description:
      "Bank details a payer's finance team actually reads: mandatory payment-reference enforcement, warning above the fields, copy that names the field.",
    deps: ["field-list", "list-error"],
  },
  {
    name: "send",
    title: "Send block",
    description:
      "Stage-then-confirm rendered: form, arithmetic-ladder review, a commit button that restates the amount, single execution on a pinned idempotency key, status timeline.",
    deps: ["arithmetic-ladder", "timeline"],
  },
  {
    name: "activity",
    title: "Activity block",
    description:
      "One feed over both money rails: the account's transfers interleaved with the company's withdrawals and add-money requests, a labelled Scope column, three bands (In progress / Completed / Didn't complete), live-synced detail panels, unified CSV export, and arrow-key row stepping. Mount UnifiedActivityBlock for the full feed, or ActivityBlock for a transfers-only ledger.",
    deps: ["data-table", "status-pill", "side-panel", "timeline", "field-list", "withdraw", "list-error"],
  },
  {
    name: "statements",
    title: "Statements block",
    description:
      "A fixed-period account statement: calendar-month or custom range, identity (party, account, vIBAN when present), opening and closing walked from the current wallet total through completed transfers, ordered rows, and a print-to-PDF download that reuses the receive pipeline. Coverage is labelled: pay-in sessions are not in this feed.",
    deps: ["data-table", "field-list", "list-error", "activity"],
  },
  {
    name: "reconciliation",
    title: "Reconciliation block",
    description:
      "Match inbound bank credits to expected payments without blurring the two feeds: the credit rows are the integrator's own bank/PSP feed (labelled so), the reference codes are Venly-issued. Sectioned exception queue with zero-counts always drawn, a judging workspace with the received evidence left of the candidates, per-signal match rationale instead of a score, a many-to-one builder with a live difference figure, four peer dispositions, and undo that reopens the expected payment.",
    deps: ["data-table", "side-panel", "status-pill", "field-list"],
    // Amount rendering arrives transitively: side-panel already delivers the
    // money lib, and the blueprint's item list for this journey is verbatim
    // venly-tokens + the four components above.
    money: false,
  },
  {
    name: "balances",
    title: "Balances block",
    description:
      "The home surface on the real wallet balance source: available/reserved hero per asset, segmented bar behind the two-bucket threshold, per-asset table, and masking that covers every figure including the chrome miniature.",
    deps: ["balance-card", "data-table"],
  },
].map((b) => ({
  $schema: SCHEMA_ITEM,
  name: b.name,
  type: "registry:block",
  title: b.title,
  description: b.description,
  dependencies: b.npm ?? RUNTIME_DEPENDENCIES,
  registryDependencies: [
    "@venlyfinance/venly-tokens",
    ...(b.money === false ? [] : ["@venlyfinance/money"]),
    ...b.deps.map((d) => `@venlyfinance/${d}`),
  ],
  files: [file(`blocks/${b.name}.tsx`, "registry:component")],
}));

const items = [TOKENS, AGENTS, MONEY, ...COMPONENTS, ...BLOCKS];

// Guard: every source file in the registry must be delivered by exactly one item.
const delivered = new Set(items.flatMap((i) => i.files.map((f) => f.path)));
const sources = [];
for (const dir of ["styles", "lib", "components", "blocks"]) {
  for (const f of readdirSync(join(uiRoot, "registry", dir))) {
    sources.push(`registry/${dir}/${f}`);
  }
}
const missing = sources.filter((s) => !delivered.has(s));
if (missing.length > 0) {
  console.error("Registry item missing for source file(s):", missing.join(", "));
  process.exit(1);
}

// Bare names would resolve against the DEFAULT shadcn registry and 404;
// every cross-item reference must be namespaced and must exist here.
const itemNames = new Set(items.map((i) => i.name));
const badRefs = items.flatMap((i) =>
  (i.registryDependencies ?? [])
    .filter((d) => !d.startsWith("@venlyfinance/") || !itemNames.has(d.slice("@venlyfinance/".length)))
    .map((d) => `${i.name} -> ${d}`),
);
if (badRefs.length > 0) {
  console.error("Unresolvable or un-namespaced registryDependencies:", badRefs.join(", "));
  process.exit(1);
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
for (const item of items) {
  writeFileSync(join(outDir, `${item.name}.json`), JSON.stringify(item, null, 2) + "\n");
}

const index = {
  $schema: SCHEMA_INDEX,
  name: "venlyfinance",
  homepage: HOMEPAGE,
  items: items.map(({ files, ...meta }) => ({
    ...meta,
    files: files.map(({ content: _content, ...f }) => f),
  })),
};
writeFileSync(join(outDir, "registry.json"), JSON.stringify(index, null, 2) + "\n");

console.log(`wrote ${items.length} items + registry.json to ${outDir}`);
