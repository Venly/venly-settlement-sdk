import type { CSSProperties, ReactElement } from "react";

/**
 * Status pill – reads as a data value in a table column.
 *
 * Design contract encoded by this component:
 * - 4px radius rectangle (not fully rounded) in data contexts.
 * - Tinted background + text at the dark step of the same ramp; you should
 *   be able to read row text through the pill.
 * - State is never carried by colour alone: every pill renders word AND
 *   glyph. Glyph trails the word (`Failed ✕`) – trailing is calmer.
 * - Cancelled is a neutral terminal: grey with ↺, never red, never green.
 */
export type StatusIntent = "positive" | "negative" | "pending" | "neutral" | "active";

const INTENT_VARS: Record<StatusIntent, { fg: string; bg: string }> = {
  positive: { fg: "var(--state-success-fg)", bg: "var(--state-success-bg)" },
  negative: { fg: "var(--state-danger-fg)", bg: "var(--state-danger-bg)" },
  pending: { fg: "var(--state-pending-fg)", bg: "var(--state-pending-bg)" },
  neutral: { fg: "var(--state-neutral-fg)", bg: "var(--state-neutral-bg)" },
  active: { fg: "var(--accent)", bg: "var(--state-neutral-bg)" },
};

const DEFAULT_GLYPH: Record<StatusIntent, string> = {
  positive: "✓", // ✓
  negative: "✕", // ✕
  pending: "○", // ○
  neutral: "↺", // ↺ (cancelled/returned family)
  active: "●", // ●
};

export interface StatusPillProps {
  label: string;
  intent: StatusIntent;
  /** Override the default glyph for this intent; pass one character. */
  glyph?: string;
  style?: CSSProperties;
  className?: string;
}

export function StatusPill({
  label,
  intent,
  glyph,
  style,
  className,
}: StatusPillProps): ReactElement {
  const colors = INTENT_VARS[intent];
  return (
    <span
      className={className}
      data-intent={intent}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--space-2xs)",
        padding: "var(--pill-pad)",
        borderRadius: "var(--radius-pill)",
        fontSize: "var(--font-size-micro)",
        fontWeight: 500,
        lineHeight: 1.4,
        color: colors.fg,
        background: colors.bg,
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      {label}
      <span aria-hidden="true">{glyph ?? DEFAULT_GLYPH[intent]}</span>
    </span>
  );
}
