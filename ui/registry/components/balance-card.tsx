import type { CSSProperties, ReactElement, ReactNode } from "react";
import { Money } from "../lib/money.js";

/**
 * Balance card – the available/reserved composition.
 *
 * Contract points from the design library:
 * - Available is the terminal, emphasised figure: ~2× everything else and
 *   the ONLY figure above the hairline rule. The Send button spends it.
 * - Total is demoted below the rule beside the reserved buckets. Reserved
 *   is marked by position and scale only – no colour, no weight change.
 * - A padlock glyph marks "present but not yours to spend"; it survives
 *   greyscale and needs no legend.
 * - Bucket labels name the mechanism ("Reserved against card authorisation,
 *   releases 14 Mar"), never a bare "Reserved".
 * - No shadow: the card sits in the base layer, separated by a hairline.
 */
export interface BalanceBucket {
  /** Mechanism-naming label, e.g. "Reserved in" / "Reserved out". */
  label: string;
  amount: number | null | undefined;
  /** Marks unspendable money with the padlock glyph. */
  locked?: boolean;
}

export interface BalanceCardProps {
  /** Caption above the hero figure. Defaults to "Available". */
  label?: string;
  available: number | null | undefined;
  currency?: string;
  /** Demoted figures below the rule: Total first, then reserved buckets. */
  buckets?: BalanceBucket[];
  /** Secondary line under the hero: a qualifier naming the figure. */
  qualifier?: ReactNode;
  style?: CSSProperties;
  className?: string;
}

export function BalanceCard({
  label = "Available",
  available,
  currency,
  buckets = [],
  qualifier,
  style,
  className,
}: BalanceCardProps): ReactElement {
  return (
    <section
      className={className}
      style={{
        background: "var(--surface-raised)",
        border: "1px solid var(--border-hairline)",
        borderRadius: "var(--radius-card)",
        padding: "22px",
        fontFamily: "var(--font-family)",
        maxWidth: 420,
        ...style,
      }}
    >
      <div
        style={{
          fontSize: "var(--font-size-micro)",
          fontWeight: 500,
          color: "var(--text-tertiary)",
          marginBottom: "6px",
        }}
      >
        {label}
      </div>
      <div>
        <Money amount={available} currency={currency} emphasis="hero" />
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
      {buckets.length > 0 ? (
        <div
          style={{
            borderTop: "1px solid var(--border-hairline)",
            marginTop: "14px",
            paddingTop: "10px",
            display: "flex",
            gap: "24px",
          }}
        >
          {buckets.map((bucket) => (
            <div key={bucket.label} data-locked={bucket.locked || undefined}>
              <div
                style={{
                  fontSize: "10px",
                  color: "var(--text-tertiary)",
                  marginBottom: "2px",
                  whiteSpace: "nowrap",
                }}
              >
                {bucket.locked ? (
                  <span aria-label="not spendable" style={{ marginRight: "3px" }}>
                    🔒
                  </span>
                ) : null}
                {bucket.label}
              </div>
              <Money
                amount={bucket.amount}
                fractionDigits={2}
                style={{ fontSize: "13px", fontWeight: 400 }}
              />
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
