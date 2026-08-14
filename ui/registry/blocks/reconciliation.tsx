import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from "react";
import type { VirtualBankAccount } from "@venlyfinance/sdk";
import { useVenlyMock, useVirtualBankAccounts } from "@venlyfinance/react";
import {
  DataTable,
  RowText,
  type DataTableColumn,
  type DataTableGroup,
} from "../components/data-table.js";
import { SidePanel } from "../components/side-panel.js";
import { StatusPill, type StatusIntent } from "../components/status-pill.js";
import { FieldList } from "../components/field-list.js";
import { Money, formatAmount } from "../lib/money.js";

/**
 * Reconciliation – match inbound bank credits to the payments you expected.
 *
 * Two feeds with different truth-status, never blurred:
 * - The virtual-bank-account register is Venly's API: Venly issues each
 *   reference code, so a reference matches exactly (after normalization).
 * - The credit rows are YOUR bank/PSP feed. Nothing on this surface claims
 *   Venly observed the money arriving; the feed provenance line says so.
 *
 * Reconciliation is a judging task, so inside the judging workspace the
 * received evidence (amount, reference as received, remitter, value date)
 * sits LEFT of the candidates it is judged against. The one-third queue
 * rail is navigation between judgments, not the judged document.
 *
 * Expected payments are app-side domain: the block takes them as input and
 * transitions their state locally. The API models no reconciliation object;
 * the queue states here are the block's own model, deliberately not API
 * enum values.
 *
 * Keyboard: ↑/↓ step the queue (visible focus tint), Enter opens the
 * focused credit in the workspace, Esc closes it.
 */

// ─── Copy (cold-reader gated) ────────────────────────────────────────────────

export const RECONCILIATION_COPY = {
  provenance:
    "Credits from your bank feed. Venly issues the reference codes; your feed reports what arrived.",
  gloss: "Expected payments are the incoming amounts you are tracking.",
  emptyQueue: "Nothing needs review.",
  emptyQueueDetail: "New credits from your feed will appear here.",
  sourceUnavailable: "We couldn't load your account details – the list may be incomplete.",
  retry: "Retry",
  undoAction: "Undo match",
  undoDetail: "Undo match – reopens the expected payment.",
  confirmNeedsCandidate: "Select an expected payment to confirm against.",
  savePartial: "Save as partially paid",
  selectedMatches: "Selected amount matches the expected payment.",
} as const;

export const SECTION_LABELS = {
  "needs-review": "Needs review",
  "no-usable-reference": "No usable reference",
  matched: "Matched",
  resolved: "Resolved",
} as const;

export type QueueSectionKey = keyof typeof SECTION_LABELS;

export const SECTION_ORDER: QueueSectionKey[] = [
  "needs-review",
  "no-usable-reference",
  "matched",
  "resolved",
];

export const DISPOSITION_LABELS = {
  confirm: "Confirm match",
  "create-expected-payment": "Create a new expected payment",
  "internal-transfer": "Mark as internal transfer",
  query: "Raise a query",
} as const;

export type DispositionKind = keyof typeof DISPOSITION_LABELS;

/** Workspace summary line per resolution, resolved-state copy. */
export const RESOLUTION_SUMMARY: Record<DispositionKind | "partial", string> = {
  confirm: "Match confirmed",
  "create-expected-payment": "New expected payment created",
  "internal-transfer": "Marked as internal transfer",
  query: "Query raised",
  partial: "Saved as partially paid",
};

// ─── Inputs ──────────────────────────────────────────────────────────────────

/**
 * An incoming amount the business is tracking (an invoice, a top-up, a
 * settlement it is owed). App-side domain: supplied by the host app.
 */
export interface ExpectedPayment {
  id: string;
  /** What a reviewer calls it, e.g. the invoice number. */
  label: string;
  payerName?: string | null;
  amount: number;
  currency: string;
  status: "open" | "matched" | "partially-paid";
}

/**
 * One credit as reported by the integrator's own bank/PSP feed. In mock
 * mode the same shape comes from the SDK mock's simulated inbound credits.
 */
export interface InboundCredit {
  id: string;
  /** Reference as received; null means the feed reported none. */
  referenceCode: string | null;
  amount: number;
  currency: string;
  remitterName?: string | null;
  receivedAt?: string;
  valueDate?: string;
  virtualBankAccountId?: string;
}

// ─── Reference matching ──────────────────────────────────────────────────────

/**
 * Normalize a payment reference the way bank remittance text must be read:
 * uppercase, alphanumerics only. Payer banks freely re-case, strip or pad
 * separators, so "ref-abc-123", "REF ABC 123" and "invoice REFABC123 thanks"
 * must all find REF-ABC-123.
 */
export function normalizeReference(text: string): string {
  return text.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Fewer normalized characters than this cannot match safely against free-form text. */
export const MIN_REFERENCE_LENGTH = 4;

export type ReferenceSignal =
  | { verdict: "exact"; virtualBankAccount: VirtualBankAccount }
  | { verdict: "contains"; virtualBankAccount: VirtualBankAccount }
  | { verdict: "none" }
  | { verdict: "too-short" }
  | { verdict: "missing" };

/**
 * Judge one credit's reference against the account's register.
 * The register side is Venly-issued, so it matches exactly after
 * normalization; the credit side is free-form remittance text typed by a
 * payer, so containment is the honest fuzzy match.
 */
export function referenceSignal(
  credit: Pick<InboundCredit, "referenceCode">,
  register: VirtualBankAccount[],
): ReferenceSignal {
  if (credit.referenceCode === null || credit.referenceCode === undefined) {
    return { verdict: "missing" };
  }
  const received = normalizeReference(credit.referenceCode);
  if (received.length < MIN_REFERENCE_LENGTH) {
    return { verdict: "too-short" };
  }
  for (const vba of register) {
    const issued = normalizeReference(vba.referenceCode ?? "");
    if (issued.length >= MIN_REFERENCE_LENGTH && issued === received) {
      return { verdict: "exact", virtualBankAccount: vba };
    }
  }
  for (const vba of register) {
    const issued = normalizeReference(vba.referenceCode ?? "");
    if (issued.length >= MIN_REFERENCE_LENGTH && received.includes(issued)) {
      return { verdict: "contains", virtualBankAccount: vba };
    }
  }
  return { verdict: "none" };
}

// ─── Queue sectioning ────────────────────────────────────────────────────────

export function queueSection(
  signal: ReferenceSignal,
  resolved: boolean,
  reopened: boolean,
): QueueSectionKey {
  if (resolved) return "resolved";
  // A human already judged a reopened credit once; it must be re-judged,
  // never silently returned to the machine-matched section.
  if (reopened) return "needs-review";
  if (signal.verdict === "missing" || signal.verdict === "too-short") {
    return "no-usable-reference";
  }
  if (signal.verdict === "exact" || signal.verdict === "contains") return "matched";
  return "needs-review";
}

// ─── Per-signal rationale (never a bare score) ───────────────────────────────

export interface RationaleRow {
  signal: "reference" | "amount" | "remitter" | "currency";
  text: string;
  verdict: string;
  intent: StatusIntent;
}

export function referenceRationale(signal: ReferenceSignal): RationaleRow {
  switch (signal.verdict) {
    case "exact":
      return { signal: "reference", text: "Reference · exact match", verdict: "Match", intent: "positive" };
    case "contains":
      return {
        signal: "reference",
        text: "Reference · found inside the remittance text",
        verdict: "Match",
        intent: "positive",
      };
    case "too-short":
      return {
        signal: "reference",
        text: "Reference · too short to match safely",
        verdict: "Too short",
        intent: "pending",
      };
    case "missing":
      return { signal: "reference", text: "Reference · no match", verdict: "Not provided", intent: "neutral" };
    case "none":
      return { signal: "reference", text: "Reference · no match", verdict: "No match", intent: "pending" };
  }
}

/**
 * Rationale rows for one credit judged against one candidate expected
 * payment. Each signal carries its own verdict; there is no combined score.
 * When the currencies differ no amount comparison is rendered at all – the
 * block has no rate source and invents none.
 */
export function rationaleRows(
  credit: InboundCredit,
  signal: ReferenceSignal,
  candidate: ExpectedPayment,
): RationaleRow[] {
  const rows: RationaleRow[] = [referenceRationale(signal)];

  if (credit.currency !== candidate.currency) {
    rows.push({
      signal: "currency",
      text: `Currency · differs (${credit.currency} vs ${candidate.currency})`,
      verdict: "Differs",
      intent: "pending",
    });
  } else {
    const diff = Math.round((candidate.amount - credit.amount) * 100) / 100;
    if (diff === 0) {
      rows.push({
        signal: "amount",
        text: `Amount · equals the expected ${formatAmount(candidate.amount)} ${candidate.currency}`,
        verdict: "Match",
        intent: "positive",
      });
    } else if (diff > 0) {
      rows.push({
        signal: "amount",
        text: `Amount · short by ${formatAmount(diff)} ${candidate.currency}`,
        verdict: "Short",
        intent: "pending",
      });
    } else {
      rows.push({
        signal: "amount",
        text: `Amount · over by ${formatAmount(-diff)} ${candidate.currency}`,
        verdict: "Over",
        intent: "pending",
      });
    }
  }

  if (credit.remitterName === null || credit.remitterName === undefined || credit.remitterName === "") {
    rows.push({
      signal: "remitter",
      text: "Remitter · not provided",
      verdict: "Not provided",
      intent: "neutral",
    });
  } else {
    const same =
      candidate.payerName != null &&
      normalizeReference(credit.remitterName) === normalizeReference(candidate.payerName);
    rows.push({
      signal: "remitter",
      text: `Remitter · ${credit.remitterName}`,
      verdict: same ? "Match" : candidate.payerName != null ? "Differs" : "No payer on record",
      intent: same ? "positive" : candidate.payerName != null ? "pending" : "neutral",
    });
  }

  return rows;
}

// ─── Candidate ranking ───────────────────────────────────────────────────────

/**
 * Rank open expected payments for an unmatched credit: amount proximity
 * first, remitter similarity as the tiebreaker. Cross-currency candidates
 * rank below same-currency ones (no conversion exists to compare them).
 */
export function candidateScore(credit: InboundCredit, candidate: ExpectedPayment): number {
  if (credit.currency !== candidate.currency) return 0;
  const proximity =
    candidate.amount === 0
      ? credit.amount === 0
        ? 1
        : 0
      : Math.max(0, 1 - Math.abs(candidate.amount - credit.amount) / candidate.amount);
  let remitter = 0;
  if (credit.remitterName && candidate.payerName) {
    const a = normalizeReference(credit.remitterName);
    const b = normalizeReference(candidate.payerName);
    if (a && b) remitter = a === b ? 0.5 : a.includes(b) || b.includes(a) ? 0.25 : 0;
  }
  return proximity + remitter;
}

export function rankCandidates(
  credit: InboundCredit,
  expectedPayments: ExpectedPayment[],
): ExpectedPayment[] {
  return expectedPayments
    .filter((payment) => payment.status === "open")
    .map((payment) => ({ payment, score: candidateScore(credit, payment) }))
    .sort((a, b) => b.score - a.score)
    .map(({ payment }) => payment);
}

// ─── Many-to-one arithmetic ──────────────────────────────────────────────────

export function selectionSum(amounts: number[]): number {
  return Math.round(amounts.reduce((sum, amount) => sum + amount, 0) * 100) / 100;
}

/** The live difference line under the builder's selected credits. */
export function shortfallLine(sum: number, expected: number, currency: string): string {
  const diff = Math.round((expected - sum) * 100) / 100;
  if (diff === 0) return RECONCILIATION_COPY.selectedMatches;
  if (diff > 0) {
    return `Selected ${formatAmount(sum)} of ${formatAmount(expected)} ${currency} – ${formatAmount(diff)} short.`;
  }
  return `Selected ${formatAmount(sum)} of ${formatAmount(expected)} ${currency} – over by ${formatAmount(-diff)} ${currency}.`;
}

// ─── Resolutions (app-side state transitions) ────────────────────────────────

export interface Resolution {
  creditIds: string[];
  kind: DispositionKind;
  expectedPaymentId?: string;
  partial?: boolean;
}

export interface ReconciliationModel {
  expectedPayments: ExpectedPayment[];
  resolutions: Resolution[];
}

function setPaymentStatus(
  payments: ExpectedPayment[],
  id: string,
  status: ExpectedPayment["status"],
): ExpectedPayment[] {
  return payments.map((payment) => (payment.id === id ? { ...payment, status } : payment));
}

/** Confirm one or several credits against an expected payment. */
export function confirmMatch(
  model: ReconciliationModel,
  creditIds: string[],
  expectedPaymentId: string,
  partial = false,
): ReconciliationModel {
  return {
    expectedPayments: setPaymentStatus(
      model.expectedPayments,
      expectedPaymentId,
      partial ? "partially-paid" : "matched",
    ),
    resolutions: [
      ...model.resolutions,
      { creditIds, kind: "confirm", expectedPaymentId, partial },
    ],
  };
}

/** Turn the credit itself into a new, already-matched expected payment. */
export function createExpectedPaymentFromCredit(
  model: ReconciliationModel,
  credit: InboundCredit,
): ReconciliationModel {
  const created: ExpectedPayment = {
    id: `created-${credit.id}`,
    label: credit.referenceCode ?? "New expected payment",
    payerName: credit.remitterName ?? null,
    amount: credit.amount,
    currency: credit.currency,
    status: "matched",
  };
  return {
    expectedPayments: [...model.expectedPayments, created],
    resolutions: [
      ...model.resolutions,
      { creditIds: [credit.id], kind: "create-expected-payment", expectedPaymentId: created.id },
    ],
  };
}

export function markInternalTransfer(
  model: ReconciliationModel,
  creditId: string,
): ReconciliationModel {
  return {
    ...model,
    resolutions: [...model.resolutions, { creditIds: [creditId], kind: "internal-transfer" }],
  };
}

export function raiseQuery(model: ReconciliationModel, creditId: string): ReconciliationModel {
  return {
    ...model,
    resolutions: [...model.resolutions, { creditIds: [creditId], kind: "query" }],
  };
}

export function resolutionFor(model: ReconciliationModel, creditId: string): Resolution | null {
  return model.resolutions.find((resolution) => resolution.creditIds.includes(creditId)) ?? null;
}

/**
 * Undo a resolution: the expected payment reopens (a created one is
 * removed), and every credit in the resolution returns to Needs review –
 * this is a reversal, not a delete.
 */
export function undoMatch(
  model: ReconciliationModel,
  creditId: string,
): { model: ReconciliationModel; reopenedCreditIds: string[] } {
  const resolution = resolutionFor(model, creditId);
  if (!resolution) return { model, reopenedCreditIds: [] };
  let expectedPayments = model.expectedPayments;
  if (resolution.expectedPaymentId) {
    expectedPayments =
      resolution.kind === "create-expected-payment"
        ? expectedPayments.filter((payment) => payment.id !== resolution.expectedPaymentId)
        : setPaymentStatus(expectedPayments, resolution.expectedPaymentId, "open");
  }
  return {
    model: {
      expectedPayments,
      resolutions: model.resolutions.filter((entry) => entry !== resolution),
    },
    reopenedCreditIds: resolution.creditIds,
  };
}

// ─── Keyboard stepping ───────────────────────────────────────────────────────

export function stepQueueSelection(
  visibleIds: string[],
  currentId: string | null,
  delta: 1 | -1,
): string | null {
  if (visibleIds.length === 0) return null;
  if (currentId === null) return delta === 1 ? visibleIds[0] : null;
  const index = visibleIds.indexOf(currentId);
  if (index === -1) return visibleIds[0];
  const next = index + delta;
  if (next < 0 || next >= visibleIds.length) return currentId;
  return visibleIds[next];
}

// ─── Formatting ──────────────────────────────────────────────────────────────

/** Absolute timestamps only – relative times rot while a queue sits open. */
export function formatAbsolute(iso: string | undefined): string {
  if (!iso) return "Not provided";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Not provided";
  const day = date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  const time = date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
  return `${day}, ${time}`;
}

// ─── Rationale list ──────────────────────────────────────────────────────────

export function RationaleList({
  rows,
  style,
}: {
  rows: RationaleRow[];
  style?: CSSProperties;
}): ReactElement {
  return (
    <dl style={{ margin: 0, fontFamily: "var(--font-family)", fontSize: "var(--font-size-label)", ...style }}>
      {rows.map((row) => (
        <div
          key={`${row.signal}-${row.text}`}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "var(--space-md)",
            padding: "var(--space-2xs) 0",
          }}
        >
          <dt style={{ color: "var(--text-secondary)" }}>{row.text}</dt>
          <dd style={{ margin: 0, flex: "none" }}>
            <StatusPill label={row.verdict} intent={row.intent} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

// ─── Credit queue (the one-third rail) ───────────────────────────────────────

export interface QueueRow {
  credit: InboundCredit;
  signal: ReferenceSignal;
  section: QueueSectionKey;
}

export function buildQueueRows(
  credits: InboundCredit[],
  register: VirtualBankAccount[],
  model: ReconciliationModel,
  reopenedIds: ReadonlySet<string>,
): QueueRow[] {
  return credits.map((credit) => {
    const signal = referenceSignal(credit, register);
    const resolved = resolutionFor(model, credit.id) !== null;
    return { credit, signal, section: queueSection(signal, resolved, reopenedIds.has(credit.id)) };
  });
}

export function queueGroups(rows: QueueRow[]): DataTableGroup<QueueRow>[] {
  return SECTION_ORDER.map((section) => ({
    key: section,
    label: SECTION_LABELS[section],
    rows: rows.filter((row) => row.section === section),
    attention: section === "needs-review",
  }));
}

const QUEUE_COLUMNS: DataTableColumn<QueueRow>[] = [
  {
    key: "credit",
    header: "Credit",
    cell: (row) => (
      <RowText
        primary={row.credit.referenceCode ?? "No reference"}
        secondary={formatAbsolute(row.credit.receivedAt)}
      />
    ),
  },
  {
    key: "amount",
    header: "Amount",
    money: true,
    width: "38%",
    cell: (row) => <Money amount={row.credit.amount} currency={row.credit.currency} />,
  },
];

export function CreditQueue({
  rows,
  focusedId,
  onOpen,
  collapsedGroups,
  onGroupToggle,
  style,
}: {
  rows: QueueRow[];
  focusedId: string | null;
  onOpen: (creditId: string) => void;
  collapsedGroups?: Record<string, boolean>;
  onGroupToggle?: (key: string, collapsed: boolean) => void;
  style?: CSSProperties;
}): ReactElement {
  const groups = queueGroups(rows);
  const awaiting = rows.filter((row) => row.section !== "resolved").length;
  return (
    <section style={{ fontFamily: "var(--font-family)", ...style }}>
      <p
        style={{
          fontSize: "var(--font-size-micro)",
          color: "var(--text-tertiary)",
          margin: "0 0 var(--space-sm)",
        }}
      >
        {RECONCILIATION_COPY.provenance}
      </p>
      <DataTable
        columns={QUEUE_COLUMNS}
        rows={[]}
        rowKey={(row) => row.credit.id}
        groups={groups}
        collapsedGroups={collapsedGroups}
        onGroupToggle={onGroupToggle}
        selectedKey={focusedId ?? undefined}
        onRowClick={(row) => onOpen(row.credit.id)}
      />
      {awaiting === 0 ? (
        <div style={{ padding: "var(--space-lg) 0", color: "var(--text-secondary)" }}>
          <p style={{ margin: 0, fontWeight: 500 }}>{RECONCILIATION_COPY.emptyQueue}</p>
          <p style={{ margin: "var(--space-2xs) 0 0", color: "var(--text-tertiary)" }}>
            {RECONCILIATION_COPY.emptyQueueDetail}
          </p>
        </div>
      ) : null}
    </section>
  );
}

// ─── Many-to-one builder ─────────────────────────────────────────────────────

export function ManyToOneBuilder({
  expectedPayment,
  selectableCredits,
  selectedIds,
  onToggle,
  onConfirm,
  onSavePartial,
  onBack,
}: {
  expectedPayment: ExpectedPayment;
  selectableCredits: InboundCredit[];
  selectedIds: ReadonlySet<string>;
  onToggle: (creditId: string) => void;
  onConfirm: () => void;
  onSavePartial: () => void;
  onBack: () => void;
}): ReactElement {
  const selected = selectableCredits.filter((credit) => selectedIds.has(credit.id));
  const sum = selectionSum(selected.map((credit) => credit.amount));
  const diff = Math.round((expectedPayment.amount - sum) * 100) / 100;
  const line = shortfallLine(sum, expectedPayment.amount, expectedPayment.currency);

  return (
    <section style={{ fontFamily: "var(--font-family)" }}>
      <h3
        style={{
          fontSize: "var(--font-size-body)",
          fontWeight: 600,
          margin: "0 0 var(--space-2xs)",
          color: "var(--text-primary)",
        }}
      >
        Match several credits to {expectedPayment.label}
      </h3>
      <p style={{ margin: "0 0 var(--space-md)", fontSize: "var(--font-size-label)", color: "var(--text-secondary)" }}>
        Expected <Money amount={expectedPayment.amount} currency={expectedPayment.currency} />
        {expectedPayment.payerName ? ` from ${expectedPayment.payerName}` : null}
      </p>

      <div role="group" aria-label="Credits to include">
        {selectableCredits.map((credit) => (
          <label
            key={credit.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--space-sm)",
              padding: "var(--space-xs) 0",
              borderBottom: "var(--border-w-hairline) solid var(--border-hairline)",
              cursor: "pointer",
              fontSize: "var(--font-size-body)",
            }}
          >
            <input
              type="checkbox"
              checked={selectedIds.has(credit.id)}
              onChange={() => onToggle(credit.id)}
            />
            <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {credit.referenceCode ?? "No reference"}
              <span style={{ color: "var(--text-tertiary)", fontSize: "var(--font-size-micro)", marginLeft: "var(--space-sm)" }}>
                {formatAbsolute(credit.receivedAt)}
              </span>
            </span>
            <Money amount={credit.amount} currency={credit.currency} />
          </label>
        ))}
        {selectableCredits.length === 0 ? (
          <p style={{ color: "var(--text-tertiary)", fontSize: "var(--font-size-label)" }}>
            No unresolved credits in {expectedPayment.currency} to include.
          </p>
        ) : null}
      </div>

      {/* The working before the answer: selected rows with literal operators,
          then the running total, then the live difference line. */}
      <div style={{ marginTop: "var(--space-md)" }}>
        {selected.map((credit, index) => (
          <div
            key={credit.id}
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: "var(--space-sm)",
              fontSize: "var(--font-size-label)",
              color: "var(--text-secondary)",
              padding: "var(--space-3xs) 0",
            }}
          >
            <span aria-hidden="true" style={{ width: "1em", textAlign: "center", color: "var(--text-tertiary)" }}>
              {index === 0 ? "" : "+"}
            </span>
            <span style={{ flex: 1 }}>{credit.referenceCode ?? "No reference"}</span>
            <Money amount={credit.amount} currency={credit.currency} />
          </div>
        ))}
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: "var(--space-sm)",
            borderTop: "var(--border-w-hairline) solid var(--border-strong)",
            marginTop: "var(--space-2xs)",
            paddingTop: "var(--space-2xs)",
            fontSize: "var(--font-size-body)",
            fontWeight: 600,
          }}
        >
          <span style={{ flex: 1, fontWeight: 400, color: "var(--text-secondary)" }}>Selected</span>
          <Money amount={sum} currency={expectedPayment.currency} />
        </div>
        <p
          role="status"
          style={{
            margin: "var(--space-sm) 0 0",
            fontSize: "var(--font-size-label)",
            color: diff === 0 ? "var(--text-primary)" : "var(--text-secondary)",
            fontWeight: diff === 0 ? 500 : 400,
          }}
        >
          {line}
        </p>
      </div>

      <div style={{ display: "flex", gap: "var(--space-sm)", marginTop: "var(--space-md)", flexWrap: "wrap" }}>
        <WorkspaceButton
          label={DISPOSITION_LABELS.confirm}
          onClick={onConfirm}
          disabled={diff !== 0}
          primary
        />
        <WorkspaceButton
          label={RECONCILIATION_COPY.savePartial}
          onClick={onSavePartial}
          disabled={selected.length === 0 || diff <= 0}
        />
        <WorkspaceButton label="Back to candidates" onClick={onBack} />
      </div>
      {selected.length === 0 ? (
        <p style={{ marginTop: "var(--space-sm)", fontSize: "var(--font-size-micro)", color: "var(--text-tertiary)" }}>
          Select credits to match against this expected payment.
        </p>
      ) : null}
    </section>
  );
}

// ─── Workspace ───────────────────────────────────────────────────────────────

function WorkspaceButton({
  label,
  onClick,
  disabled,
  primary,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
}): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        border: primary ? "none" : "var(--border-w-hairline) solid var(--border-strong)",
        background: disabled ? "var(--surface-sunken)" : primary ? "var(--accent)" : "var(--surface-raised)",
        color: disabled ? "var(--text-tertiary)" : primary ? "var(--accent-fg)" : "var(--text-primary)",
        borderRadius: "var(--radius-control)",
        padding: "var(--space-sm) var(--space-md)",
        fontSize: "var(--font-size-label)",
        fontWeight: 500,
        fontFamily: "var(--font-family)",
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      {label}
    </button>
  );
}

export interface MatchWorkspaceProps {
  row: QueueRow;
  model: ReconciliationModel;
  onConfirm: (creditId: string, expectedPaymentId: string) => void;
  onCreateExpectedPayment: (credit: InboundCredit) => void;
  onMarkTransfer: (creditId: string) => void;
  onRaiseQuery: (creditId: string) => void;
  onUndo: (creditId: string) => void;
  onConfirmMany: (creditIds: string[], expectedPaymentId: string, partial: boolean) => void;
  /** Credits still open in the queue, offered to the many-to-one builder. */
  unresolvedCredits: InboundCredit[];
  onClose?: () => void;
}

export function MatchWorkspace({
  row,
  model,
  onConfirm,
  onCreateExpectedPayment,
  onMarkTransfer,
  onRaiseQuery,
  onUndo,
  onConfirmMany,
  unresolvedCredits,
  onClose,
}: MatchWorkspaceProps): ReactElement {
  const { credit, signal } = row;
  const [candidateId, setCandidateId] = useState<string | null>(null);
  const [builderFor, setBuilderFor] = useState<string | null>(null);
  const [builderSelection, setBuilderSelection] = useState<ReadonlySet<string>>(
    () => new Set([credit.id]),
  );

  const resolution = resolutionFor(model, credit.id);
  const candidates = useMemo(
    () => rankCandidates(credit, model.expectedPayments),
    [credit, model.expectedPayments],
  );
  const builderPayment = builderFor
    ? model.expectedPayments.find((payment) => payment.id === builderFor) ?? null
    : null;

  const evidence = (
    <FieldList
      fields={[
        { label: "Amount received", value: `${formatAmount(credit.amount)} ${credit.currency}`, mono: true, copyable: false },
        { label: "Reference as received", value: credit.referenceCode ?? "Not provided", mono: true, copyable: false },
        { label: "Remitter", value: credit.remitterName ?? "Not provided", copyable: false },
        { label: "Value date", value: credit.valueDate ? formatAbsolute(credit.valueDate) : "Not provided", copyable: false },
        { label: "Received", value: formatAbsolute(credit.receivedAt), copyable: false },
      ]}
    />
  );

  return (
    <SidePanel
      context={`Credit · ${formatAbsolute(credit.receivedAt)}`}
      amount={credit.amount}
      currency={credit.currency}
      qualifier={credit.remitterName ?? "Remitter · not provided"}
      onClose={onClose}
      style={{
        position: "static",
        width: "auto",
        minWidth: 0,
        boxShadow: "none",
        borderLeft: "var(--border-w-hairline) solid var(--border-hairline)",
      }}
    >
      {resolution ? (
        <section>
          <StatusPill
            label={RESOLUTION_SUMMARY[resolution.partial ? "partial" : resolution.kind]}
            intent="positive"
          />
          {resolution.expectedPaymentId ? (
            <p style={{ fontSize: "var(--font-size-label)", color: "var(--text-secondary)" }}>
              Expected payment:{" "}
              {model.expectedPayments.find((payment) => payment.id === resolution.expectedPaymentId)
                ?.label ?? resolution.expectedPaymentId}
            </p>
          ) : null}
          <div style={{ marginTop: "var(--space-md)" }}>
            <WorkspaceButton label={RECONCILIATION_COPY.undoAction} onClick={() => onUndo(credit.id)} />
            <p style={{ marginTop: "var(--space-2xs)", fontSize: "var(--font-size-micro)", color: "var(--text-tertiary)" }}>
              {RECONCILIATION_COPY.undoDetail}
            </p>
          </div>
          <div style={{ marginTop: "var(--space-lg)" }}>{evidence}</div>
        </section>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(220px, 2fr) 3fr",
            gap: "var(--space-xl)",
            alignItems: "start",
          }}
        >
          {/* Received evidence – the judged document – left of the candidates. */}
          <section aria-label="Received evidence">
            <h3
              style={{
                fontSize: "var(--font-size-micro)",
                fontWeight: 500,
                color: "var(--text-tertiary)",
                textTransform: "uppercase",
                letterSpacing: "0.04em",
                margin: "0 0 var(--space-sm)",
              }}
            >
              Received
            </h3>
            {evidence}
          </section>

          <section aria-label="Candidate expected payments">
            {builderPayment ? (
              <ManyToOneBuilder
                expectedPayment={builderPayment}
                selectableCredits={unresolvedCredits.filter(
                  (entry) => entry.currency === builderPayment.currency,
                )}
                selectedIds={builderSelection}
                onToggle={(creditId) =>
                  setBuilderSelection((current) => {
                    const next = new Set(current);
                    if (next.has(creditId)) next.delete(creditId);
                    else next.add(creditId);
                    return next;
                  })
                }
                onConfirm={() => {
                  onConfirmMany([...builderSelection], builderPayment.id, false);
                  setBuilderFor(null);
                }}
                onSavePartial={() => {
                  onConfirmMany([...builderSelection], builderPayment.id, true);
                  setBuilderFor(null);
                }}
                onBack={() => setBuilderFor(null)}
              />
            ) : (
              <>
                <h3
                  style={{
                    fontSize: "var(--font-size-micro)",
                    fontWeight: 500,
                    color: "var(--text-tertiary)",
                    textTransform: "uppercase",
                    letterSpacing: "0.04em",
                    margin: "0 0 var(--space-2xs)",
                  }}
                >
                  Candidate expected payments
                </h3>
                <p style={{ margin: "0 0 var(--space-md)", fontSize: "var(--font-size-micro)", color: "var(--text-tertiary)" }}>
                  {RECONCILIATION_COPY.gloss}
                </p>
                {candidates.length === 0 ? (
                  <p style={{ fontSize: "var(--font-size-label)", color: "var(--text-secondary)" }}>
                    No open expected payments to compare against. You can create one from this credit below.
                  </p>
                ) : (
                  candidates.map((candidate) => {
                    const selected = candidate.id === candidateId;
                    return (
                      <div
                        key={candidate.id}
                        style={{
                          border: selected
                            ? "var(--border-w-strong) solid var(--border-strong)"
                            : "var(--border-w-hairline) solid var(--border-hairline)",
                          borderRadius: "var(--radius-card)",
                          padding: "var(--space-md)",
                          marginBottom: "var(--space-sm)",
                          background: selected ? "var(--selected-tint)" : "var(--surface-raised)",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "baseline", gap: "var(--space-md)" }}>
                          <span style={{ flex: 1, fontWeight: 500 }}>{candidate.label}</span>
                          <Money amount={candidate.amount} currency={candidate.currency} />
                        </div>
                        {candidate.payerName ? (
                          <p style={{ margin: "var(--space-3xs) 0 0", fontSize: "var(--font-size-micro)", color: "var(--text-tertiary)" }}>
                            {candidate.payerName}
                          </p>
                        ) : null}
                        <div style={{ marginTop: "var(--space-sm)" }}>
                          <RationaleList rows={rationaleRows(credit, signal, candidate)} />
                        </div>
                        <div style={{ display: "flex", gap: "var(--space-sm)", marginTop: "var(--space-sm)" }}>
                          <button
                            type="button"
                            aria-pressed={selected}
                            onClick={() => setCandidateId(selected ? null : candidate.id)}
                            style={{
                              border: "var(--border-w-hairline) solid var(--border-strong)",
                              background: selected ? "var(--accent)" : "var(--surface-raised)",
                              color: selected ? "var(--accent-fg)" : "var(--text-primary)",
                              borderRadius: "var(--radius-control)",
                              padding: "var(--space-2xs) var(--space-md)",
                              fontSize: "var(--font-size-label)",
                              fontFamily: "var(--font-family)",
                              cursor: "pointer",
                            }}
                          >
                            {selected ? "Selected" : "Select"}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setBuilderFor(candidate.id);
                              setBuilderSelection(new Set([credit.id]));
                            }}
                            style={{
                              border: "none",
                              background: "none",
                              color: "var(--text-secondary)",
                              fontSize: "var(--font-size-label)",
                              fontFamily: "var(--font-family)",
                              cursor: "pointer",
                              textDecoration: "underline",
                            }}
                          >
                            Match several credits
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}

                {/* Four peer dispositions – equal weight, no false hierarchy. */}
                <div style={{ display: "flex", gap: "var(--space-sm)", marginTop: "var(--space-md)", flexWrap: "wrap" }}>
                  <WorkspaceButton
                    label={DISPOSITION_LABELS.confirm}
                    onClick={() => candidateId && onConfirm(credit.id, candidateId)}
                    disabled={candidateId === null}
                  />
                  <WorkspaceButton
                    label={DISPOSITION_LABELS["create-expected-payment"]}
                    onClick={() => onCreateExpectedPayment(credit)}
                  />
                  <WorkspaceButton
                    label={DISPOSITION_LABELS["internal-transfer"]}
                    onClick={() => onMarkTransfer(credit.id)}
                  />
                  <WorkspaceButton label={DISPOSITION_LABELS.query} onClick={() => onRaiseQuery(credit.id)} />
                </div>
                {candidateId === null ? (
                  <p style={{ marginTop: "var(--space-sm)", fontSize: "var(--font-size-micro)", color: "var(--text-tertiary)" }}>
                    {RECONCILIATION_COPY.confirmNeedsCandidate}
                  </p>
                ) : null}
              </>
            )}
          </section>
        </div>
      )}
    </SidePanel>
  );
}

// ─── The view (split pane) ───────────────────────────────────────────────────

export interface ReconciliationViewProps {
  virtualBankAccounts: VirtualBankAccount[];
  credits: InboundCredit[];
  expectedPayments: ExpectedPayment[];
  style?: CSSProperties;
}

export function ReconciliationView({
  virtualBankAccounts,
  credits,
  expectedPayments,
  style,
}: ReconciliationViewProps): ReactElement {
  const [model, setModel] = useState<ReconciliationModel>(() => ({
    expectedPayments,
    resolutions: [],
  }));
  const [reopenedIds, setReopenedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

  const rows = useMemo(
    () => buildQueueRows(credits, virtualBankAccounts, model, reopenedIds),
    [credits, virtualBankAccounts, model, reopenedIds],
  );

  const orderedRows = useMemo(
    () => SECTION_ORDER.flatMap((section) => rows.filter((row) => row.section === section)),
    [rows],
  );
  const steppableIds = useMemo(
    () =>
      orderedRows
        .filter((row) => !collapsedGroups[row.section])
        .map((row) => row.credit.id),
    [orderedRows, collapsedGroups],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (event.key === "Escape") {
        setOpenId(null);
      } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        setFocusedId((current) =>
          stepQueueSelection(steppableIds, current, event.key === "ArrowDown" ? 1 : -1),
        );
      } else if (event.key === "Enter") {
        setFocusedId((current) => {
          if (current) setOpenId(current);
          return current;
        });
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [steppableIds]);

  const openRow = openId ? orderedRows.find((row) => row.credit.id === openId) ?? null : null;
  const unresolvedCredits = useMemo(
    () => rows.filter((row) => row.section !== "resolved").map((row) => row.credit),
    [rows],
  );

  const clearReopened = (creditIds: string[]) =>
    setReopenedIds((current) => {
      const next = new Set(current);
      for (const id of creditIds) next.delete(id);
      return next;
    });

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(280px, 1fr) 2fr",
        gap: "var(--space-xl)",
        alignItems: "start",
        fontFamily: "var(--font-family)",
        ...style,
      }}
    >
      <CreditQueue
        rows={rows}
        focusedId={focusedId}
        onOpen={(creditId) => {
          setFocusedId(creditId);
          setOpenId(creditId);
        }}
        collapsedGroups={collapsedGroups}
        onGroupToggle={(key, collapsed) =>
          setCollapsedGroups((current) => ({ ...current, [key]: collapsed }))
        }
      />
      {openRow ? (
        <MatchWorkspace
          key={openRow.credit.id}
          row={openRow}
          model={model}
          unresolvedCredits={unresolvedCredits}
          onClose={() => setOpenId(null)}
          onConfirm={(creditId, expectedPaymentId) => {
            setModel((current) => confirmMatch(current, [creditId], expectedPaymentId));
            clearReopened([creditId]);
          }}
          onConfirmMany={(creditIds, expectedPaymentId, partial) => {
            setModel((current) => confirmMatch(current, creditIds, expectedPaymentId, partial));
            clearReopened(creditIds);
          }}
          onCreateExpectedPayment={(credit) => {
            setModel((current) => createExpectedPaymentFromCredit(current, credit));
            clearReopened([credit.id]);
          }}
          onMarkTransfer={(creditId) => {
            setModel((current) => markInternalTransfer(current, creditId));
            clearReopened([creditId]);
          }}
          onRaiseQuery={(creditId) => {
            setModel((current) => raiseQuery(current, creditId));
            clearReopened([creditId]);
          }}
          onUndo={(creditId) => {
            setModel((current) => {
              const { model: next, reopenedCreditIds } = undoMatch(current, creditId);
              setReopenedIds((ids) => {
                const merged = new Set(ids);
                for (const id of reopenedCreditIds) merged.add(id);
                return merged;
              });
              return next;
            });
          }}
        />
      ) : (
        <div
          style={{
            color: "var(--text-tertiary)",
            fontSize: "var(--font-size-label)",
            padding: "var(--space-2xl) var(--space-lg)",
          }}
        >
          Select a credit to review it here.
        </div>
      )}
    </div>
  );
}

// ─── Source-unavailable state ────────────────────────────────────────────────

export function SourceUnavailable({ onRetry }: { onRetry?: () => void }): ReactElement {
  return (
    <section role="alert" style={{ fontFamily: "var(--font-family)" }}>
      <p
        style={{
          background: "var(--state-pending-bg)",
          color: "var(--state-pending-fg)",
          borderRadius: "var(--radius-control)",
          padding: "var(--space-sm) var(--space-md)",
          fontSize: "var(--font-size-label)",
          margin: 0,
        }}
      >
        <span aria-hidden="true">⚠</span> {RECONCILIATION_COPY.sourceUnavailable}
      </p>
      {onRetry ? (
        <div style={{ marginTop: "var(--space-sm)" }}>
          <WorkspaceButton label={RECONCILIATION_COPY.retry} onClick={onRetry} />
        </div>
      ) : null}
    </section>
  );
}

// ─── Connected block ─────────────────────────────────────────────────────────

/**
 * Data-bound entry point for /reconciliation.
 *
 * The virtual-bank-account register comes from the account's own list. The
 * credit feed is yours: pass `credits` from your bank/PSP integration. In
 * mock mode the prop can be omitted – the block reads the mock client's
 * simulated inbound credits so the queue is demonstrable with zero
 * credentials.
 */
export function ReconciliationBlock({
  accountId,
  expectedPayments,
  credits,
  style,
}: {
  accountId: string;
  expectedPayments: ExpectedPayment[];
  credits?: InboundCredit[];
  style?: CSSProperties;
}): ReactElement {
  const vbaQuery = useVirtualBankAccounts(accountId);
  const { finance } = useVenlyMock();

  // Read the mock feed on every render, not once: simulated credits arrive
  // between renders (driver panels, walkthrough scripts), and a memoized
  // snapshot would hide them until a remount.
  const feed: InboundCredit[] = credits ?? (finance ? finance.listInboundCredits() : []);

  if (vbaQuery.isPending) {
    return (
      <section style={{ fontFamily: "var(--font-family)" }}>
        <p style={{ color: "var(--text-tertiary)" }}>Loading account details...</p>
      </section>
    );
  }

  const page = vbaQuery.data as
    | { items?: (VirtualBankAccount | null)[]; resultPresent?: boolean }
    | undefined;

  // A missing result collection is an error, never an empty queue: an empty
  // exception queue claims "all done", which this state cannot support.
  if (vbaQuery.isError || !page || page.resultPresent === false) {
    return <SourceUnavailable onRetry={() => void vbaQuery.refetch()} />;
  }

  const register = (page.items ?? []).filter(
    (item): item is VirtualBankAccount => item != null,
  );

  return (
    <ReconciliationView
      virtualBankAccounts={register}
      credits={feed}
      expectedPayments={expectedPayments}
      style={style}
    />
  );
}
