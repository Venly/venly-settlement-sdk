import type { CSSProperties, ReactElement, ReactNode } from "react";

/**
 * Data table – the ledger register.
 *
 * Contract points from the design library:
 * - Density is the diagnostic number: row pitch ÷ body size targets
 *   2.4–3.8×. Pitch comes from --row-pitch; never inflate with padding.
 * - Header: hairline-only, no fill, micro-size grey sentence case, ~32px.
 * - Money right-aligned tabular; two numeric columns share a right edge.
 * - Hover = full-row ~3% neutral tint, never a border or shadow.
 * - Empty cells render an em-dash – blank reads as a load failure.
 * - Cells truncate with ellipsis; wrapping rows destroy scanability.
 * - No zebra striping: hairline separators only.
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

export interface DataTableProps<Row> {
  columns: DataTableColumn<Row>[];
  rows: Row[];
  rowKey: (row: Row) => string;
  onRowClick?: (row: Row) => void;
  /** Row currently opened in a side panel; stays tinted. */
  selectedKey?: string;
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
  emptyMessage = "Nothing here yet",
  style,
  className,
}: DataTableProps<Row>): ReactElement {
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
        <tr style={{ height: "32px", borderBottom: "1px solid var(--border-hairline)" }}>
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
        {rows.length === 0 ? (
          <tr>
            <td
              colSpan={columns.length}
              style={{
                padding: "24px var(--cell-pad-x)",
                color: "var(--text-secondary)",
                textAlign: "center",
              }}
            >
              {emptyMessage}
            </td>
          </tr>
        ) : (
          rows.map((row) => {
            const key = rowKey(row);
            const selected = key === selectedKey;
            return (
              <tr
                key={key}
                data-selected={selected || undefined}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                style={{
                  height: "var(--row-pitch)",
                  borderBottom: "1px solid var(--border-hairline)",
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
          })
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
