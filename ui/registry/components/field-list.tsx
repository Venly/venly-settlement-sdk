import type { CSSProperties, ReactElement } from "react";

/**
 * Field list with copy – the receive surface.
 *
 * Design contract encoded by this component:
 * - Values are bare text on the card, not boxed.
 * - Per-field copy affordance sits at the row's far right.
 * - A required field carries an amber "Required ⚠" pill inline at the
 *   row's right end, immediately left of the copy control – the pill,
 *   never a colour change on the value.
 * - A conditionally-absent row is ambiguous: render the "(not required)"
 *   variant rather than omitting the row.
 * - Copy confirmation names the field ("You copied your payment
 *   reference") – the onCopy callback receives the label for exactly that.
 */
export interface FieldRow {
  label: string;
  /** undefined/null renders the "(not required)" variant. */
  value?: string | null;
  /** The payer MUST include this field for funds to match. */
  required?: boolean;
  /** Show the copy control. Default true when a value exists. */
  copyable?: boolean;
  /** Render alphanumeric tokens (IBANs, references) in tabular figures. */
  mono?: boolean;
}

export interface FieldListProps {
  fields: FieldRow[];
  /** Called with the field label and value after a copy click. */
  onCopy?: (label: string, value: string) => void;
  style?: CSSProperties;
  className?: string;
}

function RequiredPill(): ReactElement {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--space-2xs)",
        padding: "var(--pill-pad)",
        borderRadius: "var(--radius-pill)",
        fontSize: "var(--font-size-micro)",
        fontWeight: 500,
        color: "var(--state-pending-fg)",
        background: "var(--state-pending-bg)",
        whiteSpace: "nowrap",
      }}
    >
      Required
      <span aria-hidden="true">⚠</span>
    </span>
  );
}

export function FieldList({ fields, onCopy, style, className }: FieldListProps): ReactElement {
  return (
    <dl
      className={className}
      style={{
        margin: 0,
        fontFamily: "var(--font-family)",
        fontSize: "var(--font-size-body)",
        background: "var(--surface-raised)",
        border: "var(--border-w-hairline) solid var(--border-hairline)",
        borderRadius: "var(--radius-card)",
        padding: "var(--space-xs) var(--card-pad)",
        ...style,
      }}
    >
      {fields.map((field) => {
        const hasValue = field.value !== undefined && field.value !== null && field.value !== "";
        const copyable = hasValue && (field.copyable ?? true);
        return (
          <div
            key={field.label}
            className="venly-field-row"
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: "var(--space-md)",
              padding: "var(--space-sm) 0",
              borderBottom: "var(--border-w-hairline) solid var(--border-hairline)",
            }}
          >
            <dt
              style={{
                width: "36%",
                flex: "none",
                color: "var(--text-secondary)",
                fontSize: "var(--font-size-label)",
                paddingTop: "var(--space-3xs)",
              }}
            >
              {field.label}
            </dt>
            <dd
              style={{
                margin: 0,
                flex: 1,
                minWidth: 0,
                color: hasValue ? "var(--text-primary)" : "var(--text-tertiary)",
                fontVariantNumeric: field.mono ? "tabular-nums" : undefined,
                overflowWrap: "anywhere",
              }}
            >
              {/* A required field can never read "(not required)": a missing
                  mandatory value is a state ("not assigned yet"), not an
                  exemption. */}
              {hasValue ? field.value : field.required ? "Not assigned yet" : "(not required)"}
            </dd>
            {field.required ? <RequiredPill /> : null}
            {copyable ? (
              <button
                type="button"
                aria-label={`Copy ${field.label}`}
                onClick={onCopy ? () => onCopy(field.label, field.value as string) : undefined}
                style={{
                  border: "none",
                  background: "none",
                  cursor: "pointer",
                  color: "var(--text-secondary)",
                  fontSize: "var(--font-size-body)",
                  lineHeight: 1,
                  padding: "var(--space-3xs)",
                  flex: "none",
                }}
              >
                ⧉
              </button>
            ) : null}
          </div>
        );
      })}
    </dl>
  );
}
