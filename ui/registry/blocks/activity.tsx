import { useEffect, useMemo, useState, type CSSProperties, type ReactElement } from "react";
import type { Transfer } from "@venlyfinance/sdk";
import { useTransfers } from "@venlyfinance/react";
import { Money } from "../lib/money.js";
import { DataTable, RowText, type DataTableColumn, type DataTableGroup } from "../components/data-table.js";
import { StatusPill, type StatusIntent } from "../components/status-pill.js";
import { SidePanel } from "../components/side-panel.js";
import { Timeline, type TimelineStep } from "../components/timeline.js";

/**
 * Activity block – the ledger plus its detail panel.
 *
 * Design contract encoded by this block:
 * - Clicking a row opens the side panel; it never navigates. The source
 *   row stays tinted while the panel is open.
 * - Pending sits in its own section ABOVE settled; the empty pending
 *   section is still drawn, collapsed – "Pending: 0" is a state.
 * - The summary strip is one inline stat row (~a table row tall), its
 *   figures recompute on every filter, and each figure is a selectable
 *   scope switch – the summary IS the primary filter.
 * - Export declares its scope in prose BEFORE offering a format, and the
 *   trigger reads "Export filtered" while a filter is active.
 * - Amounts are signed relative to the account: money leaving is negative
 *   with a true minus, but the level stays tonally neutral – debits are
 *   not red; red is reserved for failure.
 * - Status renders as an inline pill after the primary label – zero column
 *   width, only on rows that need it (PENDING/FAILED; COMPLETED rows stay
 *   quiet because success is the default, not news).
 * - The failure explanation lives where the status is: the panel timeline's
 *   terminal node carries the error message.
 * - ↑/↓ step the panel through the visible rows without closing it; Esc
 *   closes. The footer chips advertise exactly the keys that work.
 */

export type ActivityScope = "all" | "pending" | "failed";

export function transferStatusIntent(status: Transfer["status"]): {
  intent: StatusIntent;
  label: string;
} | null {
  switch (status) {
    case "PENDING":
      return { intent: "pending", label: "Pending" };
    case "FAILED":
      return { intent: "negative", label: "Failed" };
    default:
      return null; // COMPLETED rows stay quiet: colour is a budget
  }
}

export function transferTimeline(transfer: Transfer): TimelineStep[] {
  return [
    {
      key: "created",
      label: "Created",
      meta: transfer.createdAt,
      state: "completed",
    },
    {
      key: "settled",
      label:
        transfer.status === "FAILED"
          ? (transfer.errorMessage ?? "Transfer failed")
          : "Settled",
      meta: transfer.status === "COMPLETED" ? transfer.updatedAt : undefined,
      state:
        transfer.status === "COMPLETED"
          ? "completed"
          : transfer.status === "FAILED"
            ? "failed"
            : "current",
    },
  ];
}

/** Direction relative to the account viewing the ledger. */
export function transferDirection(transfer: Transfer, accountId: string): "in" | "out" {
  return transfer.senderAccountId === accountId ? "out" : "in";
}

/** Outgoing money is negative; the LEVEL stays tonally neutral either way. */
export function signedTransferAmount(
  transfer: Transfer,
  accountId?: string,
): number | undefined {
  if (transfer.amount === undefined) return undefined;
  if (accountId && transferDirection(transfer, accountId) === "out") return -transfer.amount;
  return transfer.amount;
}

/** The scope switch the summary strip drives. */
export function scopeTransfers(transfers: Transfer[], scope: ActivityScope): Transfer[] {
  switch (scope) {
    case "pending":
      return transfers.filter((t) => t.status === "PENDING");
    case "failed":
      return transfers.filter((t) => t.status === "FAILED");
    default:
      return transfers;
  }
}

/** Recomputed on every filter change – aggregates must never go stale. */
export function activitySummary(transfers: Transfer[]): {
  transfers: number;
  pending: number;
  failed: number;
} {
  return {
    transfers: transfers.length,
    pending: transfers.filter((t) => t.status === "PENDING").length,
    failed: transfers.filter((t) => t.status === "FAILED").length,
  };
}

/** Scope in prose BEFORE the format choice – the reader must know what
 *  leaves the app before choosing how it leaves. */
export function exportScopeSentence(count: number, total: number): string {
  return count === total
    ? `Exports all ${total} transfer${total === 1 ? "" : "s"} on this account.`
    : `Exports the ${count} transfer${count === 1 ? "" : "s"} matching your current filters, out of ${total}.`;
}

function csvField(value: unknown): string {
  const s = value === undefined || value === null ? "" : String(value);
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

export function transfersToCsv(transfers: Transfer[], accountId?: string): string {
  const header = "id,createdAt,direction,asset,chain,amount,status,description,reference";
  const lines = transfers.map((t) =>
    [
      t.id,
      t.createdAt,
      accountId ? transferDirection(t, accountId) : "",
      t.asset,
      t.chain,
      signedTransferAmount(t, accountId),
      t.status,
      t.description,
      t.merchantReference,
    ]
      .map(csvField)
      .join(","),
  );
  return [header, ...lines].join("\n");
}

/** The activity table's group for a transfer: pending above settled. */
export function transferGroupKey(transfer: Transfer): "pending" | "settled" {
  return transfer.status === "PENDING" ? "pending" : "settled";
}

/**
 * The ids the keyboard stepper may visit: exactly the rows the grouped
 * table renders. A collapsed group renders no rows, so its ids are
 * excluded – the stepper must never select a row with no <tr>, or the
 * "source row stays tinted" contract silently breaks.
 */
export function visibleTransferIds(
  transfers: Transfer[],
  collapsedGroups: Record<string, boolean>,
): string[] {
  return transfers
    .filter((t) => !collapsedGroups[transferGroupKey(t)])
    .map((t) => t.id ?? "");
}

/** Row-stepping: ↑/↓ move through the visible rows; never wraps. */
export function stepSelection(
  visibleIds: string[],
  currentId: string | null,
  delta: 1 | -1,
): string | null {
  if (visibleIds.length === 0) return null;
  if (currentId === null) return delta === 1 ? visibleIds[0] : null;
  const index = visibleIds.indexOf(currentId);
  if (index === -1) return visibleIds[0];
  const next = index + delta;
  if (next < 0 || next >= visibleIds.length) return currentId;
  return visibleIds[next];
}

function transferColumns(accountId?: string): DataTableColumn<Transfer>[] {
  return [
    {
      key: "what",
      header: "Transfer",
      cell: (t) => {
        const status = transferStatusIntent(t.status);
        return (
          <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-sm)" }}>
            <RowText
              primary={t.description ?? t.merchantReference ?? "Transfer"}
              secondary={t.asset ? `${t.asset}${t.chain ? ` · ${t.chain}` : ""}` : t.merchantReference}
            />
            {status ? <StatusPill label={status.label} intent={status.intent} /> : null}
          </span>
        );
      },
    },
    { key: "date", header: "Date", cell: (t) => t.createdAt?.slice(0, 10) },
    {
      key: "amount",
      header: "Amount",
      money: true,
      cell: (t) => {
        const amount = signedTransferAmount(t, accountId);
        return amount === undefined ? null : <Money amount={amount} currency={t.asset} />;
      },
    },
  ];
}

export function ActivityTable({
  transfers,
  selectedId,
  onSelect,
  accountId,
}: {
  transfers: Transfer[];
  selectedId?: string;
  onSelect?: (transfer: Transfer) => void;
  /** Signs amounts relative to this account when provided. */
  accountId?: string;
}): ReactElement {
  return (
    <DataTable
      columns={transferColumns(accountId)}
      rows={transfers}
      rowKey={(t) => t.id ?? ""}
      selectedKey={selectedId}
      onRowClick={onSelect}
      emptyMessage="No transfers yet"
    />
  );
}

/** Pending in its own section above settled; empty sections still drawn. */
export function GroupedActivityTable({
  transfers,
  selectedId,
  onSelect,
  accountId,
  collapsedGroups,
  onGroupToggle,
}: {
  transfers: Transfer[];
  selectedId?: string;
  onSelect?: (transfer: Transfer) => void;
  accountId?: string;
  /** Controlled collapse state – required when a stepper reads the rows. */
  collapsedGroups?: Record<string, boolean>;
  onGroupToggle?: (key: string, collapsed: boolean) => void;
}): ReactElement {
  const groups: DataTableGroup<Transfer>[] = [
    {
      key: "pending",
      label: "Pending",
      rows: transfers.filter((t) => transferGroupKey(t) === "pending"),
      attention: true,
    },
    {
      key: "settled",
      label: "Settled",
      rows: transfers.filter((t) => transferGroupKey(t) === "settled"),
    },
  ];
  return (
    <DataTable
      columns={transferColumns(accountId)}
      rows={[]}
      groups={groups}
      collapsedGroups={collapsedGroups}
      onGroupToggle={onGroupToggle}
      rowKey={(t) => t.id ?? ""}
      selectedKey={selectedId}
      onRowClick={onSelect}
    />
  );
}

export function TransferDetailPanel({
  transfer,
  onClose,
  accountId,
}: {
  transfer: Transfer;
  onClose: () => void;
  /** Signs the hero amount relative to this account when provided. */
  accountId?: string;
}): ReactElement {
  return (
    <SidePanel
      context={`Transfer · ${transfer.createdAt?.slice(0, 10) ?? ""}`}
      amount={signedTransferAmount(transfer, accountId)}
      currency={transfer.asset}
      qualifier={transfer.description ?? transfer.merchantReference ?? transfer.id}
      onClose={onClose}
    >
      <div
        style={{
          fontSize: "var(--font-size-label)",
          color: "var(--text-secondary)",
          marginBottom: "var(--space-xs)",
        }}
      >
        Status
      </div>
      <Timeline steps={transferTimeline(transfer)} />
      {transfer.transactionHash ? (
        <p
          style={{
            fontSize: "var(--font-size-label)",
            color: "var(--text-secondary)",
            overflowWrap: "anywhere",
          }}
        >
          Transaction {transfer.transactionHash}
        </p>
      ) : null}
    </SidePanel>
  );
}

function StatFigure({
  label,
  value,
  selected,
  onClick,
}: {
  label: string;
  value: number;
  selected: boolean;
  onClick: () => void;
}): ReactElement {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        gap: "var(--space-3xs)",
        border: "none",
        background: "none",
        cursor: "pointer",
        padding: 0,
        fontFamily: "var(--font-family)",
        borderBottom: selected
          ? "var(--border-w-emphasis) solid var(--accent)"
          : "var(--border-w-emphasis) solid transparent",
      }}
    >
      <span style={{ fontSize: "var(--font-size-micro)", color: "var(--text-tertiary)" }}>{label}</span>
      <span
        style={{
          fontSize: "var(--font-size-value)",
          fontWeight: 600,
          fontVariantNumeric: "tabular-nums",
          color: selected ? "var(--text-primary)" : "var(--text-secondary)",
        }}
      >
        {value}
      </span>
    </button>
  );
}

function triggerDownload(filename: string, mime: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Ledger + panel, bound to the account's transfers. */
export function ActivityBlock({
  accountId,
  initialScope = "all",
  style,
  className,
}: {
  accountId: string;
  /** Landing scope, e.g. "pending" when arriving from a reserved drill. */
  initialScope?: ActivityScope;
  style?: CSSProperties;
  className?: string;
}): ReactElement {
  const { data, isPending } = useTransfers(accountId);
  const [scope, setScope] = useState<ActivityScope>(initialScope);
  const [assetFilter, setAssetFilter] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  // Collapse state is lifted out of the table so the keyboard stepper
  // knows exactly which rows are rendered.
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  // Selection is held by id and re-derived from the live list on every
  // render: when a refetch moves a transfer from PENDING to COMPLETED or
  // FAILED while its panel is open, the panel shows the new state, not a
  // snapshot from click time.
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const all = useMemo(() => data?.items ?? [], [data]);
  const assets = useMemo(
    () => [...new Set(all.map((t) => t.asset).filter((a): a is string => Boolean(a)))],
    [all],
  );

  // Filter order: asset first, then scope. The summary recomputes after
  // the asset filter so its figures always describe what the strip can
  // switch between, never a stale superset.
  const assetFiltered = useMemo(
    () => (assetFilter ? all.filter((t) => t.asset === assetFilter) : all),
    [all, assetFilter],
  );
  const summary = useMemo(() => activitySummary(assetFiltered), [assetFiltered]);
  const visible = useMemo(() => scopeTransfers(assetFiltered, scope), [assetFiltered, scope]);
  // Display order mirrors the grouped table: pending above settled.
  const visibleOrdered = useMemo(
    () => [
      ...visible.filter((t) => t.status === "PENDING"),
      ...visible.filter((t) => t.status !== "PENDING"),
    ],
    [visible],
  );

  // The stepper may only visit rows the table actually renders: a
  // selection inside a collapsed group would tint no row at all.
  const steppableIds = useMemo(
    () => visibleTransferIds(visibleOrdered, collapsedGroups),
    [visibleOrdered, collapsedGroups],
  );
  const selected =
    selectedId && steppableIds.includes(selectedId)
      ? (visibleOrdered.find((t) => t.id === selectedId) ?? null)
      : null;
  const filtered = assetFilter !== null || scope !== "all";

  // ↑/↓ step the open panel through the visible rows; Esc closes. The
  // listener exists only while the panel is open, and never fights a
  // focused form control.
  useEffect(() => {
    if (!selected) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (event.key === "Escape") {
        setSelectedId(null);
      } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        setSelectedId((current) =>
          stepSelection(steppableIds, current, event.key === "ArrowDown" ? 1 : -1),
        );
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [selected, steppableIds]);

  const toggleScope = (next: ActivityScope) => {
    setScope((current) => (current === next ? "all" : next));
  };

  return (
    <section className={className} style={{ fontFamily: "var(--font-family)", ...style }}>
      {isPending ? (
        <p style={{ color: "var(--text-tertiary)" }}>Loading activity…</p>
      ) : (
        <>
          {/* Summary strip: one inline stat row, no containers, under a
              table row tall. Each figure is the scope switch. */}
          <div
            style={{
              display: "flex",
              alignItems: "flex-end",
              gap: "var(--space-2xl)",
              marginBottom: "var(--space-lg)",
            }}
          >
            <StatFigure
              label="Transfers"
              value={summary.transfers}
              selected={scope === "all"}
              onClick={() => setScope("all")}
            />
            <StatFigure
              label="Pending"
              value={summary.pending}
              selected={scope === "pending"}
              onClick={() => toggleScope("pending")}
            />
            <StatFigure
              label="Failed"
              value={summary.failed}
              selected={scope === "failed"}
              onClick={() => toggleScope("failed")}
            />

            <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "var(--space-sm)" }}>
              {assets.length > 1 ? (
                <select
                  aria-label="Filter by asset"
                  value={assetFilter ?? ""}
                  onChange={(e) => setAssetFilter(e.target.value === "" ? null : e.target.value)}
                  style={{
                    fontFamily: "var(--font-family)",
                    fontSize: "var(--font-size-label)",
                    color: assetFilter ? "var(--text-primary)" : "var(--text-secondary)",
                    background: assetFilter ? "var(--selected-tint)" : "var(--surface-raised)",
                    border: "var(--border-w-hairline) solid var(--border-hairline)",
                    borderRadius: "var(--radius-control)",
                    padding: "var(--space-2xs) var(--space-sm)",
                  }}
                >
                  <option value="">All assets</option>
                  {assets.map((asset) => (
                    <option key={asset} value={asset}>
                      {asset}
                    </option>
                  ))}
                </select>
              ) : null}
              {assetFilter ? (
                <button
                  type="button"
                  aria-label={`Clear ${assetFilter} filter`}
                  onClick={() => setAssetFilter(null)}
                  style={{
                    border: "none",
                    background: "none",
                    cursor: "pointer",
                    color: "var(--text-secondary)",
                    fontSize: "var(--font-size-label)",
                    padding: 0,
                  }}
                >
                  ✕
                </button>
              ) : null}
              <div style={{ position: "relative" }}>
                <button
                  type="button"
                  onClick={() => setExportOpen((open) => !open)}
                  style={{
                    fontFamily: "var(--font-family)",
                    fontSize: "var(--font-size-label)",
                    color: "var(--text-primary)",
                    background: "var(--surface-raised)",
                    border: "var(--border-w-hairline) solid var(--border-hairline)",
                    borderRadius: "var(--radius-control)",
                    padding: "var(--space-2xs) var(--space-sm)",
                    cursor: "pointer",
                  }}
                >
                  {filtered ? "Export filtered" : "Export"}
                </button>
                {exportOpen ? (
                  <div
                    role="dialog"
                    aria-label="Export transfers"
                    style={{
                      position: "absolute",
                      right: 0,
                      top: "100%",
                      marginTop: "var(--space-2xs)",
                      width: "var(--card-max-width)",
                      maxWidth: "var(--panel-min-width)",
                      background: "var(--surface-raised)",
                      border: "var(--border-w-hairline) solid var(--border-hairline)",
                      borderRadius: "var(--radius-card)",
                      boxShadow: "var(--shadow-overlay)",
                      padding: "var(--space-lg)",
                      zIndex: 1,
                    }}
                  >
                    {/* Scope first, format second: the reader must know what
                        leaves the app before choosing how. */}
                    <p
                      style={{
                        margin: "0 0 var(--space-md)",
                        fontSize: "var(--font-size-label)",
                        color: "var(--text-secondary)",
                      }}
                    >
                      {exportScopeSentence(visible.length, all.length)}
                    </p>
                    <div style={{ display: "flex", gap: "var(--space-sm)" }}>
                      {(
                        [
                          ["CSV", "text/csv", () => transfersToCsv(visible, accountId), "transfers.csv"],
                          ["JSON", "application/json", () => JSON.stringify(visible, null, 2), "transfers.json"],
                        ] as const
                      ).map(([label, mime, make, filename]) => (
                        <button
                          key={label}
                          type="button"
                          onClick={() => {
                            triggerDownload(filename, mime, make());
                            setExportOpen(false);
                          }}
                          style={{
                            fontFamily: "var(--font-family)",
                            fontSize: "var(--font-size-label)",
                            fontWeight: 500,
                            color: "var(--accent-fg)",
                            background: "var(--accent)",
                            border: "none",
                            borderRadius: "var(--radius-control)",
                            padding: "var(--space-xs) var(--space-md)",
                            cursor: "pointer",
                          }}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          <GroupedActivityTable
            transfers={visible}
            accountId={accountId}
            selectedId={selected?.id}
            onSelect={(t) => setSelectedId(t.id ?? null)}
            collapsedGroups={collapsedGroups}
            onGroupToggle={(key, isCollapsed) =>
              setCollapsedGroups((c) => ({ ...c, [key]: isCollapsed }))
            }
          />
        </>
      )}
      {selected ? (
        <TransferDetailPanel
          transfer={selected}
          accountId={accountId}
          onClose={() => setSelectedId(null)}
        />
      ) : null}
    </section>
  );
}
