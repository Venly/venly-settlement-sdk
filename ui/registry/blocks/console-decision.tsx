import { useState, type CSSProperties, type ReactElement, type ReactNode } from "react";
import { FieldList, type FieldRow } from "../components/field-list.js";
import { SidePanel } from "../components/side-panel.js";
import { StatusPill, type StatusIntent } from "../components/status-pill.js";
import { Timeline, type TimelineStep, type TimelineStepState } from "../components/timeline.js";
import { Money, formatStamp } from "../lib/money.js";
import {
  WhoseMove,
  type ConsoleSeat,
  type Derivation,
} from "./console-queue.js";

/**
 * Console decision detail – evidence, ceremony, audit trail.
 *
 * Design contract encoded by this block:
 * - Every evidence row is a real field path or a labelled OMISSION, and the
 *   omission is a first-class type in the props – a build cannot render a
 *   placeholder where a gap belongs. Omission copy states only what is
 *   verified: never a result, never a pending state, never a clean one, and
 *   never developer diagnostics about API contracts.
 * - A field the API cannot carry is captured anyway when the work needs it,
 *   and badged as a console note – the product telling the truth about its
 *   own plumbing.
 * - Every decision carries the optimistic-locking version. A conflict means
 *   refetch and re-decide against fresh state; nothing here auto-retries.
 * - Two timeline columns, not one feed: the decision chain (who decided
 *   what, when, in which seat) beside money movement on the same subject.
 *   A store resync renders as a thin grey system line, never as a node in
 *   the decision chain.
 * - Management-plane controls sit inside a badged platform-seat section –
 *   an action the integrator cannot perform in production is never
 *   rendered as theirs.
 */

// ─── User-facing copy ────────────────────────────────────────────────────────

export const CONSOLE_DECISION_COPY = {
  reasonBadge: "Console note – not on the API",
  reasonLabel: "Reason",
  reasonRequired: "A reason is required to reject.",
  conflictHeadline: "Someone decided first",
  conflictBody:
    "This record changed while you were reviewing it. The view below was refreshed – review the new state and decide again.",
  conflictAction: "Review fresh state",
  platformBadgeLabel: "Platform view (Venly)",
  platformBadgeBody: "Venly platform operations. Your team does not perform this in production.",
  driverBadge: "Demo driver – not a contract operation",
  systemResync: "View refreshed from another window",
  decisionColumn: "Decision",
  moneyColumn: "Money movement",
  emptyTrail: "No events yet for this record.",
} as const;

// ─── Seat badge (a section boundary, not a per-button label) ─────────────────

/**
 * The platform-seat section boundary: 11px uppercase label over a hairline,
 * plus one grey line naming the authority. No colour fill – a coloured badge
 * would read as a status pill and compete with the queue's vocabulary.
 */
export function PlatformSection({
  children,
  style,
}: {
  children?: ReactNode;
  style?: CSSProperties;
}): ReactElement {
  return (
    <section
      data-seat="platform"
      style={{
        borderTop: "var(--border-w-hairline) solid var(--border-strong)",
        paddingTop: "var(--space-sm)",
        marginTop: "var(--space-lg)",
        ...style,
      }}
    >
      <p
        style={{
          margin: 0,
          fontSize: "var(--font-size-micro)",
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "var(--text-secondary)",
          fontWeight: 600,
        }}
      >
        {CONSOLE_DECISION_COPY.platformBadgeLabel}
      </p>
      <p
        style={{
          margin: "var(--space-3xs) 0 var(--space-sm)",
          fontSize: "var(--font-size-micro)",
          color: "var(--text-tertiary)",
        }}
      >
        {CONSOLE_DECISION_COPY.platformBadgeBody}
      </p>
      {children}
    </section>
  );
}

// ─── Evidence stack – value rows and omissions, nothing in between ──────────

export type EvidenceRow =
  | {
      kind: "value";
      label: string;
      /** undefined renders the "(not required)" family via the field list. */
      value?: string | null;
      mono?: boolean;
      copyable?: boolean;
    }
  | {
      kind: "omission";
      label: string;
      /**
       * States only what is verified, e.g. that a record is held elsewhere.
       * Must not imply a result, a pending state, or a clean one.
       */
      copy: string;
    };

export function EvidenceStack({
  rows,
  onCopy,
  style,
}: {
  rows: EvidenceRow[];
  onCopy?: (label: string, value: string) => void;
  style?: CSSProperties;
}): ReactElement {
  const fields: FieldRow[] = rows.map((row) =>
    row.kind === "omission"
      ? { label: row.label, omissionCopy: row.copy }
      : { label: row.label, value: row.value, mono: row.mono, copyable: row.copyable },
  );
  return <FieldList fields={fields} onCopy={onCopy} style={style} />;
}

// ─── Decision form – reason captured, badged; 409 means re-decide ───────────

export interface DecisionFormProps {
  /** e.g. "Approve" / "Reject" – imperative, because this seat decides. */
  approveLabel?: string;
  rejectLabel?: string;
  /**
   * The optimistic-locking version the decision travels with. Rendered so
   * the operator can see which revision they are deciding against.
   */
  version: number | undefined;
  /**
   * A concurrent decision happened: render the conflict state. The form
   * never auto-retries; the operator re-decides against fresh state.
   */
  conflict?: boolean;
  onRefreshAfterConflict?: () => void;
  busy?: boolean;
  /** The decision control's seat. Platform-seat forms render inside the badge. */
  seat?: ConsoleSeat;
  /**
   * When set, the control is a demo driver standing in for an operation the
   * contract does not carry; it renders the driver badge so the distinction
   * between contract op and driver stays visible.
   */
  driver?: boolean;
  requireReasonOnReject?: boolean;
  onDecide: (decision: { action: "approve" | "reject"; reason: string; version?: number }) => void;
  style?: CSSProperties;
}

const buttonBase: CSSProperties = {
  borderRadius: "var(--radius-control)",
  padding: "var(--space-sm) var(--space-lg)",
  fontSize: "var(--font-size-body)",
  fontFamily: "var(--font-family)",
  fontWeight: 500,
  cursor: "pointer",
};

export function DecisionForm({
  approveLabel = "Approve",
  rejectLabel = "Reject",
  version,
  conflict = false,
  onRefreshAfterConflict,
  busy = false,
  seat = "platform",
  driver = false,
  requireReasonOnReject = true,
  onDecide,
  style,
}: DecisionFormProps): ReactElement {
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);

  if (conflict) {
    return (
      <div role="alert" style={{ fontFamily: "var(--font-family)", ...style }}>
        <p style={{ margin: 0, fontWeight: 600, color: "var(--text-primary)" }}>
          {CONSOLE_DECISION_COPY.conflictHeadline}
        </p>
        <p style={{ margin: "var(--space-2xs) 0 var(--space-sm)", fontSize: "var(--font-size-label)", color: "var(--text-secondary)" }}>
          {CONSOLE_DECISION_COPY.conflictBody}
        </p>
        {onRefreshAfterConflict ? (
          <button
            type="button"
            onClick={onRefreshAfterConflict}
            style={{
              ...buttonBase,
              border: "var(--border-w-hairline) solid var(--border-strong)",
              background: "var(--surface-raised)",
              color: "var(--text-primary)",
            }}
          >
            {CONSOLE_DECISION_COPY.conflictAction}
          </button>
        ) : null}
      </div>
    );
  }

  const decide = (action: "approve" | "reject") => {
    if (action === "reject" && requireReasonOnReject && reason.trim() === "") {
      setReasonError(CONSOLE_DECISION_COPY.reasonRequired);
      return;
    }
    setReasonError(null);
    onDecide({ action, reason: reason.trim(), version });
  };

  const form = (
    <div style={{ fontFamily: "var(--font-family)", maxWidth: 320, ...style }}>
      <label
        htmlFor="console-decision-reason"
        style={{ display: "block", fontSize: "var(--font-size-label)", color: "var(--text-secondary)", marginBottom: "var(--space-3xs)" }}
      >
        {CONSOLE_DECISION_COPY.reasonLabel}
      </label>
      <textarea
        id="console-decision-reason"
        value={reason}
        rows={2}
        maxLength={500}
        onChange={(e) => setReason(e.target.value)}
        style={{
          width: "100%",
          boxSizing: "border-box",
          border: "var(--border-w-hairline) solid var(--border-strong)",
          borderRadius: "var(--radius-control)",
          padding: "var(--space-2xs) var(--space-sm)",
          fontSize: "var(--font-size-label)",
          fontFamily: "var(--font-family)",
          color: "var(--text-primary)",
          background: "var(--surface-raised)",
          resize: "vertical",
        }}
      />
      {/* The badge is the truth about the plumbing: this field travels no
          API operation, it is captured by the console itself. */}
      <p
        data-badge="console-note"
        style={{ margin: "var(--space-3xs) 0 0", fontSize: "var(--font-size-micro)", color: "var(--text-tertiary)" }}
      >
        {CONSOLE_DECISION_COPY.reasonBadge}
      </p>
      {reasonError ? (
        <p role="alert" style={{ margin: "var(--space-2xs) 0 0", fontSize: "var(--font-size-micro)", color: "var(--state-danger-fg)" }}>
          <span aria-hidden="true">⚠</span> {reasonError}
        </p>
      ) : null}
      {driver ? (
        <p
          data-badge="driver"
          style={{ margin: "var(--space-2xs) 0 0", fontSize: "var(--font-size-micro)", color: "var(--text-tertiary)" }}
        >
          {CONSOLE_DECISION_COPY.driverBadge}
        </p>
      ) : null}
      <div style={{ display: "flex", gap: "var(--space-sm)", marginTop: "var(--space-md)" }}>
        <button
          type="button"
          disabled={busy}
          onClick={() => decide("approve")}
          style={{
            ...buttonBase,
            border: "none",
            background: "var(--accent)",
            color: "var(--accent-fg)",
            opacity: busy ? 0.6 : 1,
          }}
        >
          {approveLabel}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => decide("reject")}
          style={{
            ...buttonBase,
            border: "var(--border-w-hairline) solid var(--border-strong)",
            background: "var(--surface-raised)",
            color: "var(--text-primary)",
            opacity: busy ? 0.6 : 1,
          }}
        >
          {rejectLabel}
        </button>
      </div>
      {version !== undefined ? (
        <p style={{ margin: "var(--space-sm) 0 0", fontSize: "var(--font-size-micro)", color: "var(--text-tertiary)" }}>
          Deciding against revision {version}.
        </p>
      ) : null}
    </div>
  );

  return seat === "platform" ? <PlatformSection>{form}</PlatformSection> : form;
}

// ─── Dual timeline – decision chain beside money movement ───────────────────

export type DualTimelineNode =
  | {
      kind: "node";
      key: string;
      label: ReactNode;
      state: TimelineStepState;
      /** Who acted – rendered on the node with role and stamp. */
      actor?: string;
      role?: string;
      /** ISO stamp; rendered timezone-qualified. */
      at?: string;
    }
  | {
      kind: "system";
      key: string;
      /** e.g. a resync: the view was replaced, not a business event. */
      text?: string;
    };

function nodeMeta(node: Extract<DualTimelineNode, { kind: "node" }>, locale?: string): string | undefined {
  const parts = [node.actor, node.role, node.at ? formatStamp(node.at, locale) : undefined].filter(
    (part): part is string => Boolean(part),
  );
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

function TimelineColumn({
  title,
  nodes,
  locale,
}: {
  title: string;
  nodes: DualTimelineNode[];
  locale?: string;
}): ReactElement {
  // Consecutive business nodes render as one timeline segment; a system
  // line breaks the rail on purpose - the view was replaced there.
  const segments: (TimelineStep[] | { systemKey: string; text: string })[] = [];
  let current: TimelineStep[] = [];
  for (const node of nodes) {
    if (node.kind === "system") {
      if (current.length > 0) segments.push(current);
      current = [];
      segments.push({ systemKey: node.key, text: node.text ?? CONSOLE_DECISION_COPY.systemResync });
    } else {
      current.push({ key: node.key, label: node.label, state: node.state, meta: nodeMeta(node, locale) });
    }
  }
  if (current.length > 0) segments.push(current);

  return (
    <div style={{ minWidth: 0, flex: 1 }}>
      <h3
        style={{
          margin: "0 0 var(--space-sm)",
          fontSize: "var(--font-size-micro)",
          fontWeight: 600,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "var(--text-secondary)",
        }}
      >
        {title}
      </h3>
      {nodes.length === 0 ? (
        <p style={{ margin: 0, fontSize: "var(--font-size-label)", color: "var(--text-tertiary)" }}>
          {CONSOLE_DECISION_COPY.emptyTrail}
        </p>
      ) : (
        segments.map((segment, index) =>
          Array.isArray(segment) ? (
            <Timeline key={`segment-${index}`} steps={segment} />
          ) : (
            <p
              key={segment.systemKey}
              data-system-line=""
              style={{
                margin: "var(--space-2xs) 0",
                fontSize: "var(--font-size-micro)",
                color: "var(--text-tertiary)",
              }}
            >
              {segment.text}
            </p>
          ),
        )
      )}
    </div>
  );
}

/**
 * Two parallel timeline columns: the decision chain beside money movement
 * on the same subject. Different actors, different audiences – one merged
 * feed is what makes an audit trail unreadable.
 */
export function DualTimeline({
  decision,
  money,
  locale,
  style,
}: {
  decision: DualTimelineNode[];
  money: DualTimelineNode[];
  locale?: string;
  style?: CSSProperties;
}): ReactElement {
  return (
    <div
      style={{
        display: "flex",
        gap: "var(--space-2xl)",
        alignItems: "flex-start",
        flexWrap: "wrap",
        fontFamily: "var(--font-family)",
        ...style,
      }}
    >
      <TimelineColumn title={CONSOLE_DECISION_COPY.decisionColumn} nodes={decision} locale={locale} />
      <TimelineColumn title={CONSOLE_DECISION_COPY.moneyColumn} nodes={money} locale={locale} />
    </div>
  );
}

// ─── The panel ───────────────────────────────────────────────────────────────

export interface ConsoleDecisionPanelProps {
  /** Thin grey context line, e.g. "Customer · cast-reviewable". */
  context: string;
  /** The record's subject. Heroes the panel when there is no amount. */
  subject: string;
  /** The whose-move value beside the hero – derived, never invented. */
  derivation: Derivation;
  seat?: ConsoleSeat;
  statusPill?: { label: string; intent: StatusIntent; glyph?: string };
  /** Present on money records (payout desk): the amount IS the hero. */
  amount?: number;
  currency?: string;
  frozen?: boolean;
  onClose?: () => void;
  children?: ReactNode;
  locale?: string;
  style?: CSSProperties;
}

/**
 * The decision panel: evidence and ceremony beside the queue, never instead
 * of it (the table stays visible; the source row stays tinted via the
 * queue's selectedKey). For a KYC decision the hero is the subject plus the
 * whose-move value – there is no amount, and rendering an em-dash amount
 * would claim one is missing. For the payout desk the amount heroes, as on
 * every money record.
 */
export function ConsoleDecisionPanel({
  context,
  subject,
  derivation,
  seat = "integrator",
  statusPill,
  amount,
  currency,
  frozen,
  onClose,
  children,
  locale,
  style,
}: ConsoleDecisionPanelProps): ReactElement {
  const hero =
    amount !== undefined ? (
      <Money amount={amount} currency={currency} emphasis="hero" locale={locale} />
    ) : (
      <span style={{ fontSize: "var(--font-size-hero)", fontWeight: 600, letterSpacing: "-0.01em" }}>
        {subject}
      </span>
    );
  return (
    <SidePanel
      context={context}
      hero={hero}
      qualifier={
        <span style={{ display: "inline-flex", gap: "var(--space-sm)", alignItems: "center", flexWrap: "wrap" }}>
          {amount !== undefined ? <span>{subject}</span> : null}
          {statusPill ? (
            <StatusPill label={statusPill.label} intent={statusPill.intent} glyph={statusPill.glyph} />
          ) : null}
          {frozen ? <StatusPill label="Frozen" intent="neutral" glyph="❄" /> : null}
          <WhoseMove derivation={derivation} seat={seat} />
        </span>
      }
      onClose={onClose}
      style={style}
    >
      {children}
    </SidePanel>
  );
}
