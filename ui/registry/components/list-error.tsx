import type { ReactElement } from "react";

/**
 * Error state for list-bearing surfaces.
 *
 * Design contract encoded by this component:
 * - A missing result collection (`resultPresent === false`) is an ERROR,
 *   never an empty list. An empty list is a claim – "there is nothing" –
 *   and a malformed envelope cannot support that claim. Rendering it as
 *   empty tells the user "all clear" on evidence that says "unknown".
 * - The copy names what failed to load and admits the list may be
 *   incomplete; it never blames the user and never says "try again later"
 *   without offering the retry.
 * - role="alert" so the failure is announced, not silently swapped in.
 * - The retry is a real control wired to the query's refetch.
 */
export function ListLoadError({
  what,
  onRetry,
}: {
  /** What failed to load, in the user's words: "your balances". */
  what: string;
  onRetry?: () => void;
}): ReactElement {
  return (
    <section role="alert" style={{ fontFamily: "var(--font-family)" }}>
      <p
        style={{
          background: "var(--state-pending-bg)",
          color: "var(--state-pending-fg)",
          borderRadius: "var(--radius-control)",
          padding: "var(--space-sm) var(--space-md)",
          fontSize: "var(--font-size-label)",
          margin: 0,
        }}
      >
        <span aria-hidden="true">⚠</span> We couldn't load {what} – the list may be
        incomplete, so nothing is shown rather than a wrong "all clear".
      </p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          style={{
            marginTop: "var(--space-sm)",
            border: "var(--border-w-hairline) solid var(--border-strong)",
            background: "var(--surface-raised)",
            color: "var(--text-primary)",
            borderRadius: "var(--radius-control)",
            padding: "var(--space-2xs) var(--space-sm)",
            fontSize: "var(--font-size-label)",
            fontFamily: "var(--font-family)",
            cursor: "pointer",
          }}
        >
          Retry
        </button>
      ) : null}
    </section>
  );
}
