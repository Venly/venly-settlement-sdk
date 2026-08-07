import type { CSSProperties, ReactElement } from "react";

/**
 * Money rendering rules this module owns (do not re-implement locally):
 * - Tabular figures, always. Wobbling decimals in a right-aligned column is
 *   the fastest tell of a non-finance UI.
 * - Currency code trails the digits at ~0.6x, one tonal step down: `5.00 EUR`.
 *   Code-first at equal size reads as a label.
 * - True minus sign − before the amount, never a hyphen.
 * - The LEVEL is tonally neutral regardless of sign: debits are not red.
 *   Red is reserved for failure. Deltas may colour, but must also carry an
 *   arrow so colour is never the sole carrier.
 * - Empty value renders an em-dash, never blank, never 0.00.
 * - Masking is fixed-length: it hides the magnitude as well as the digits,
 *   and it must cover every figure on the surface (rows and deltas too),
 *   never just the hero.
 */

export function formatAmount(amount: number, fractionDigits = 2): string {
  const formatted = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(Math.abs(amount));
  return amount < 0 ? `−${formatted}` : formatted;
}

const EMPTY = "—"; // em-dash: an empty numeric cell is a statement, not a gap

export interface MoneyProps {
  /** null/undefined renders the em-dash empty state. */
  amount?: number | null;
  /** ISO-ish code rendered trailing at 0.6x, one tonal step down. */
  currency?: string;
  /**
   * Typographic register:
   * - "row": body-size, weight 600, for table cells (right-align via the cell)
   * - "value": summary figures (20px)
   * - "hero": the one emphasised figure on a card (28px; 2-2.5x its caption)
   */
  emphasis?: "row" | "value" | "hero";
  fractionDigits?: number;
  /**
   * Replaces the digits with a fixed-length mask that leaks no magnitude.
   * The currency code stays visible; the amount does not. Masking is a
   * surface-wide contract: if the hero is masked, every row and delta on
   * the same surface must receive the same flag.
   */
  masked?: boolean;
  style?: CSSProperties;
  className?: string;
}

/** Fixed-length mask: four dots regardless of the amount's magnitude. */
export const MASK = "••••";

const EMPHASIS: Record<NonNullable<MoneyProps["emphasis"]>, CSSProperties> = {
  row: { fontSize: "var(--font-size-body)", fontWeight: 600 },
  value: { fontSize: "var(--font-size-value)", fontWeight: 600 },
  hero: { fontSize: "var(--font-size-hero)", fontWeight: 600, letterSpacing: "-0.01em" },
};

export function Money({
  amount,
  currency,
  emphasis = "row",
  fractionDigits = 2,
  masked = false,
  style,
  className,
}: MoneyProps): ReactElement {
  const base: CSSProperties = {
    fontVariantNumeric: "tabular-nums",
    color: "var(--text-primary)",
    whiteSpace: "nowrap",
    ...EMPHASIS[emphasis],
    ...style,
  };

  if (amount === null || amount === undefined) {
    return (
      <span className={className} style={{ ...base, color: "var(--text-tertiary)" }}>
        {EMPTY}
      </span>
    );
  }

  return (
    <span className={className} style={base} aria-label={masked ? "amount hidden" : undefined}>
      {masked ? MASK : formatAmount(amount, fractionDigits)}
      {currency ? (
        <span
          style={{
            fontSize: "0.6em",
            fontWeight: 500,
            color: "var(--text-secondary)",
            marginLeft: "0.35em",
          }}
        >
          {currency}
        </span>
      ) : null}
    </span>
  );
}
