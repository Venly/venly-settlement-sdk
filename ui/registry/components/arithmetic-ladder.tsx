import type { CSSProperties, ReactElement, ReactNode } from "react";
import { Money } from "../lib/money.js";

/**
 * Arithmetic ladder – the transfer review register.
 *
 * Design contract encoded by this component:
 * - Make the operators literal: a left gutter carrying − × + against each
 *   fee and rate, so the reader verifies the sum without a calculator.
 * - Components before the total. Never the answer before the working.
 * - The total is separated by a filled tint band, not just a rule.
 * - Uncertainty attaches to the uncertain number (an asterisk on the row),
 *   not to a global disclaimer.
 * - Rate liveness belongs on the rate row itself, never as a countdown on
 *   the commit button.
 * - Never mask values on a review screen.
 */
export interface LadderRow {
  /** Literal operator rendered in the gutter: "−", "+", "×". */
  operator: "−" | "+" | "×";
  label: string;
  /** A money amount… */
  amount?: number | null;
  currency?: string;
  /** …or a non-money value (a rate like "0.9996"). */
  value?: ReactNode;
  /** Marks the number as an estimate: asterisk on the row. */
  uncertain?: boolean;
  /** Liveness note, e.g. "Refreshed at 11:55:46". */
  meta?: string;
}

export interface ArithmeticLadderProps {
  input: { label: string; amount: number; currency?: string };
  rows: LadderRow[];
  total: { label: string; amount: number; currency?: string; uncertain?: boolean };
  style?: CSSProperties;
  className?: string;
}

export function ArithmeticLadder({
  input,
  rows,
  total,
  style,
  className,
}: ArithmeticLadderProps): ReactElement {
  return (
    <div
      className={className}
      style={{
        fontFamily: "var(--font-family)",
        fontSize: "var(--font-size-body)",
        background: "var(--surface-raised)",
        border: "var(--border-w-hairline) solid var(--border-hairline)",
        borderRadius: "var(--radius-card)",
        overflow: "hidden",
        ...style,
      }}
    >
      <div style={{ padding: "var(--space-lg) var(--card-pad) var(--space-sm)" }}>
        <div style={{ fontSize: "var(--font-size-micro)", color: "var(--text-tertiary)" }}>
          {input.label}
        </div>
        <Money amount={input.amount} currency={input.currency} emphasis="hero" />
      </div>
      <div style={{ padding: "0 var(--card-pad)" }}>
        {rows.map((row, i) => (
          <div
            key={`${row.label}-${i}`}
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: "var(--space-md)",
              padding: "var(--space-xs) 0",
            }}
          >
            <span
              aria-hidden="true"
              style={{
                width: "var(--space-lg)",
                flex: "none",
                textAlign: "center",
                color: "var(--text-tertiary)",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {row.operator}
            </span>
            <span style={{ flex: 1, color: "var(--text-secondary)" }}>
              {row.label}
              {row.meta ? (
                <span
                  style={{
                    marginLeft: "var(--space-sm)",
                    fontSize: "var(--font-size-micro)",
                    color: "var(--text-tertiary)",
                  }}
                >
                  {row.meta}
                </span>
              ) : null}
            </span>
            <span style={{ fontVariantNumeric: "tabular-nums", color: "var(--text-primary)" }}>
              {row.value ?? <Money amount={row.amount} currency={row.currency} />}
              {row.uncertain ? <span aria-label="estimate">*</span> : null}
            </span>
          </div>
        ))}
      </div>
      <div
        style={{
          marginTop: "var(--space-sm)",
          padding: "var(--space-md) var(--card-pad)",
          background: "var(--surface-sunken)",
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
        }}
      >
        <span style={{ fontWeight: 500, color: "var(--text-primary)" }}>{total.label}</span>
        <span>
          <Money amount={total.amount} currency={total.currency} emphasis="value" />
          {total.uncertain ? <span aria-label="estimate">*</span> : null}
        </span>
      </div>
    </div>
  );
}
