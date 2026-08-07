import type { CSSProperties, ReactElement, ReactNode } from "react";
import { Money } from "../lib/money.js";

/**
 * Side panel – record detail beside the table, not instead of it.
 *
 * Contract points from the design library:
 * - Clicking a row opens this panel; it never navigates.
 * - NO scrim: the table stays visible and clipped at the panel edge; the
 *   source row stays tinted (the table owns that via selectedKey).
 * - Width ~27–30% of the viewport for a record.
 * - Header: thin micro-size grey context line + close control, then the
 *   HERO IS THE AMOUNT (~28px), not the counterparty, then a grey
 *   qualifier line.
 * - The panel edge is an overlay boundary, so it is the one base-layer
 *   element allowed a shadow.
 * - Footer strip with `↑ ↓ Esc` key chips so a reviewer steps row to row
 *   without closing the panel.
 */
export interface SidePanelProps {
  /** Thin grey context line, e.g. "Transfer · 7 Aug 2026". */
  context: string;
  amount?: number | null;
  currency?: string;
  /** Grey line under the hero amount, e.g. the counterparty. */
  qualifier?: ReactNode;
  onClose?: () => void;
  /** Render the ↑ ↓ Esc footer strip. Default true. */
  keyboardFooter?: boolean;
  children?: ReactNode;
  style?: CSSProperties;
  className?: string;
}

function KeyChip({ label }: { label: string }): ReactElement {
  return (
    <kbd
      style={{
        border: "1px solid var(--border-hairline)",
        borderRadius: "var(--radius-pill)",
        padding: "1px 5px",
        fontSize: "var(--font-size-micro)",
        color: "var(--text-secondary)",
        fontFamily: "var(--font-family)",
        background: "var(--surface-sunken)",
      }}
    >
      {label}
    </kbd>
  );
}

export function SidePanel({
  context,
  amount,
  currency,
  qualifier,
  onClose,
  keyboardFooter = true,
  children,
  style,
  className,
}: SidePanelProps): ReactElement {
  return (
    <aside
      className={className}
      aria-label={context}
      style={{
        position: "fixed",
        top: 0,
        right: 0,
        bottom: 0,
        width: "28%",
        minWidth: 340,
        display: "flex",
        flexDirection: "column",
        background: "var(--surface-raised)",
        borderLeft: "1px solid var(--border-hairline)",
        boxShadow: "-8px 0 24px rgba(9, 9, 11, 0.06)",
        fontFamily: "var(--font-family)",
        fontSize: "var(--font-size-body)",
        color: "var(--text-primary)",
        ...style,
      }}
    >
      <header style={{ padding: "14px 20px 0" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: "var(--font-size-micro)",
            color: "var(--text-tertiary)",
          }}
        >
          <span>{context}</span>
          {onClose ? (
            <button
              type="button"
              aria-label="Close panel"
              onClick={onClose}
              style={{
                border: "none",
                background: "none",
                cursor: "pointer",
                color: "var(--text-secondary)",
                fontSize: "var(--font-size-body)",
                lineHeight: 1,
                padding: "4px",
              }}
            >
              ✕
            </button>
          ) : null}
        </div>
        <div style={{ marginTop: "10px" }}>
          <Money amount={amount} currency={currency} emphasis="hero" />
        </div>
        {qualifier !== undefined ? (
          <div
            style={{
              fontSize: "var(--font-size-label)",
              color: "var(--text-secondary)",
              marginTop: "4px",
            }}
          >
            {qualifier}
          </div>
        ) : null}
      </header>
      <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}>{children}</div>
      {keyboardFooter ? (
        <footer
          style={{
            borderTop: "1px solid var(--border-hairline)",
            padding: "8px 20px",
            display: "flex",
            gap: "10px",
            alignItems: "center",
            fontSize: "var(--font-size-micro)",
            color: "var(--text-tertiary)",
          }}
        >
          <KeyChip label="↑" /> <KeyChip label="↓" />
          <span>row</span>
          <KeyChip label="Esc" />
          <span>close</span>
        </footer>
      ) : null}
    </aside>
  );
}
