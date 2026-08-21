import { useMemo, useState, type CSSProperties, type ReactElement } from "react";
import {
  DataTable,
  RowText,
  TableSkeleton,
  type DataTableColumn,
  type DataTableGroup,
} from "../components/data-table.js";
import { ListLoadError } from "../components/list-error.js";
import { StatusPill, type StatusIntent } from "../components/status-pill.js";
import { Money, formatStamp } from "../lib/money.js";

/**
 * Console review queue – the operator worklist.
 *
 * Design contract encoded by this block:
 * - Sections are ACTORS, not statuses: the reviewer's own worklist is the
 *   top band by construction, then waiting-on-the-customer, then
 *   waiting-on-a-provider, then a collapsed Closed section. Empty sections
 *   are still drawn as a zero header row – nothing-to-do is information.
 * - The whose-move value is a PURE function of enum values on the row: no
 *   clock, no threshold, no configuration, no default. A combination the
 *   mapping does not cover renders NO value plus an explicit
 *   not-recognised line – a bug report, never a guess.
 * - No target times, breach colours or overdue states: the API publishes
 *   no targets, and an invented one is the same defect as an invented fee.
 * - Age columns are labelled for what they measure: a created-at delta is
 *   "Age"; only a duration the API itself computes may claim time-in-state.
 * - One status pill per row; the whose-move value is plain text (two pills
 *   in one row read as two states).
 * - A row click opens a side panel and never navigates.
 *
 * The derivation functions are exported so a consumer can unit-test the
 * join – the anti-fabrication device, made portable.
 */

// ─── User-facing copy ────────────────────────────────────────────────────────

export const CONSOLE_QUEUE_COPY = {
  unrecognised: "State not recognised – see detail",
  filteredEmpty: "No rows match your search.",
  filteredEmptyAction: "Clear search",
  export: "Export",
  exportFiltered: "Export filtered",
  searchPlaceholder: "Search name or reference",
  frozen: "Frozen",
} as const;

/** Section labels, in render order. The seat name resolves "OPERATOR". */
export const ACTOR_SECTION_LABELS = {
  OPERATOR: { integrator: "Your move", platform: "Platform move" },
  CUSTOMER: "Waiting on the customer",
  PROVIDER: "Waiting on a provider",
  CLOSED: "Closed",
  UNRECOGNISED: "State not recognised",
} as const;

// ─── The state→actor derivation (pure – no clock, no config, no default) ────

export type WhoseMoveValue = "OPERATOR" | "CUSTOMER" | "PROVIDER";

export type Derivation =
  | { kind: "actor"; actor: WhoseMoveValue; state: string }
  | { kind: "terminal"; state: string }
  | { kind: "unrecognised" };

const actor = (a: WhoseMoveValue, state: string): Derivation => ({ kind: "actor", actor: a, state });
const terminal = (state: string): Derivation => ({ kind: "terminal", state });
const UNRECOGNISED: Derivation = { kind: "unrecognised" };

export interface KycDerivationInput {
  /** `AccountListItemDto.kycStatus`, verbatim. */
  accountKycStatus: string | undefined;
  /**
   * `PartyIvVerificationDto.status` for the holder party. Absent and
   * `NOT_LINKED` are treated identically – the read synthesises
   * `NOT_LINKED` for an unlinked party.
   */
  ivStatus?: string;
  /** Holder `PartyDto.kybStatus` (organisations). */
  partyKybStatus?: string;
  /** Holder `PartyDto.kycStatus` (individuals). */
  partyKycStatus?: string;
}

/**
 * Customer-onboarding whose-move: account `kycStatus` × party IV `status`.
 *
 * Overrides, applied before the table is read:
 * - Party terminal wins: a party-level refusal (`kybStatus: DENIED` for
 *   organisations, `kycStatus: REJECTED` for individuals) is terminal
 *   whatever the account says. Without it, a refused applicant whose
 *   account was never patched would read "waiting on the customer" – the
 *   console sitting on a subject it already refused, in nobody's queue.
 * - Party pending does not create work: a pending party with no IV case is
 *   the not-started row. Party verification is the customer's ceremony.
 * - No derived "documents outstanding" state exists on any plane; nothing
 *   here may invent one.
 * - Account `status` (active/suspended/closed) is a separate axis: a frozen
 *   badge renders IN ADDITION to the row, and never changes whose move the
 *   verification decision is – which is why it is not an input here.
 */
export function deriveKycActor(input: KycDerivationInput): Derivation {
  if (input.partyKybStatus === "DENIED" || input.partyKycStatus === "REJECTED") {
    return terminal("Rejected at party level");
  }
  switch (input.accountKycStatus) {
    case "VERIFIED":
      return terminal("Verified");
    case "REJECTED":
      return terminal("Rejected");
    case "NOT_REQUIRED":
      // A real contract value on the account planes only: an explicit
      // terminal state, never hidden and never conflated with Verified.
      return terminal("Verification not required");
    case "VERIFICATION_PENDING": {
      switch (input.ivStatus ?? "NOT_LINKED") {
        case "NOT_LINKED":
          // Nothing submitted, so nothing is owed by a reviewer.
          return actor("CUSTOMER", "Verification not started");
        case "SUBMITTED":
        case "FORWARDED":
          // Two provider-side states, one operator-facing phrase: the
          // operator does not act differently on them.
          return actor("PROVIDER", "Screening in progress");
        case "ACCEPTED":
        case "COMPLETED":
          // Both are provider-side terminal-success readings; both hand the
          // decision back. The detail shows the literal value; the queue
          // does not fork on it.
          return actor("OPERATOR", "Review – decision owed");
        case "FAILED":
          // A failed screening is still an open account decision. Routing
          // it to the customer would drop it out of every worklist.
          return actor("OPERATOR", "Screening failed – decision owed");
        default:
          return UNRECOGNISED;
      }
    }
    default:
      return UNRECOGNISED;
  }
}

export interface PayoutDerivationInput {
  /** `PayoutDto.status`, verbatim. */
  status: string | undefined;
  /** The reconciliation row's `reconciliationState`; absent off that row. */
  reconciliationState?: string;
}

/**
 * Payout whose-move: `status` × `reconciliationState`.
 *
 * Override: reconciliation attention outranks the lifecycle. STUCK,
 * MISMATCH and NEEDS_REVIEW route to the operator whatever `status` says –
 * the server computed that judgment, and overriding it with our own reading
 * of the lifecycle would discard the one server-side signal available.
 * Every OPERATOR row here is the platform seat: these decisions are
 * management-plane operations.
 */
export function derivePayoutActor(input: PayoutDerivationInput): Derivation {
  switch (input.reconciliationState) {
    case "MISMATCH":
      // An open reconciliation decision whatever the lifecycle says.
      return actor("OPERATOR", "Amount mismatch");
    case "STUCK":
      return actor("OPERATOR", "Stuck at the provider – needs review");
    case "NEEDS_REVIEW":
      return actor("OPERATOR", "Needs review");
    default:
      break;
  }
  const rec = input.reconciliationState;
  switch (input.status) {
    case "REQUESTED":
      return rec === "IN_PROGRESS" || rec === undefined ? actor("PROVIDER", "Requested") : UNRECOGNISED;
    case "SENDING":
      return actor("PROVIDER", "Sending");
    case "PROVIDER_PROCESSING":
      return rec === "IN_PROGRESS" || rec === "MATCHED"
        ? actor("PROVIDER", "At the provider")
        : UNRECOGNISED;
    case "COMPLETED":
      if (rec === "MATCHED") return terminal("Completed");
      // Lifecycle-done, books not closed: confirm-completion is the action.
      if (rec === "IN_PROGRESS" || rec === undefined) {
        return actor("OPERATOR", "Completed – awaiting confirmation");
      }
      return UNRECOGNISED;
    case "RETURNED":
      // Money came back: an open item for the desk, not a closed one.
      return actor("OPERATOR", "Returned");
    case "FAILED":
      return actor("OPERATOR", "Failed");
    case "REJECTED":
      return terminal("Rejected");
    default:
      return UNRECOGNISED;
  }
}

/**
 * Payout ROUTE whose-move – a third axis, never a payout state. A route row
 * never appears in the payout queue; it appears on the customer 360 and in
 * its own section. The ownership proof is a funding-wallet signature only
 * the holder can produce, so that state waits on the customer.
 */
export function deriveRouteActor(status: string | undefined): Derivation {
  switch (status) {
    case "PENDING":
      return actor("OPERATOR", "Pending");
    case "REGISTERING":
      return actor("PROVIDER", "Registering");
    case "AWAITING_OWNERSHIP_PROOF":
      return actor("CUSTOMER", "Awaiting ownership proof");
    case "ACTIVE":
      return terminal("Active");
    case "REJECTED":
      return terminal("Rejected");
    default:
      return UNRECOGNISED;
  }
}

/**
 * Beneficiary bank account whose-move. PENDING waits on the platform seat.
 * That activation is the mock's documented reading of the flow, not a
 * documented contract behaviour – copy built on it should say so.
 */
export function derivePayoutBankAccountActor(status: string | undefined): Derivation {
  switch (status) {
    case "PENDING":
      return actor("OPERATOR", "Pending");
    case "ACTIVE":
      return terminal("Active");
    case "DISABLED":
      return terminal("Disabled");
    default:
      return UNRECOGNISED;
  }
}

// ─── Whose-move rendering (plain text – never a pill) ───────────────────────

export type ConsoleSeat = "integrator" | "platform";

/**
 * The row-level whose-move value: plain grey text, never a pill – two pills
 * in one row read as two states. Terminal rows render nothing: nobody's
 * move, and claiming one on a closed row is the same lie as an invented ETA.
 */
export function WhoseMove({
  derivation,
  seat = "integrator",
  style,
}: {
  derivation: Derivation;
  seat?: ConsoleSeat;
  style?: CSSProperties;
}): ReactElement | null {
  if (derivation.kind === "terminal") return null;
  const text =
    derivation.kind === "unrecognised"
      ? CONSOLE_QUEUE_COPY.unrecognised
      : derivation.actor === "OPERATOR"
        ? ACTOR_SECTION_LABELS.OPERATOR[seat]
        : ACTOR_SECTION_LABELS[derivation.actor];
  return (
    <span
      data-whose-move={derivation.kind === "unrecognised" ? "unrecognised" : derivation.actor}
      style={{
        color: "var(--text-secondary)",
        fontSize: "var(--font-size-label)",
        ...style,
      }}
    >
      {text}
    </span>
  );
}

// ─── Age – a labelled fact, never a target ───────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;

/** "3d 4h" / "5h 12m" / "18m" – duration words, no colour, no threshold. */
export function formatAge(fromIso: string, nowIso: string): string {
  const from = Date.parse(fromIso);
  const now = Date.parse(nowIso);
  if (Number.isNaN(from) || Number.isNaN(now)) return "";
  const ms = Math.max(0, now - from);
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

/**
 * Age cell. Two mutually exclusive sources, labelled by the column header:
 * - `minutes`: a duration the API itself computed (the one place a duration
 *   is a fact rather than a derivation).
 * - `sinceIso`: an "Age" – the delta since a stamp the row carries. Rows
 *   older than 7 days also render the absolute date, because a large
 *   relative number stops being readable.
 * Never a target, never a breach colour, never an "overdue".
 */
export function AgeCell({
  minutes,
  sinceIso,
  nowIso,
  locale,
}: {
  minutes?: number;
  sinceIso?: string;
  /** Injected by the screen so the cell itself reads no clock. */
  nowIso: string;
  locale?: string;
}): ReactElement {
  if (minutes !== undefined) {
    return <span style={{ fontVariantNumeric: "tabular-nums" }}>{minutes}m</span>;
  }
  if (!sinceIso) return <span />;
  const age = formatAge(sinceIso, nowIso);
  const overSevenDays = Date.parse(nowIso) - Date.parse(sinceIso) > 7 * DAY_MS;
  return (
    <span style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
      {age}
      {overSevenDays ? (
        <span style={{ color: "var(--text-tertiary)", marginLeft: "var(--space-2xs)" }}>
          {formatStamp(sinceIso, locale).split(",")[0]}
        </span>
      ) : null}
    </span>
  );
}

// ─── The queue ───────────────────────────────────────────────────────────────

export interface ConsoleQueueRow {
  key: string;
  subject: string;
  subjectSecondary?: string;
  /** The contract enum value, humanised – never a synonym it doesn't carry. */
  state: { label: string; intent: StatusIntent; glyph?: string };
  derivation: Derivation;
  /** Account/party `status` is a separate axis: renders a Frozen badge. */
  frozen?: boolean;
  /** "Age" source: the stamp this row has (createdAt / requestedAt). */
  ageIso?: string;
  /** An API-computed duration, where the row carries one. */
  ageMinutes?: number;
  amount?: number;
  currency?: string;
  /** Machine reference, rendered tabular and ellipsized. */
  reference?: string;
}

export type ConsoleQueueSection = "OPERATOR" | "CUSTOMER" | "PROVIDER" | "CLOSED" | "UNRECOGNISED";

export function queueSectionOf(derivation: Derivation): ConsoleQueueSection {
  if (derivation.kind === "terminal") return "CLOSED";
  if (derivation.kind === "unrecognised") return "UNRECOGNISED";
  return derivation.actor;
}

const SECTION_ORDER: ConsoleQueueSection[] = [
  "UNRECOGNISED",
  "OPERATOR",
  "CUSTOMER",
  "PROVIDER",
  "CLOSED",
];

export function consoleQueueGroups(
  rows: ConsoleQueueRow[],
  seat: ConsoleSeat,
): DataTableGroup<ConsoleQueueRow>[] {
  const bySection = new Map<ConsoleQueueSection, ConsoleQueueRow[]>();
  for (const section of SECTION_ORDER) bySection.set(section, []);
  for (const row of rows) bySection.get(queueSectionOf(row.derivation))!.push(row);
  // Oldest first inside each band: the queue's default sort is the wait.
  for (const sectionRows of bySection.values()) {
    sectionRows.sort((a, b) => (a.ageIso ?? "").localeCompare(b.ageIso ?? ""));
  }
  return SECTION_ORDER.filter(
    // The not-recognised band is a defect surface: drawn only when a row
    // actually failed derivation. The four actor bands are always drawn.
    (section) => section !== "UNRECOGNISED" || bySection.get(section)!.length > 0,
  ).map((section) => ({
    key: section,
    label:
      section === "OPERATOR"
        ? ACTOR_SECTION_LABELS.OPERATOR[seat]
        : ACTOR_SECTION_LABELS[section],
    rows: bySection.get(section)!,
    attention: section === "OPERATOR" || section === "UNRECOGNISED",
  }));
}

/** Client-side CSV over the rows currently shown; values quoted, no BOM. */
export function consoleQueueCsv(rows: ConsoleQueueRow[], seat: ConsoleSeat): string {
  const header = "subject,state,whoseMove,age,amount,currency,reference";
  const quote = (v: string) => `"${v.replaceAll('"', '""')}"`;
  const lines = rows.map((row) => {
    const whose =
      row.derivation.kind === "actor"
        ? row.derivation.actor === "OPERATOR"
          ? ACTOR_SECTION_LABELS.OPERATOR[seat]
          : ACTOR_SECTION_LABELS[row.derivation.actor]
        : row.derivation.kind === "unrecognised"
          ? CONSOLE_QUEUE_COPY.unrecognised
          : "";
    return [
      quote(row.subject),
      quote(row.state.label),
      quote(whose),
      quote(row.ageMinutes !== undefined ? `${row.ageMinutes}m` : row.ageIso ?? ""),
      row.amount !== undefined ? String(row.amount) : "",
      row.currency ?? "",
      quote(row.reference ?? ""),
    ].join(",");
  });
  return [header, ...lines].join("\n");
}

function matchesSearch(row: ConsoleQueueRow, term: string): boolean {
  const needle = term.trim().toLowerCase();
  if (!needle) return true;
  return [row.subject, row.subjectSecondary, row.reference, row.state.label]
    .filter((v): v is string => Boolean(v))
    .some((v) => v.toLowerCase().includes(needle));
}

export interface ConsoleQueueProps {
  rows: ConsoleQueueRow[];
  /** Resolves the OPERATOR band's name: "Your move" vs "Platform move". */
  seat?: ConsoleSeat;
  loading?: boolean;
  /** A missing result collection is an error, never an empty queue. */
  error?: { what: string; onRetry?: () => void };
  /**
   * True-empty copy. The body line must name WHICH actor causes rows to
   * appear here – the anticipatory-empty rule.
   */
  empty: { headline: string; body: string };
  /** Whether the Amount column renders (payout desk: yes; customers: no). */
  showAmount?: boolean;
  /** Header for the age column – says what the number measures. */
  ageHeader?: string;
  /** Injected clock reading, so no cell reads its own. */
  nowIso: string;
  onOpen?: (row: ConsoleQueueRow) => void;
  selectedKey?: string;
  /** Receives the CSV text when the operator exports. */
  onExportCsv?: (csv: string, filtered: boolean) => void;
  locale?: string;
  style?: CSSProperties;
}

export function ConsoleQueue({
  rows,
  seat = "integrator",
  loading,
  error,
  empty,
  showAmount = false,
  ageHeader = "Age",
  nowIso,
  onOpen,
  selectedKey,
  onExportCsv,
  locale,
  style,
}: ConsoleQueueProps): ReactElement {
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({ CLOSED: true });

  const columns = useMemo<DataTableColumn<ConsoleQueueRow>[]>(() => {
    const base: DataTableColumn<ConsoleQueueRow>[] = [
      {
        key: "subject",
        header: "Subject",
        cell: (row) => <RowText primary={row.subject} secondary={row.subjectSecondary} />,
      },
      {
        key: "state",
        header: "State",
        cell: (row) => (
          <span style={{ display: "inline-flex", gap: "var(--space-2xs)", alignItems: "center" }}>
            <StatusPill label={row.state.label} intent={row.state.intent} glyph={row.state.glyph} />
            {row.frozen ? (
              <StatusPill label={CONSOLE_QUEUE_COPY.frozen} intent="neutral" glyph="❄" />
            ) : null}
          </span>
        ),
      },
      {
        key: "whose-move",
        header: "Whose move",
        cell: (row) => <WhoseMove derivation={row.derivation} seat={seat} />,
      },
      {
        key: "age",
        header: ageHeader,
        width: "12%",
        cell: (row) => (
          <AgeCell minutes={row.ageMinutes} sinceIso={row.ageIso} nowIso={nowIso} locale={locale} />
        ),
      },
    ];
    if (showAmount) {
      base.push({
        key: "amount",
        header: "Amount",
        money: true,
        width: "14%",
        cell: (row) => <Money amount={row.amount} currency={row.currency} locale={locale} />,
      });
    }
    base.push({
      key: "reference",
      header: "Reference",
      width: "16%",
      cell: (row) =>
        row.reference ? (
          <span style={{ fontVariantNumeric: "tabular-nums", color: "var(--text-secondary)" }}>
            {row.reference}
          </span>
        ) : null,
    });
    return base;
  }, [seat, showAmount, ageHeader, nowIso, locale]);

  if (loading) {
    return (
      <div style={{ overflowX: "auto", ...style }}>
        <TableSkeleton columns={columns} rows={8} label="Loading the queue" />
      </div>
    );
  }
  if (error) {
    return <ListLoadError what={error.what} onRetry={error.onRetry} />;
  }

  const visible = rows.filter((row) => matchesSearch(row, search));
  const filtered = search.trim().length > 0;
  const groups = consoleQueueGroups(visible, seat);
  const trueEmpty = rows.length === 0;

  return (
    <section style={{ fontFamily: "var(--font-family)", ...style }}>
      <div
        style={{
          display: "flex",
          gap: "var(--space-md)",
          alignItems: "center",
          marginBottom: "var(--space-md)",
          flexWrap: "wrap",
        }}
      >
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={CONSOLE_QUEUE_COPY.searchPlaceholder}
          aria-label={CONSOLE_QUEUE_COPY.searchPlaceholder}
          style={{
            flex: "1 1 220px",
            maxWidth: 320,
            border: "var(--border-w-hairline) solid var(--border-strong)",
            borderRadius: "var(--radius-control)",
            padding: "var(--space-2xs) var(--space-sm)",
            fontSize: "var(--font-size-label)",
            fontFamily: "var(--font-family)",
            color: "var(--text-primary)",
            background: "var(--surface-raised)",
          }}
        />
        {onExportCsv ? (
          <button
            type="button"
            onClick={() => onExportCsv(consoleQueueCsv(visible, seat), filtered)}
            style={{
              border: "var(--border-w-hairline) solid var(--border-strong)",
              background: "var(--surface-raised)",
              color: "var(--text-primary)",
              borderRadius: "var(--radius-control)",
              padding: "var(--space-2xs) var(--space-sm)",
              fontSize: "var(--font-size-label)",
              fontFamily: "var(--font-family)",
              cursor: "pointer",
            }}
          >
            {filtered ? CONSOLE_QUEUE_COPY.exportFiltered : CONSOLE_QUEUE_COPY.export}
          </button>
        ) : null}
      </div>

      {filtered && visible.length === 0 ? (
        <>
          <div style={{ overflowX: "auto" }}>
            <DataTable columns={columns} rows={[]} rowKey={(row) => row.key} emptyMessage=" " />
          </div>
          <div style={{ padding: "var(--space-md) 0" }}>
            <p style={{ margin: 0, fontWeight: 500, color: "var(--text-primary)" }}>
              {CONSOLE_QUEUE_COPY.filteredEmpty}
            </p>
            <button
              type="button"
              onClick={() => setSearch("")}
              style={{
                marginTop: "var(--space-2xs)",
                border: "none",
                background: "none",
                color: "var(--accent)",
                fontSize: "var(--font-size-label)",
                fontFamily: "var(--font-family)",
                padding: 0,
                cursor: "pointer",
              }}
            >
              {CONSOLE_QUEUE_COPY.filteredEmptyAction}
            </button>
          </div>
        </>
      ) : trueEmpty ? (
        <>
          <div style={{ overflowX: "auto" }}>
            <DataTable columns={columns} rows={[]} rowKey={(row) => row.key} emptyMessage=" " />
          </div>
          <div style={{ padding: "var(--space-xl) 0", textAlign: "center" }}>
            <p style={{ margin: 0, fontSize: 16, fontWeight: 600, color: "var(--text-primary)" }}>
              {empty.headline}
            </p>
            <p style={{ margin: "var(--space-2xs) 0 0", color: "var(--text-secondary)" }}>
              {empty.body}
            </p>
          </div>
        </>
      ) : (
        // Wide tables scroll inside their own container - the page itself
        // must never scroll horizontally (the mobile containment rule).
        <div style={{ overflowX: "auto" }}>
          <DataTable
            columns={columns}
            rows={[]}
            rowKey={(row) => row.key}
            groups={groups}
            collapsedGroups={collapsed}
            onGroupToggle={(key, next) => setCollapsed((c) => ({ ...c, [key]: next }))}
            onRowClick={onOpen}
            selectedKey={selectedKey}
          />
        </div>
      )}
    </section>
  );
}
