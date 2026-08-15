import type { CSSProperties, ReactElement, ReactNode } from "react";
import { Money } from "../lib/money.js";

/**
 * Balance card – the available/reserved composition.
 *
 * Design contract encoded by this component:
 * - Available is the terminal, emphasised figure: ~2× everything else and
 *   the ONLY figure above the hairline rule. The Send button spends it.
 * - Total is demoted below the rule beside the reserved buckets. Reserved
 *   is marked by position and scale only – no colour, no weight change.
 * - A padlock glyph marks "present but not yours to spend"; it survives
 *   greyscale and needs no legend.
 * - Bucket labels name the mechanism ("Reserved against card authorisation,
 *   releases 14 Mar"), never a bare "Reserved".
 * - Masking is a labelled text control (never an ambiguous icon) and covers
 *   the hero AND the demoted buckets – a masked hero beside visible deltas
 *   leaks what masking promised to hide.
 * - Every reserved aggregate drills through to the records causing it:
 *   pass onDrill on a bucket and it becomes a real control.
 * - No shadow: the card sits in the base layer, separated by a hairline.
 */
export interface BalanceBucket {
  /** Mechanism-naming label, e.g. "Reserved in" / "Reserved out". */
  label: string;
  amount: number | null | undefined;
  /** Marks unspendable money with the padlock glyph. */
  locked?: boolean;
  /** Drill-through to the records causing this bucket. */
  onDrill?: () => void;
}

export interface BalanceCardProps {
  /** Caption above the hero figure. Defaults to "Available". */
  label?: string;
  available: number | null | undefined;
  currency?: string;
  /**
   * The asset's on-chain decimals (from supported-assets). Applied to the
   * hero AND every bucket: sub-cent amounts must render on all of them or
   * the card's own arithmetic stops adding up on screen.
   */
  decimals?: number;
  /** Demoted figures below the rule: Total first, then reserved buckets. */
  buckets?: BalanceBucket[];
  /** Secondary line under the hero: a qualifier naming the figure. */
  qualifier?: ReactNode;
  /** Masks every figure on the card (hero and buckets alike). */
  masked?: boolean;
  /** When provided, renders the labelled Hide/Show control on the label row. */
  onToggleMasked?: () => void;
  style?: CSSProperties;
  className?: string;
}

export function BalanceCard({
  label = "Available",
  available,
  currency,
  decimals,
  buckets = [],
  qualifier,
  masked = false,
  onToggleMasked,
  style,
  className,
}: BalanceCardProps): ReactElement {
  return (
    <section
      className={className}
      style={{
        background: "var(--surface-raised)",
        border: "var(--border-w-hairline) solid var(--border-hairline)",
        borderRadius: "var(--radius-card)",
        padding: "var(--card-pad)",
        fontFamily: "var(--font-family)",
        maxWidth: "var(--card-max-width)",
        ...style,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          fontSize: "var(--font-size-micro)",
          fontWeight: 500,
          color: "var(--text-tertiary)",
          marginBottom: "var(--space-xs)",
        }}
      >
        <span>{label}</span>
        {onToggleMasked ? (
          <button
            type="button"
            onClick={onToggleMasked}
            style={{
              border: "none",
              background: "none",
              cursor: "pointer",
              padding: 0,
              fontFamily: "var(--font-family)",
              fontSize: "var(--font-size-micro)",
              color: "var(--text-secondary)",
              textDecoration: "underline",
            }}
          >
            {masked ? "Show" : "Hide"}
          </button>
        ) : null}
      </div>
      <div>
        <Money
          amount={available}
          currency={currency}
          emphasis="hero"
          maxFractionDigits={decimals}
          masked={masked}
        />
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
      {buckets.length > 0 ? (
        <div
          style={{
            borderTop: "var(--border-w-hairline) solid var(--border-hairline)",
            marginTop: "var(--space-md)",
            paddingTop: "var(--space-sm)",
            display: "flex",
            gap: "var(--space-2xl)",
          }}
        >
          {buckets.map((bucket) => {
            const body = (
              <>
                <div
                  style={{
                    fontSize: "var(--font-size-micro)",
                    color: "var(--text-tertiary)",
                    marginBottom: "var(--space-3xs)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {bucket.locked ? (
                    <span aria-label="not spendable" style={{ marginRight: "var(--space-2xs)" }}>
                      🔒
                    </span>
                  ) : null}
                  {bucket.label}
                </div>
                <Money
                  amount={bucket.amount}
                  fractionDigits={2}
                  maxFractionDigits={decimals}
                  masked={masked}
                  style={{ fontSize: "var(--font-size-label)", fontWeight: 400 }}
                />
              </>
            );
            return bucket.onDrill ? (
              <button
                key={bucket.label}
                type="button"
                data-locked={bucket.locked || undefined}
                onClick={bucket.onDrill}
                style={{
                  border: "none",
                  background: "none",
                  padding: 0,
                  cursor: "pointer",
                  textAlign: "left",
                  fontFamily: "var(--font-family)",
                }}
              >
                {body}
              </button>
            ) : (
              <div key={bucket.label} data-locked={bucket.locked || undefined}>
                {body}
              </div>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
