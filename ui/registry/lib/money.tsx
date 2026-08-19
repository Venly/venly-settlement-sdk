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

/**
 * `fractionDigits` is the minimum shown; `maxFractionDigits` (default: the
 * minimum) lets an asset's on-chain precision through. Pass the asset's
 * `decimals` from supported-assets as `maxFractionDigits`: a fixed 2dp
 * render shows a 6-decimal asset's sub-cent balance as 0.00 and the total
 * stops reconciling with its rows.
 */
export function formatAmount(
  amount: number,
  fractionDigits = 2,
  maxFractionDigits = fractionDigits,
): string {
  const formatted = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: Math.max(fractionDigits, maxFractionDigits),
  }).format(Math.abs(amount));
  return amount < 0 ? `−${formatted}` : formatted;
}

/**
 * Absolute, timezone-qualified stamp. Relative times rot while a queue sits
 * open; a stamp without a zone is an incomplete claim. Empty / unparsable
 * input renders the empty string so callers can show their own omission.
 */
export function formatStamp(input: Date | string): string {
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) return "";
  const day = date.toLocaleDateString("en-US", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
  const time = date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZoneName: "short",
  });
  return `${day}, ${time}`;
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
  /** Minimum fraction digits shown (default 2). */
  fractionDigits?: number;
  /**
   * Maximum fraction digits (default: `fractionDigits`). Pass the asset's
   * on-chain `decimals` so sub-cent amounts render instead of rounding to
   * 0.00 – trailing zeros beyond the minimum are not padded.
   */
  maxFractionDigits?: number;
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
  maxFractionDigits,
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
      {masked ? MASK : formatAmount(amount, fractionDigits, maxFractionDigits ?? fractionDigits)}
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
