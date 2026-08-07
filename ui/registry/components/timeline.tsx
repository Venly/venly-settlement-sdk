import type { CSSProperties, ReactElement, ReactNode } from "react";

/**
 * Vertical timeline – status story for one money movement.
 *
 * Design contract encoded by this component:
 * - State is distinguished on three axes at once: node, rail below, label.
 * - Solid rail = past, dotted rail = future; the switch happens at the
 *   current node. Never inverted.
 * - Current node = accent donut + bold label. Future = hollow node, grey
 *   regular label.
 * - Terminal failure/cancellation: the node goes neutral grey or danger,
 *   NEVER a success-green check – a green check on a cancelled step makes
 *   the timeline read "all good" at a glance (the most dangerous timeline
 *   error observed in the reference corpus).
 */
export type TimelineStepState = "completed" | "current" | "future" | "failed" | "cancelled";

export interface TimelineStep {
  key: string;
  label: ReactNode;
  /** Completion word, timestamp, or estimate. */
  meta?: ReactNode;
  state: TimelineStepState;
}

export interface TimelineProps {
  steps: TimelineStep[];
  style?: CSSProperties;
  className?: string;
}

const NODE_SIZE = "var(--timeline-node)";

function Node({ state }: { state: TimelineStepState }): ReactElement {
  const base: CSSProperties = {
    width: NODE_SIZE,
    height: NODE_SIZE,
    borderRadius: "50%",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "calc(var(--timeline-node) * 0.625)",
    lineHeight: 1,
    flex: "none",
  };
  switch (state) {
    case "completed":
      return (
        <span aria-hidden="true" style={{ ...base, background: "var(--state-success-bg)", color: "var(--state-success-fg)", border: "1px solid var(--state-success-fg)" }}>
          ✓
        </span>
      );
    case "current":
      return (
        <span
          aria-hidden="true"
          style={{
            ...base,
            border: "2px solid var(--accent)",
            background: "var(--surface-raised)",
          }}
        >
          <span style={{ width: "calc(var(--timeline-node) * 0.375)", height: "calc(var(--timeline-node) * 0.375)", borderRadius: "50%", background: "var(--accent)" }} />
        </span>
      );
    case "failed":
      return (
        <span aria-hidden="true" style={{ ...base, background: "var(--state-danger-bg)", color: "var(--state-danger-fg)", border: "1px solid var(--state-danger-fg)" }}>
          ✕
        </span>
      );
    case "cancelled":
      return (
        <span aria-hidden="true" style={{ ...base, background: "var(--state-neutral-bg)", color: "var(--state-neutral-fg)", border: "1px solid var(--border-strong)" }}>
          ↺
        </span>
      );
    case "future":
      return (
        <span
          aria-hidden="true"
          style={{ ...base, border: "1.5px solid var(--border-strong)", background: "var(--surface-raised)" }}
        />
      );
  }
}

export function Timeline({ steps, style, className }: TimelineProps): ReactElement {
  return (
    <ol
      className={className}
      style={{
        listStyle: "none",
        margin: 0,
        padding: 0,
        fontFamily: "var(--font-family)",
        fontSize: "var(--font-size-body)",
        ...style,
      }}
    >
      {steps.map((step, i) => {
        const isLast = i === steps.length - 1;
        // The rail below a node is solid while we are in the past, dotted
        // once the story crosses the current node into the future.
        const railFuture =
          step.state === "future" ||
          step.state === "current" ||
          step.state === "failed" ||
          step.state === "cancelled";
        const labelColor =
          step.state === "future"
            ? "var(--text-tertiary)"
            : step.state === "cancelled"
              ? "var(--text-secondary)"
              : "var(--text-primary)";
        return (
          <li key={step.key} data-state={step.state} style={{ display: "flex", gap: "var(--space-md)" }}>
            <span style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
              <Node state={step.state} />
              {!isLast ? (
                <span
                  aria-hidden="true"
                  style={{
                    flex: 1,
                    minHeight: "var(--space-lg)",
                    width: 0,
                    margin: "3px 0",
                    borderLeft: railFuture
                      ? "1px dotted var(--border-strong)"
                      : "2px solid var(--state-success-fg)",
                    opacity: railFuture ? 1 : 0.5,
                  }}
                />
              ) : null}
            </span>
            <span style={{ paddingBottom: isLast ? 0 : "var(--space-xl)", minWidth: 0 }}>
              <span
                style={{
                  display: "block",
                  fontWeight: step.state === "current" ? 600 : 400,
                  color: labelColor,
                }}
              >
                {step.label}
              </span>
              {step.meta !== undefined ? (
                <span
                  style={{
                    display: "block",
                    fontSize: "var(--font-size-label)",
                    color: "var(--text-tertiary)",
                  }}
                >
                  {step.meta}
                </span>
              ) : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
