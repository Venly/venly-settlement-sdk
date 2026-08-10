import type { CSSProperties, ReactElement, ReactNode } from "react";
import { Money } from "../lib/money.js";

/**
 * Side panel – record detail beside the table, not instead of it.
 *
 * Design contract encoded by this component:
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
  /** Rendered before the hero amount, e.g. an explicit "+" on settled credits. */
  amountPrefix?: string;
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
        border: "var(--border-w-hairline) solid var(--border-hairline)",
        borderRadius: "var(--radius-pill)",
        padding: "var(--pill-pad)",
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
  amountPrefix,
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
        width: "var(--panel-width)",
        minWidth: "var(--panel-min-width)",
        display: "flex",
        flexDirection: "column",
        background: "var(--surface-raised)",
        borderLeft: "var(--border-w-hairline) solid var(--border-hairline)",
        boxShadow: "var(--shadow-overlay)",
        fontFamily: "var(--font-family)",
        fontSize: "var(--font-size-body)",
        color: "var(--text-primary)",
        ...style,
      }}
    >
      <header style={{ padding: "var(--space-md) var(--space-xl) 0" }}>
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
                padding: "var(--space-2xs)",
              }}
            >
              ✕
            </button>
          ) : null}
        </div>
        <div style={{ marginTop: "var(--space-sm)" }}>
          {amountPrefix ? (
            <span style={{ fontSize: "var(--font-size-hero)", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
              {amountPrefix}
            </span>
          ) : null}
          <Money amount={amount} currency={currency} emphasis="hero" />
        </div>
        {qualifier !== undefined ? (
          <div
            style={{
              fontSize: "var(--font-size-label)",
              color: "var(--text-secondary)",
              marginTop: "var(--space-2xs)",
            }}
          >
            {qualifier}
          </div>
        ) : null}
      </header>
      <div style={{ flex: 1, overflowY: "auto", padding: "var(--space-lg) var(--space-xl)" }}>{children}</div>
      {keyboardFooter ? (
        <footer
          style={{
            borderTop: "var(--border-w-hairline) solid var(--border-hairline)",
            padding: "var(--space-sm) var(--space-xl)",
            display: "flex",
            gap: "var(--space-sm)",
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
