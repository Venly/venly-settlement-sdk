import { useState, type CSSProperties, type ReactElement, type ReactNode } from "react";
import type { ChannelInfo, LedgerSnapshot } from "@venlyfinance/sdk";
import { FieldList } from "../components/field-list.js";
import { StatusPill } from "../components/status-pill.js";
import { formatAmount } from "../lib/money.js";

/**
 * Sandbox simulator – play the counterparty, without ever reading as
 * operator workflow.
 *
 * Design contract encoded by this block:
 * - OWN CHROME. A right-hand drawer with a scrim, on a distinct dark
 *   surface, with a persistent "Sandbox simulator" header. It is the only
 *   scrimmed drawer in the console, so the surface change alone signals
 *   the register change.
 * - ONE FIXED AFFORDANCE. Reachable from the top bar only – never from a
 *   queue row, a decision panel, or a row action. Those paths would make a
 *   counterparty's action look like the operator's.
 * - LEXICAL RULE. Controls are phrased as events that happen to you, in
 *   the third person ("A bank credit arrives"), while operator controls
 *   elsewhere are imperative decisions. `SimulatorControl` refuses a label
 *   phrased as an operator decision with a thrown developer error.
 * - ONE CONTROL PER CALL. Every control maps to exactly one call on the
 *   mock's simulations namespace; no control exists without a call and no
 *   call is renamed. The `call` prop names it, verbatim.
 * - THE LEDGER CHECK IS REAL. `LedgerVerifyPanel` is the one control here
 *   that asserts something true – that the simulated books balance.
 * - CHANNEL HONESTY. `ChannelFooter` states adapter, session and peers,
 *   and says IN WORDS when the surface is not actually sharing: the
 *   default channel shares nothing, and cross-context sharing is
 *   same-origin only.
 */

// ─── User-facing copy ────────────────────────────────────────────────────────

export const SIMULATOR_COPY = {
  title: "Sandbox simulator",
  subtitle:
    "Play the counterparty: banks, providers and screening. Every action here is a simulated event arriving at your sandbox, attributed to the simulator – never to an operator.",
  run: "Simulate",
  verify: "Check the books",
  verifyPass: "The books balance: every total equals available plus reserved, and every reserved amount has a pending operation behind it.",
  verifyFailPrefix: "The books do not balance",
  snapshotTitle: "Ledger snapshot",
  footerTitle: "Channel",
  notSharing:
    "Not sharing: this tab's channel adapter is memory, so nothing simulated here reaches any other tab. Cross-tab sharing needs the broadcast channel, on one origin, configured before the first client is constructed. Open a second tab on this same URL to see it sync.",
  sharing: "Sharing on this origin",
  close: "Close simulator",
} as const;

/**
 * Operator-decision verbs. A simulator control phrased with one of these is
 * in the wrong surface – it reads as a decision the operator makes rather
 * than an event that happens to them. World controls ("Load the demo cast",
 * "Reset the world", "Check the books") are commands to the simulation
 * itself and stay allowed.
 */
const IMPERATIVE_OPERATOR_VERB =
  /^\s*(approve|reject|return|confirm|decline|cancel|freeze|suspend|authori[sz]e|verify)\b/i;

/** Thrown for the developer, not rendered: a wrong-voice label is a build defect. */
function assertThirdPersonLabel(label: string): void {
  if (!IMPERATIVE_OPERATOR_VERB.test(label)) return;
  const message =
    `SimulatorControl label "${label}" is phrased as an imperative operator decision. ` +
    "Simulator controls are events that happen to you, in the third person - " +
    'e.g. "A bank credit arrives", "The provider marks the payout processing".';
  // globalThis probe: browser bundles may define neither `process` nor node
  // types, and this file compiles without either.
  const nodeProcess = (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process;
  if (nodeProcess?.env?.NODE_ENV === "production") {
    console.error(message);
    return;
  }
  throw new Error(message);
}

// ─── The drawer ──────────────────────────────────────────────────────────────

export interface SimulatorDrawerProps {
  open: boolean;
  onClose: () => void;
  /** Rendered in words at the top of the drawer when the channel is not sharing. */
  warning?: string;
  children?: ReactNode;
  /** The channel footer (and anything else pinned below the controls). */
  footer?: ReactNode;
}

/**
 * The only scrimmed drawer in the console. Distinct dark surface via the
 * kit's dark-scheme tokens (the shadcn-convention `dark` class), so the
 * register change is visible before a single word is read.
 */
export function SimulatorDrawer({
  open,
  onClose,
  warning,
  children,
  footer,
}: SimulatorDrawerProps): ReactElement | null {
  if (!open) return null;
  return (
    <div role="presentation" style={{ position: "fixed", inset: 0, zIndex: 40 }}>
      {/* The scrim – C2 panels never scrim; this drawer always does. */}
      <div
        role="presentation"
        onClick={onClose}
        style={{ position: "absolute", inset: 0, background: "var(--selected-tint)" }}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={SIMULATOR_COPY.title}
        className="dark"
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          bottom: 0,
          width: 420,
          maxWidth: "100vw",
          boxSizing: "border-box",
          display: "flex",
          flexDirection: "column",
          background: "var(--surface-page)",
          color: "var(--text-primary)",
          borderLeft: "var(--border-w-hairline) solid var(--border-strong)",
          boxShadow: "var(--shadow-overlay)",
          fontFamily: "var(--font-family)",
        }}
      >
        <header
          style={{
            flex: "none",
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            gap: "var(--space-md)",
            padding: "var(--space-lg) var(--space-xl)",
            borderBottom: "var(--border-w-hairline) solid var(--border-hairline)",
          }}
        >
          <div>
            <p
              style={{
                margin: 0,
                fontSize: "var(--font-size-label)",
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                fontWeight: 600,
              }}
            >
              {SIMULATOR_COPY.title}
            </p>
            <p
              style={{
                margin: "var(--space-2xs) 0 0",
                fontSize: "var(--font-size-micro)",
                color: "var(--text-secondary)",
              }}
            >
              {SIMULATOR_COPY.subtitle}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={SIMULATOR_COPY.close}
            style={{
              border: "none",
              background: "transparent",
              color: "var(--text-secondary)",
              fontSize: "var(--font-size-body)",
              cursor: "pointer",
              padding: "var(--space-2xs)",
            }}
          >
            ✕
          </button>
        </header>
        {warning && (
          <p
            role="alert"
            style={{
              margin: 0,
              flex: "none",
              padding: "var(--space-sm) var(--space-xl)",
              fontSize: "var(--font-size-micro)",
              color: "var(--state-pending-fg)",
              background: "var(--state-pending-bg)",
            }}
          >
            ⚠ {warning}
          </p>
        )}
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            padding: "var(--space-lg) var(--space-xl)",
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-lg)",
          }}
        >
          {children}
        </div>
        {footer && (
          <footer
            style={{
              flex: "none",
              borderTop: "var(--border-w-hairline) solid var(--border-hairline)",
              padding: "var(--space-md) var(--space-xl)",
            }}
          >
            {footer}
          </footer>
        )}
      </aside>
    </div>
  );
}

// ─── One control per simulations call ───────────────────────────────────────

export interface SimulatorControlProps {
  /** Third-person event copy, e.g. "A bank credit arrives". */
  label: string;
  /**
   * The one simulations call this control fires, verbatim – e.g.
   * "simulations.inbound.credit". Rendered as the control's provenance so
   * no control can drift from its call.
   */
  call: string;
  /** Input fields for the call's parameters. */
  children?: ReactNode;
  /** Fires the named call. Errors render verbatim under the control. */
  onRun: () => Promise<unknown> | unknown;
  /** One line describing what just happened, e.g. "Credit landed". */
  resultLabel?: (result: unknown) => string;
  disabled?: boolean;
  disabledReason?: string;
  style?: CSSProperties;
}

export function SimulatorControl({
  label,
  call,
  children,
  onRun,
  resultLabel,
  disabled,
  disabledReason,
  style,
}: SimulatorControlProps): ReactElement {
  assertThirdPersonLabel(label);
  const [outcome, setOutcome] = useState<
    { kind: "ok"; text: string } | { kind: "error"; text: string } | null
  >(null);
  const run = async () => {
    try {
      const result = await onRun();
      setOutcome({ kind: "ok", text: resultLabel ? resultLabel(result) : "Done" });
    } catch (error) {
      setOutcome({ kind: "error", text: error instanceof Error ? error.message : String(error) });
    }
  };
  return (
    <section
      style={{
        border: "var(--border-w-hairline) solid var(--border-hairline)",
        borderRadius: "var(--radius-card)",
        background: "var(--surface-raised)",
        padding: "var(--space-md)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-sm)",
        ...style,
      }}
    >
      <p style={{ margin: 0, fontSize: "var(--font-size-body)", fontWeight: 600 }}>{label}</p>
      {children}
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)", flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={() => void run()}
          disabled={disabled}
          title={disabled ? disabledReason : undefined}
          style={{
            border: "var(--border-w-hairline) solid var(--border-strong)",
            borderRadius: "var(--radius-control)",
            background: "var(--surface-sunken)",
            color: disabled ? "var(--text-tertiary)" : "var(--text-primary)",
            fontSize: "var(--font-size-label)",
            fontWeight: 600,
            padding: "var(--space-2xs) var(--space-md)",
            cursor: disabled ? "not-allowed" : "pointer",
          }}
        >
          {SIMULATOR_COPY.run}
        </button>
        <code style={{ fontSize: "var(--font-size-micro)", color: "var(--text-tertiary)" }}>
          {call}
        </code>
      </div>
      {disabled && disabledReason && (
        <p style={{ margin: 0, fontSize: "var(--font-size-micro)", color: "var(--text-secondary)" }}>
          {disabledReason}
        </p>
      )}
      {outcome && (
        <p
          role="status"
          style={{
            margin: 0,
            fontSize: "var(--font-size-micro)",
            color: outcome.kind === "error" ? "var(--state-danger-fg)" : "var(--state-success-fg)",
          }}
        >
          {outcome.kind === "error" ? "✕" : "✓"} {outcome.text}
        </p>
      )}
    </section>
  );
}

// ─── The ledger check – the one control that asserts something true ─────────

export interface LedgerVerifyPanelProps {
  /** `simulations.ledger.verify` – throws MockLedgerError on failure. */
  verify: () => void;
  /** `simulations.ledger.snapshot` – rendered as a table on demand. */
  snapshot: () => LedgerSnapshot;
  style?: CSSProperties;
}

/**
 * Pure outcome of one books check: pass, or the thrown message verbatim.
 * Exported so the failure path is unit-testable - a live mock world cannot
 * reach it without breaking its own invariants, which is the point.
 */
export function describeLedgerCheck(
  verify: () => void,
): { kind: "pass" } | { kind: "fail"; message: string } {
  try {
    verify();
    return { kind: "pass" };
  } catch (error) {
    return { kind: "fail", message: error instanceof Error ? error.message : String(error) };
  }
}

export function LedgerVerifyPanel({ verify, snapshot, style }: LedgerVerifyPanelProps): ReactElement {
  const [result, setResult] = useState<
    { kind: "pass" } | { kind: "fail"; message: string } | null
  >(null);
  const [rows, setRows] = useState<LedgerSnapshot | null>(null);
  const check = () => {
    setResult(describeLedgerCheck(verify));
    setRows(snapshot());
  };
  return (
    <section
      style={{
        border: "var(--border-w-hairline) solid var(--border-hairline)",
        borderRadius: "var(--radius-card)",
        background: "var(--surface-raised)",
        padding: "var(--space-md)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-sm)",
        ...style,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)", flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={check}
          style={{
            border: "var(--border-w-hairline) solid var(--border-strong)",
            borderRadius: "var(--radius-control)",
            background: "var(--surface-sunken)",
            color: "var(--text-primary)",
            fontSize: "var(--font-size-label)",
            fontWeight: 600,
            padding: "var(--space-2xs) var(--space-md)",
            cursor: "pointer",
          }}
        >
          {SIMULATOR_COPY.verify}
        </button>
        <code style={{ fontSize: "var(--font-size-micro)", color: "var(--text-tertiary)" }}>
          simulations.ledger.verify
        </code>
      </div>
      {result && (
        <p
          role="status"
          style={{
            margin: 0,
            fontSize: "var(--font-size-micro)",
            color: result.kind === "pass" ? "var(--state-success-fg)" : "var(--state-danger-fg)",
          }}
        >
          {result.kind === "pass"
            ? `✓ ${SIMULATOR_COPY.verifyPass}`
            : `✕ ${SIMULATOR_COPY.verifyFailPrefix}: ${result.message}`}
        </p>
      )}
      {rows && (
        <div style={{ overflowX: "auto" }}>
          <table
            style={{
              width: "100%",
              minWidth: 360,
              borderCollapse: "collapse",
              fontSize: "var(--font-size-micro)",
            }}
          >
            <caption
              style={{
                textAlign: "left",
                fontSize: "var(--font-size-micro)",
                color: "var(--text-secondary)",
                paddingBottom: "var(--space-2xs)",
              }}
            >
              {SIMULATOR_COPY.snapshotTitle}
            </caption>
            <thead>
              <tr style={{ borderBottom: "var(--border-w-hairline) solid var(--border-hairline)" }}>
                <th style={{ textAlign: "left", padding: "var(--space-2xs)" }}>Account</th>
                <th style={{ textAlign: "left", padding: "var(--space-2xs)" }}>Asset</th>
                <th style={{ textAlign: "right", padding: "var(--space-2xs)" }}>Total</th>
                <th style={{ textAlign: "right", padding: "var(--space-2xs)" }}>Available</th>
                <th style={{ textAlign: "right", padding: "var(--space-2xs)" }}>Reserved</th>
              </tr>
            </thead>
            <tbody>
              {rows.rows.map((row) => (
                <tr
                  key={`${row.accountId}:${row.asset}`}
                  style={{ borderBottom: "var(--border-w-hairline) solid var(--border-hairline)" }}
                >
                  <td
                    style={{
                      padding: "var(--space-2xs)",
                      fontFamily: "monospace",
                      maxWidth: 120,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {row.accountId}
                  </td>
                  <td style={{ padding: "var(--space-2xs)" }}>{row.asset}</td>
                  <td style={{ padding: "var(--space-2xs)", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                    {formatAmount(row.total)}
                  </td>
                  <td style={{ padding: "var(--space-2xs)", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                    {formatAmount(row.available)}
                  </td>
                  <td style={{ padding: "var(--space-2xs)", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                    {formatAmount(row.reserved)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ─── Channel honesty footer ──────────────────────────────────────────────────

export interface ChannelFooterProps {
  /** `simulations.channelInfo()`, read fresh when the drawer opens. */
  info: ChannelInfo;
  style?: CSSProperties;
}

export function ChannelFooter({ info, style }: ChannelFooterProps): ReactElement {
  const sharing = info.adapter !== "memory";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)", ...style }}>
      {!sharing && (
        <p
          role="alert"
          style={{
            margin: 0,
            fontSize: "var(--font-size-micro)",
            color: "var(--state-pending-fg)",
            background: "var(--state-pending-bg)",
            borderRadius: "var(--radius-control)",
            padding: "var(--space-2xs) var(--space-sm)",
          }}
        >
          ⚠ {SIMULATOR_COPY.notSharing}
        </p>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)", flexWrap: "wrap" }}>
        <StatusPill
          label={sharing ? SIMULATOR_COPY.sharing : "Not sharing"}
          intent={sharing ? "positive" : "pending"}
        />
        <code style={{ fontSize: "var(--font-size-micro)", color: "var(--text-secondary)" }}>
          adapter {info.adapter} · session {info.sessionId} · peers {info.peers} · revision{" "}
          {info.revision}
        </code>
      </div>
      <FieldList
        fields={[
          { label: "Origin", value: info.origin ?? undefined, mono: true, copyable: false },
          { label: "Origin id", value: info.originId, mono: true, copyable: false },
          { label: "Epoch", value: String(info.epoch), mono: true, copyable: false },
        ]}
      />
    </div>
  );
}
