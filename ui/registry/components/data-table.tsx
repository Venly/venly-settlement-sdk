import { useState, type CSSProperties, type ReactElement, type ReactNode } from "react";

/**
 * Data table – the ledger register.
 *
 * Design contract encoded by this component:
 * - Density is the diagnostic number: row pitch ÷ body size targets
 *   2.4–3.8×. Pitch comes from --row-pitch; never inflate with padding.
 * - Header: hairline-only, no fill, micro-size grey sentence case, ~32px.
 * - Money right-aligned tabular; two numeric columns share a right edge.
 * - Hover = full-row ~3% neutral tint, never a border or shadow.
 * - Empty cells render an em-dash – blank reads as a load failure.
 * - Cells truncate with ellipsis; wrapping rows destroy scanability.
 * - No zebra striping: hairline separators only.
 * - Grouped mode: section bands at ~60% of a data row ([chevron] name ·
 *   count). Empty groups are still DRAWN, collapsed to the single band –
 *   "Pending: 0" is a state, not a missing feature. Needs-attention groups
 *   carry a small dot; the count is the signal, absence of a count means
 *   nothing to do.
 */
export interface DataTableColumn<Row> {
  key: string;
  header: string;
  /** Money columns set this: right-aligns and applies tabular figures. */
  money?: boolean;
  align?: "left" | "right";
  width?: string;
  cell: (row: Row) => ReactNode;
}

export interface DataTableGroup<Row> {
  key: string;
  label: string;
  rows: Row[];
  /** Renders the small dot beside the label when the group has rows. */
  attention?: boolean;
}

export interface DataTableProps<Row> {
  columns: DataTableColumn<Row>[];
  rows: Row[];
  rowKey: (row: Row) => string;
  onRowClick?: (row: Row) => void;
  /** Row currently opened in a side panel; stays tinted. */
  selectedKey?: string;
  /**
   * Sectioned rendering: rows come from the groups, in order, each under
   * its own collapsible band. `rows` is ignored while groups are set.
   */
  groups?: DataTableGroup<Row>[];
  /**
   * Controlled collapse state per group key. Provide it (with
   * onGroupToggle) when anything OUTSIDE the table depends on which rows
   * are actually rendered – e.g. a keyboard row-stepper must never select
   * a row whose group is collapsed. Uncontrolled when omitted.
   */
  collapsedGroups?: Record<string, boolean>;
  onGroupToggle?: (key: string, collapsed: boolean) => void;
  emptyMessage?: string;
  style?: CSSProperties;
  className?: string;
}

const EMPTY = "—";

function cellContent(value: ReactNode): ReactNode {
  return value === null || value === undefined || value === "" ? EMPTY : value;
}

export function DataTable<Row>({
  columns,
  rows,
  rowKey,
  onRowClick,
  selectedKey,
  groups,
  collapsedGroups,
  onGroupToggle,
  emptyMessage = "Nothing here yet",
  style,
  className,
}: DataTableProps<Row>): ReactElement {
  const [internalCollapsed, setInternalCollapsed] = useState<Record<string, boolean>>({});
  const collapsed = collapsedGroups ?? internalCollapsed;
  const toggleGroup = (key: string, next: boolean) => {
    if (collapsedGroups === undefined) setInternalCollapsed((c) => ({ ...c, [key]: next }));
    onGroupToggle?.(key, next);
  };

  const renderRow = (row: Row): ReactElement => {
    const key = rowKey(row);
    const selected = key === selectedKey;
    return (
      <tr
        key={key}
        data-selected={selected || undefined}
        onClick={onRowClick ? () => onRowClick(row) : undefined}
        style={{
          height: "var(--row-pitch)",
          borderBottom: "var(--border-w-hairline) solid var(--border-hairline)",
          background: selected ? "var(--selected-tint)" : undefined,
          cursor: onRowClick ? "pointer" : undefined,
        }}
      >
        {columns.map((col) => (
          <td
            key={col.key}
            style={{
              padding: "var(--cell-pad-y) var(--cell-pad-x)",
              textAlign: col.money ? "right" : (col.align ?? "left"),
              fontVariantNumeric: col.money ? "tabular-nums" : undefined,
              maxWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {cellContent(col.cell(row))}
          </td>
        ))}
      </tr>
    );
  };

  return (
    <table
      className={className}
      style={{
        width: "100%",
        borderCollapse: "collapse",
        fontSize: "var(--font-size-body)",
        fontFamily: "var(--font-family)",
        color: "var(--text-primary)",
        background: "var(--surface-raised)",
        ...style,
      }}
    >
      <thead>
        <tr style={{ height: "var(--header-pitch)", borderBottom: "var(--border-w-hairline) solid var(--border-hairline)" }}>
          {columns.map((col) => (
            <th
              key={col.key}
              scope="col"
              style={{
                textAlign: col.money ? "right" : (col.align ?? "left"),
                fontSize: "var(--font-size-micro)",
                fontWeight: 400,
                color: "var(--text-tertiary)",
                padding: "0 var(--cell-pad-x)",
                width: col.width,
                whiteSpace: "nowrap",
              }}
            >
              {col.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {groups ? (
          groups.flatMap((group) => {
            const isEmpty = group.rows.length === 0;
            const isCollapsed = isEmpty || (collapsed[group.key] ?? false);
            const band = (
              <tr key={`group-${group.key}`} data-group={group.key}>
                <td colSpan={columns.length} style={{ padding: 0, borderBottom: "var(--border-w-hairline) solid var(--border-hairline)" }}>
                  <button
                    type="button"
                    aria-expanded={!isCollapsed}
                    onClick={isEmpty ? undefined : () => toggleGroup(group.key, !isCollapsed)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "var(--space-xs)",
                      width: "100%",
                      height: "var(--group-header-pitch)",
                      border: "none",
                      background: "none",
                      cursor: isEmpty ? "default" : "pointer",
                      padding: "0 var(--cell-pad-x)",
                      fontFamily: "var(--font-family)",
                      fontSize: "var(--font-size-micro)",
                      fontWeight: 500,
                      color: "var(--text-secondary)",
                      textAlign: "left",
                    }}
                  >
                    <span aria-hidden="true">{isCollapsed ? "▸" : "▾"}</span>
                    <span>{group.label}</span>
                    <span style={{ color: "var(--text-tertiary)", fontWeight: 400 }}>
                      {group.rows.length}
                    </span>
                    {group.attention && group.rows.length > 0 ? (
                      <span
                        aria-label="needs attention"
                        style={{
                          width: "var(--attention-dot)",
                          height: "var(--attention-dot)",
                          borderRadius: "var(--radius-pill)",
                          background: "var(--accent)",
                        }}
                      />
                    ) : null}
                  </button>
                </td>
              </tr>
            );
            return isCollapsed ? [band] : [band, ...group.rows.map(renderRow)];
          })
        ) : rows.length === 0 ? (
          <tr>
            <td
              colSpan={columns.length}
              style={{
                padding: "var(--space-2xl) var(--cell-pad-x)",
                color: "var(--text-secondary)",
                textAlign: "center",
              }}
            >
              {emptyMessage}
            </td>
          </tr>
        ) : (
          rows.map(renderRow)
        )}
      </tbody>
    </table>
  );
}

/**
 * Row content helper: primary 14px medium + secondary micro-size one tonal
 * step down. Secondary is de-emphasised by BOTH size and colour; invert to a
 * state colour only for warnings ("Overdue 17 hours").
 */
export function RowText({
  primary,
  secondary,
  warn,
}: {
  primary: ReactNode;
  secondary?: ReactNode;
  warn?: boolean;
}): ReactElement {
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", lineHeight: 1.35 }}>
      <span style={{ fontWeight: 500 }}>{primary}</span>
      {secondary !== undefined ? (
        <span
          style={{
            fontSize: "var(--font-size-micro)",
            color: warn ? "var(--state-danger-fg)" : "var(--text-tertiary)",
          }}
        >
          {secondary}
        </span>
      ) : null}
    </span>
  );
}

/**
 * Loading placeholder that preserves the table's geometry exactly.
 *
 * Takes the SAME column definitions as `DataTable`, so the header labels stay
 * real and every placeholder cell inherits that column's width, alignment and
 * pitch. Nothing reflows when the real rows arrive - the corpus rule is a
 * skeleton that keeps its column geometry, never a prose "Loading..." line
 * (which shifts the whole page on every screen open).
 */
/** Default placeholder rows - a measured four is about one ledger screen. */
export const TABLE_SKELETON_ROWS = 4;

/**
 * Ragged bar widths: a uniform grid of identical bars reads as a wireframe,
 * while varied lengths read as content that has not arrived yet. Money columns
 * stay narrow because figures are.
 */
const barWidth = (columnIndex: number, money?: boolean): string =>
  money ? "4.5em" : ["82%", "58%", "70%"][columnIndex % 3];

export function TableSkeleton<Row = unknown>({
  columns,
  rows = TABLE_SKELETON_ROWS,
  label = "Loading",
  style,
}: {
  /** The SAME column definitions the real table takes - identical geometry. */
  columns: DataTableColumn<Row>[];
  /** Placeholder row count. Match the list's typical page, not its maximum. */
  rows?: number;
  /** Accessible description of what is loading, e.g. "Loading balances". */
  label?: string;
  style?: CSSProperties;
}) {
  return (
    <table
      aria-busy="true"
      aria-label={label}
      style={{
        width: "100%",
        borderCollapse: "collapse",
        fontSize: "var(--font-size-body)",
        fontFamily: "var(--font-family)",
        color: "var(--text-primary)",
        background: "var(--surface-raised)",
        ...style,
      }}
    >
      <thead>
        <tr style={{ height: "var(--header-pitch)", borderBottom: "var(--border-w-hairline) solid var(--border-hairline)" }}>
          {columns.map((col) => (
            <th
              key={col.key}
              scope="col"
              style={{
                textAlign: col.money ? "right" : (col.align ?? "left"),
                fontSize: "var(--font-size-micro)",
                fontWeight: 400,
                color: "var(--text-tertiary)",
                padding: "0 var(--cell-pad-x)",
                width: col.width,
                whiteSpace: "nowrap",
              }}
            >
              {col.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {Array.from({ length: rows }, (_, rowIndex) => (
          <tr
            key={rowIndex}
            style={{
              height: "var(--row-pitch)",
              borderBottom: "var(--border-w-hairline) solid var(--border-hairline)",
            }}
          >
            {columns.map((col, colIndex) => (
              <td
                key={col.key}
                style={{
                  padding: "var(--cell-pad-y) var(--cell-pad-x)",
                  textAlign: col.money ? "right" : (col.align ?? "left"),
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    display: "inline-block",
                    height: "0.75em",
                    width: barWidth(colIndex, col.money),
                    maxWidth: "100%",
                    borderRadius: "var(--radius-pill)",
                    background: "var(--border-hairline)",
                    verticalAlign: "middle",
                  }}
                />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
