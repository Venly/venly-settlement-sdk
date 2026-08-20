import { useEffect, useMemo, useState, type CSSProperties, type ReactElement } from "react";
import type { FundflowComponents, Transfer } from "@venlyfinance/sdk";
import { describeRampStatus, useRampRequests, useTransfers } from "@venlyfinance/react";
import { ListLoadError } from "../components/list-error.js";
import { Money, formatAmount } from "../lib/money.js";
import {
  DataTable,
  RowText,
  TableSkeleton,
  type DataTableColumn,
  type DataTableGroup,
} from "../components/data-table.js";
import { StatusPill, type StatusIntent } from "../components/status-pill.js";
import { SidePanel } from "../components/side-panel.js";
import { Timeline, type TimelineStep } from "../components/timeline.js";
import { FieldList } from "../components/field-list.js";
import { WITHDRAW_STATUS_PILL } from "./withdraw.js";

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
    <div className="venly-table-scroll">
      <DataTable
        columns={transferColumns(accountId)}
        rows={transfers}
        rowKey={(t) => t.id ?? ""}
        selectedKey={selectedId}
        onRowClick={onSelect}
        emptyMessage="No transfers yet"
      />
    </div>
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
    <div className="venly-table-scroll">
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
    </div>
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

// ── Unified activity (transfers + company ramps, one feed) ─────────────
//
// The neobank has two ledgers with different scopes: finance transfers
// belong to the selected account; ramp requests (withdrawals, add money)
// belong to the company - the API carries no account linkage for them.
// One feed renders both, and a labelled Scope column says which is which
// instead of guessing a linkage that doesn't exist.

type fundflow = FundflowComponents["schemas"];
export type RampActivityItem = fundflow["RampRequestListItem"];

export type UnifiedActivityRow =
  | { kind: "transfer"; key: string; createdAt?: string; transfer: Transfer }
  | { kind: "ramp"; key: string; createdAt?: string; ramp: RampActivityItem };

/** Merge is presentation-only: keys namespace the source ledger. */
export function unifyActivity(
  transfers: Transfer[],
  ramps: RampActivityItem[],
): UnifiedActivityRow[] {
  const rows: UnifiedActivityRow[] = [
    ...transfers.map((transfer) => ({
      kind: "transfer" as const,
      key: `transfer:${transfer.id ?? ""}`,
      createdAt: transfer.createdAt,
      transfer,
    })),
    ...ramps.map((ramp) => ({
      kind: "ramp" as const,
      key: `ramp:${ramp.id ?? ""}`,
      createdAt: ramp.createdAt,
      ramp,
    })),
  ];
  return rows.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
}

/**
 * Three bands - a failed movement never sits under a success header.
 * BLOCKED is a live hold, not a terminal, so it waits with In progress.
 */
export type UnifiedBand = "pending" | "completed" | "incomplete";

export const UNIFIED_BAND_LABELS: Record<UnifiedBand, string> = {
  pending: "In progress",
  completed: "Completed",
  incomplete: "Didn't complete",
};

const RAMP_PENDING = new Set(["AWAITING_APPROVAL", "AWAITING_FUNDS", "PROCESSING", "BLOCKED"]);

export function unifiedBand(row: UnifiedActivityRow): UnifiedBand {
  if (row.kind === "transfer") {
    if (row.transfer.status === "PENDING") return "pending";
    return row.transfer.status === "COMPLETED" ? "completed" : "incomplete";
  }
  const status = row.ramp.status ?? "";
  if (RAMP_PENDING.has(status)) return "pending";
  return status === "SUCCEEDED" ? "completed" : "incomplete";
}

/** Type label: which rail, said in the Move-money surface's own words. */
export function unifiedTypeLabel(row: UnifiedActivityRow, accountId?: string): string {
  if (row.kind === "ramp") return row.ramp.rampType === "OFF_RAMP" ? "Withdrawal" : "Add money";
  if (accountId && transferDirection(row.transfer, accountId) === "out") return "Transfer sent";
  return "Transfer received";
}

/**
 * Failed counts rejection as refusal (NAV vocabulary maps it negative,
 * the intent-twin of declined); a cancellation stays neutral and out.
 */
export function unifiedSummary(rows: UnifiedActivityRow[]): {
  all: number;
  pending: number;
  failed: number;
} {
  const failed = rows.filter((row) =>
    row.kind === "transfer"
      ? row.transfer.status === "FAILED"
      : ["FAILED", "DENIED", "REJECTED"].includes(row.ramp.status ?? ""),
  ).length;
  return {
    all: rows.length,
    pending: rows.filter((row) => unifiedBand(row) === "pending").length,
    failed,
  };
}

export type UnifiedTypeFilter = "all" | "transfers" | "withdrawals" | "add-money";

export function filterUnified(
  rows: UnifiedActivityRow[],
  type: UnifiedTypeFilter,
  scope: ActivityScope,
): UnifiedActivityRow[] {
  let out = rows;
  if (type === "transfers") out = out.filter((r) => r.kind === "transfer");
  if (type === "withdrawals") out = out.filter((r) => r.kind === "ramp" && r.ramp.rampType === "OFF_RAMP");
  if (type === "add-money") out = out.filter((r) => r.kind === "ramp" && r.ramp.rampType === "ON_RAMP");
  if (scope === "pending") out = out.filter((r) => unifiedBand(r) === "pending");
  if (scope === "failed") {
    out = out.filter((r) =>
      r.kind === "transfer"
        ? r.transfer.status === "FAILED"
        : ["FAILED", "DENIED", "REJECTED"].includes(r.ramp.status ?? ""),
    );
  }
  return out;
}

export type ClientActivityFilters = {
  query: string;
  dateFrom: string;
  dateTo: string;
  amountMin: string;
  amountMax: string;
};

export const EMPTY_ACTIVITY_FILTERS: ClientActivityFilters = {
  query: "",
  dateFrom: "",
  dateTo: "",
  amountMin: "",
  amountMax: "",
};

export function activityFiltersActive(filters: ClientActivityFilters): boolean {
  return Boolean(
    filters.query.trim() || filters.dateFrom || filters.dateTo || filters.amountMin || filters.amountMax,
  );
}

export function transferSearchHaystack(transfer: Transfer): string {
  return [transfer.id, transfer.description, transfer.merchantReference, transfer.senderAccountId, transfer.receiverAccountId]
    .filter((part): part is string => Boolean(part))
    .join(" ")
    .toLowerCase();
}

export function unifiedSearchHaystack(row: UnifiedActivityRow): string {
  if (row.kind === "transfer") return transferSearchHaystack(row.transfer);
  return [row.ramp.id, row.ramp.paymentReference, row.ramp.createdBy]
    .filter((part): part is string => Boolean(part))
    .join(" ")
    .toLowerCase();
}

export function parseAmountBound(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : undefined;
}

export function matchesDateRange(iso: string | undefined, from: string, to: string): boolean {
  if (!from && !to) return true;
  const day = iso?.slice(0, 10);
  if (!day) return false;
  if (from && day < from) return false;
  if (to && day > to) return false;
  return true;
}

export function matchesAmountRange(
  amount: number | undefined,
  min: number | undefined,
  max: number | undefined,
): boolean {
  if (min === undefined && max === undefined) return true;
  if (amount === undefined) return false;
  const abs = Math.abs(amount);
  if (min !== undefined && abs < min) return false;
  if (max !== undefined && abs > max) return false;
  return true;
}

export function filterByClientActivity<T>(
  rows: T[],
  filters: ClientActivityFilters,
  haystack: (row: T) => string,
  createdAt: (row: T) => string | undefined,
  amount: (row: T) => number | undefined,
): T[] {
  const query = filters.query.trim().toLowerCase();
  const min = parseAmountBound(filters.amountMin);
  const max = parseAmountBound(filters.amountMax);
  return rows.filter((row) => {
    if (query && !haystack(row).includes(query)) return false;
    if (!matchesDateRange(createdAt(row), filters.dateFrom, filters.dateTo)) return false;
    if (!matchesAmountRange(amount(row), min, max)) return false;
    return true;
  });
}

/** Filtered-from-fetched, and the client-side limit, in one sentence. */
export function activityFilterScopeSentence(shown: number, fetched: number, filtersOn: boolean): string {
  const base = `Showing ${shown} of ${fetched} loaded transaction${fetched === 1 ? "" : "s"}`;
  return filtersOn
    ? `${base}. Search, date and amount filters apply to the transactions currently loaded.`
    : `${base}.`;
}

const filterControlStyle = (active: boolean): CSSProperties => ({
  fontFamily: "var(--font-family)",
  fontSize: "var(--font-size-label)",
  color: active ? "var(--text-primary)" : "var(--text-secondary)",
  background: active ? "var(--selected-tint)" : "var(--surface-raised)",
  border: "var(--border-w-hairline) solid var(--border-hairline)",
  borderRadius: "var(--radius-control)",
  padding: "var(--space-2xs) var(--space-sm)",
});

export function ActivityFilterRow({
  filters,
  onChange,
  scopeSentence,
}: {
  filters: ClientActivityFilters;
  onChange: (next: ClientActivityFilters) => void;
  scopeSentence: string;
}): ReactElement {
  const set = (patch: Partial<ClientActivityFilters>): void => onChange({ ...filters, ...patch });
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: "var(--space-sm)",
        marginBottom: "var(--space-md)",
      }}
    >
      <input
        type="search"
        aria-label="Search activity"
        placeholder="Search counterparty, description, reference, id"
        value={filters.query}
        onChange={(event) => set({ query: event.target.value })}
        style={{ ...filterControlStyle(Boolean(filters.query.trim())), flex: "1 1 var(--card-max-width)" }}
      />
      <label
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "var(--space-2xs)",
          fontSize: "var(--font-size-label)",
          color: "var(--text-secondary)",
          fontFamily: "var(--font-family)",
        }}
      >
        From
        <input
          type="date"
          aria-label="From date"
          value={filters.dateFrom}
          onChange={(event) => set({ dateFrom: event.target.value })}
          style={filterControlStyle(Boolean(filters.dateFrom))}
        />
      </label>
      <label
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "var(--space-2xs)",
          fontSize: "var(--font-size-label)",
          color: "var(--text-secondary)",
          fontFamily: "var(--font-family)",
        }}
      >
        To
        <input
          type="date"
          aria-label="To date"
          value={filters.dateTo}
          onChange={(event) => set({ dateTo: event.target.value })}
          style={filterControlStyle(Boolean(filters.dateTo))}
        />
      </label>
      <label
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "var(--space-2xs)",
          fontSize: "var(--font-size-label)",
          color: "var(--text-secondary)",
          fontFamily: "var(--font-family)",
        }}
      >
        Min
        <input
          type="number"
          inputMode="decimal"
          aria-label="Minimum amount"
          value={filters.amountMin}
          onChange={(event) => set({ amountMin: event.target.value })}
          style={filterControlStyle(Boolean(filters.amountMin))}
        />
      </label>
      <label
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "var(--space-2xs)",
          fontSize: "var(--font-size-label)",
          color: "var(--text-secondary)",
          fontFamily: "var(--font-family)",
        }}
      >
        Max
        <input
          type="number"
          inputMode="decimal"
          aria-label="Maximum amount"
          value={filters.amountMax}
          onChange={(event) => set({ amountMax: event.target.value })}
          style={filterControlStyle(Boolean(filters.amountMax))}
        />
      </label>
      <p
        style={{
          flex: "1 0 100%",
          margin: 0,
          fontSize: "var(--font-size-label)",
          color: "var(--text-secondary)",
        }}
      >
        {scopeSentence}
      </p>
    </div>
  );
}

export function ActivityFilterEmpty({ onClear }: { onClear: () => void }): ReactElement {
  return (
    <p style={{ margin: 0, fontSize: "var(--font-size-body)", color: "var(--text-secondary)" }}>
      No transactions match these filters.{" "}
      <button
        type="button"
        onClick={onClear}
        style={{
          border: "none",
          background: "none",
          cursor: "pointer",
          color: "var(--text-primary)",
          fontSize: "var(--font-size-body)",
          fontFamily: "var(--font-family)",
          textDecoration: "underline",
          padding: 0,
        }}
      >
        Clear filters
      </button>
    </p>
  );
}

/**
 * Signed amount for the row's primary (crypto) figure. Direction is
 * carried by this sign + the Type label; the fiat side stays unsigned
 * because the list carries GROSS fiat, not the net the bank receives.
 * A pre-settlement Add money row stays unsigned - nothing has been
 * credited yet, and the band carries that meaning.
 */
export function rampSigned(ramp: RampActivityItem): { amount: number; signed: boolean } | undefined {
  if (ramp.cryptoAmount === undefined) return undefined;
  if (ramp.rampType === "OFF_RAMP") return { amount: -ramp.cryptoAmount, signed: true };
  if (ramp.status === "SUCCEEDED") return { amount: ramp.cryptoAmount, signed: true };
  return { amount: ramp.cryptoAmount, signed: false };
}

export function unifiedToCsv(rows: UnifiedActivityRow[], accountId?: string, accountName?: string): string {
  const header = "source,id,reference,type,date,scope,amount,currency,Converted amount,convertedCurrency,status";
  const lines = rows.map((row) => {
    if (row.kind === "transfer") {
      const t = row.transfer;
      return [
        "transfer",
        t.id,
        t.merchantReference,
        accountId ? `Transfer ${transferDirection(t, accountId) === "out" ? "sent" : "received"}` : "Transfer",
        t.createdAt,
        accountName ?? accountId,
        signedTransferAmount(t, accountId),
        t.asset,
        // Transfers carry no fiat leg - the columns stay honestly empty.
        "",
        "",
        t.status,
      ]
        .map(csvField)
        .join(",");
    }
    const r = row.ramp;
    return [
      "ramp",
      r.id,
      r.paymentReference,
      r.rampType === "OFF_RAMP" ? "Withdrawal" : "Add money",
      r.createdAt,
      "Company-wide",
      rampSigned(r)?.amount,
      r.cryptoCurrency,
      // Gross converted amount, as carried by the record; the net the bank
      // receives lives on the withdrawal detail.
      r.fiatAmount,
      r.fiatCurrency,
      r.status,
    ]
      .map(csvField)
      .join(",");
  });
  return [header, ...lines].join("\n");
}

export function unifiedColumns(accountId?: string, accountName?: string): DataTableColumn<UnifiedActivityRow>[] {
  return [
    {
      key: "what",
      header: "Activity",
      cell: (row) => {
        const label = unifiedTypeLabel(row, accountId);
        if (row.kind === "transfer") {
          const status = transferStatusIntent(row.transfer.status);
          return (
            <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-sm)" }}>
              <RowText
                primary={label}
                secondary={row.transfer.description ?? row.transfer.merchantReference ?? row.transfer.asset}
              />
              {status ? <StatusPill label={status.label} intent={status.intent} /> : null}
            </span>
          );
        }
        const pill = WITHDRAW_STATUS_PILL[row.ramp.status ?? ""];
        // Success stays quiet in the table (colour is a budget); every
        // other state carries its word.
        const quiet = row.ramp.status === "SUCCEEDED";
        return (
          <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-sm)" }}>
            <RowText primary={label} secondary={row.ramp.paymentReference} />
            {pill && !quiet ? <StatusPill label={pill.label} intent={pill.intent} /> : null}
          </span>
        );
      },
    },
    {
      key: "scope",
      header: "Scope",
      cell: (row) =>
        row.kind === "transfer" ? (accountName ?? "This account") : "Company-wide",
    },
    { key: "date", header: "Date", cell: (row) => row.createdAt?.slice(0, 10) },
    {
      key: "amount",
      header: "Amount",
      money: true,
      cell: (row) => {
        if (row.kind === "transfer") {
          const amount = signedTransferAmount(row.transfer, accountId);
          return amount === undefined ? null : <Money amount={amount} currency={row.transfer.asset} />;
        }
        const signed = rampSigned(row.ramp);
        return (
          <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-end", gap: "var(--space-3xs)" }}>
            {signed ? (
              <span style={{ display: "inline-flex", alignItems: "baseline" }}>
                {/* Settled credits carry an explicit +, symmetric with the − debits render. */}
                {signed.signed && signed.amount > 0 ? (
                  <span style={{ fontVariantNumeric: "tabular-nums" }}>+</span>
                ) : null}
                <Money amount={signed.amount} currency={row.ramp.cryptoCurrency} />
              </span>
            ) : null}
            {row.ramp.fiatAmount !== undefined ? (
              <span style={{ fontSize: "var(--font-size-label)", color: "var(--text-tertiary)", fontVariantNumeric: "tabular-nums" }}>
                {formatAmount(row.ramp.fiatAmount)} {row.ramp.fiatCurrency}
              </span>
            ) : null}
          </span>
        );
      },
    },
  ];
}

/** Ramp side panel: list-item fields only; the entity page owns the rest. */
export function RampActivityPanel({
  ramp,
  onClose,
  onOpenWithdrawal,
}: {
  ramp: RampActivityItem;
  onClose: () => void;
  /** OFF_RAMP only - Add money has no entity page yet. */
  onOpenWithdrawal?: (id: string) => void;
}): ReactElement {
  const descriptor = describeRampStatus(ramp.status);
  const signed = rampSigned(ramp);
  return (
    <SidePanel
      context={`${ramp.rampType === "OFF_RAMP" ? "Withdrawal" : "Add money"} · ${ramp.createdAt?.slice(0, 10) ?? ""}`}
      amount={signed?.amount}
      amountPrefix={signed && signed.signed && signed.amount > 0 ? "+" : undefined}
      currency={ramp.cryptoCurrency}
      qualifier={ramp.paymentReference}
      onClose={onClose}
    >
      {descriptor ? (
        <p style={{ margin: "0 0 var(--space-md)", fontSize: "var(--font-size-label)", color: "var(--text-secondary)" }}>
          {descriptor.explanation}
        </p>
      ) : null}
      <FieldList
        fields={[
          {
            label: "Converted amount",
            value:
              ramp.fiatAmount !== undefined
                ? `${formatAmount(ramp.fiatAmount)} ${ramp.fiatCurrency ?? ""}`
                : null,
            copyable: false,
            mono: true,
          },
          { label: "Reference", value: ramp.paymentReference ?? null, copyable: true, mono: true },
          { label: "Created by", value: ramp.createdBy ?? null, copyable: false },
          { label: "Created", value: ramp.createdAt ?? null, copyable: false, mono: true },
        ]}
      />
      {ramp.rampType === "OFF_RAMP" && onOpenWithdrawal && ramp.id ? (
        <button
          type="button"
          onClick={() => onOpenWithdrawal(ramp.id as string)}
          style={{
            marginTop: "var(--space-md)",
            border: "var(--border-w-hairline) solid var(--border-strong)",
            background: "var(--surface-raised)",
            color: "var(--text-primary)",
            borderRadius: "var(--radius-control)",
            padding: "var(--space-2xs) var(--space-md)",
            fontSize: "var(--font-size-label)",
            fontFamily: "var(--font-family)",
            cursor: "pointer",
          }}
        >
          View withdrawal
        </button>
      ) : null}
    </SidePanel>
  );
}

/** One feed over both ledgers - a withdrawal you just created is activity too. */
export function UnifiedActivityBlock({
  accountId,
  accountName,
  initialScope = "all",
  initialFilters = EMPTY_ACTIVITY_FILTERS,
  onOpenWithdrawal,
  style,
  className,
}: {
  accountId: string;
  /** Renders in the Scope column for transfer rows. */
  accountName?: string;
  initialScope?: ActivityScope;
  initialFilters?: ClientActivityFilters;
  /** Entity drill for OFF_RAMP panel rows, e.g. navigate to the withdrawal. */
  onOpenWithdrawal?: (id: string) => void;
  style?: CSSProperties;
  className?: string;
}): ReactElement {
  const transfersQuery = useTransfers(accountId);
  const rampsQuery = useRampRequests();
  const { data: transferData, isPending: transfersPending } = transfersQuery;
  const { data: rampData, isPending: rampsPending } = rampsQuery;
  const [scope, setScope] = useState<ActivityScope>(initialScope);
  const [typeFilter, setTypeFilter] = useState<UnifiedTypeFilter>("all");
  const [clientFilters, setClientFilters] = useState<ClientActivityFilters>(initialFilters);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);

  const all = useMemo(
    () => unifyActivity(transferData?.items ?? [], rampData?.items ?? []),
    [transferData, rampData],
  );
  const summary = useMemo(() => unifiedSummary(all), [all]);
  const typed = useMemo(() => filterUnified(all, typeFilter, scope), [all, typeFilter, scope]);
  const visible = useMemo(
    () =>
      filterByClientActivity(
        typed,
        clientFilters,
        unifiedSearchHaystack,
        (row) => row.createdAt,
        (row) =>
          row.kind === "transfer"
            ? signedTransferAmount(row.transfer, accountId)
            : rampSigned(row.ramp)?.amount,
      ),
    [typed, clientFilters, accountId],
  );
  const visibleOrdered = useMemo(() => {
    const order: UnifiedBand[] = ["pending", "completed", "incomplete"];
    return order.flatMap((band) => visible.filter((row) => unifiedBand(row) === band));
  }, [visible]);
  const steppableKeys = useMemo(
    () => visibleOrdered.filter((row) => !collapsedGroups[unifiedBand(row)]).map((row) => row.key),
    [visibleOrdered, collapsedGroups],
  );
  const selected =
    selectedKey && steppableKeys.includes(selectedKey)
      ? (visibleOrdered.find((row) => row.key === selectedKey) ?? null)
      : null;
  const clientOn = activityFiltersActive(clientFilters);
  const filtered = typeFilter !== "all" || scope !== "all" || clientOn;
  const scopeSentence = activityFilterScopeSentence(visible.length, all.length, clientOn);

  useEffect(() => {
    if (!selected) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (event.key === "Escape") {
        setSelectedKey(null);
      } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        setSelectedKey((current) =>
          stepSelection(steppableKeys, current, event.key === "ArrowDown" ? 1 : -1),
        );
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [selected, steppableKeys]);

  const groups: DataTableGroup<UnifiedActivityRow>[] = (
    ["pending", "completed", "incomplete"] as UnifiedBand[]
  ).map((band) => ({
    key: band,
    label: UNIFIED_BAND_LABELS[band],
    rows: visible.filter((row) => unifiedBand(row) === band),
    attention: band === "pending" && visible.some((row) => unifiedBand(row) === band),
  }));

  const toggleScope = (next: ActivityScope) => {
    setScope((current) => (current === next ? "all" : next));
  };

  if (transfersPending || rampsPending) {
    return (
      <section className={className} style={{ fontFamily: "var(--font-family)", ...style }}>
        <TableSkeleton columns={unifiedColumns()} label="Loading activity" />
      </section>
    );
  }

  // Either feed failing – transport error OR malformed envelope
  // (resultPresent === false) – fails the whole surface: a unified feed
  // missing one of its ledgers would still read as "all your activity".
  if (
    transfersQuery.isError ||
    rampsQuery.isError ||
    !transferData ||
    transferData.resultPresent === false ||
    !rampData ||
    rampData.resultPresent === false
  ) {
    return (
      <section className={className} style={{ fontFamily: "var(--font-family)", ...style }}>
        <ListLoadError
          what="your activity"
          onRetry={() => {
            void transfersQuery.refetch();
            void rampsQuery.refetch();
          }}
        />
      </section>
    );
  }

  return (
    <section className={className} style={{ fontFamily: "var(--font-family)", ...style }}>
      <div className="venly-toolbar" style={{ marginBottom: "var(--space-lg)" }}>
        <StatFigure label="Activity" value={summary.all} selected={scope === "all"} onClick={() => setScope("all")} />
        <StatFigure label="In progress" value={summary.pending} selected={scope === "pending"} onClick={() => toggleScope("pending")} />
        <StatFigure label="Failed" value={summary.failed} selected={scope === "failed"} onClick={() => toggleScope("failed")} />

        <div className="venly-toolbar-end">
          <select
            aria-label="Filter by type"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as UnifiedTypeFilter)}
            style={{
              fontFamily: "var(--font-family)",
              fontSize: "var(--font-size-label)",
              color: typeFilter !== "all" ? "var(--text-primary)" : "var(--text-secondary)",
              background: typeFilter !== "all" ? "var(--selected-tint)" : "var(--surface-raised)",
              border: "var(--border-w-hairline) solid var(--border-hairline)",
              borderRadius: "var(--radius-control)",
              padding: "var(--space-2xs) var(--space-sm)",
            }}
          >
            <option value="all">All types</option>
            <option value="transfers">Transfers</option>
            <option value="withdrawals">Withdrawals</option>
            <option value="add-money">Add money</option>
          </select>
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
                aria-label="Export activity"
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
                <p style={{ margin: "0 0 var(--space-md)", fontSize: "var(--font-size-label)", color: "var(--text-secondary)" }}>
                  Exports the {visible.length} transactions matching your current filters – this
                  account&rsquo;s transfers plus the company&rsquo;s withdrawals and Add money
                  transactions – out of {all.length}.
                </p>
                <div style={{ display: "flex", gap: "var(--space-sm)" }}>
                  <button
                    type="button"
                    onClick={() => {
                      triggerDownload("activity.csv", "text/csv", unifiedToCsv(visible, accountId, accountName));
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
                    CSV
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {all.length > 0 ? (
        <ActivityFilterRow filters={clientFilters} onChange={setClientFilters} scopeSentence={scopeSentence} />
      ) : null}

      {all.length === 0 ? (
        <p style={{ margin: 0, fontSize: "var(--font-size-body)", color: "var(--text-secondary)" }}>
          No activity yet. Transfers and withdrawals appear here as soon as they&rsquo;re created.
        </p>
      ) : visible.length === 0 ? (
        <ActivityFilterEmpty
          onClear={() => {
            setTypeFilter("all");
            setScope("all");
            setClientFilters(EMPTY_ACTIVITY_FILTERS);
          }}
        />
      ) : (
        <div className="venly-table-scroll">
          <DataTable
          columns={unifiedColumns(accountId, accountName)}
          rows={[]}
          groups={groups}
          collapsedGroups={collapsedGroups}
          onGroupToggle={(key, isCollapsed) => setCollapsedGroups((c) => ({ ...c, [key]: isCollapsed }))}
          rowKey={(row) => row.key}
          selectedKey={selected?.key}
          onRowClick={(row) => setSelectedKey(row.key)}
        />
        </div>
      )}

      {selected?.kind === "transfer" ? (
        <TransferDetailPanel
          transfer={selected.transfer}
          accountId={accountId}
          onClose={() => setSelectedKey(null)}
        />
      ) : null}
      {selected?.kind === "ramp" ? (
        <RampActivityPanel
          ramp={selected.ramp}
          onClose={() => setSelectedKey(null)}
          onOpenWithdrawal={onOpenWithdrawal}
        />
      ) : null}
    </section>
  );
}

/** Ledger + panel, bound to the account's transfers. */
export function ActivityBlock({
  accountId,
  initialScope = "all",
  initialFilters = EMPTY_ACTIVITY_FILTERS,
  style,
  className,
}: {
  accountId: string;
  /** Landing scope, e.g. "pending" when arriving from a reserved drill. */
  initialScope?: ActivityScope;
  initialFilters?: ClientActivityFilters;
  style?: CSSProperties;
  className?: string;
}): ReactElement {
  const transfersQuery = useTransfers(accountId);
  const { data, isPending } = transfersQuery;
  const [scope, setScope] = useState<ActivityScope>(initialScope);
  const [assetFilter, setAssetFilter] = useState<string | null>(null);
  const [clientFilters, setClientFilters] = useState<ClientActivityFilters>(initialFilters);
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
  const scoped = useMemo(() => scopeTransfers(assetFiltered, scope), [assetFiltered, scope]);
  const visible = useMemo(
    () =>
      filterByClientActivity(
        scoped,
        clientFilters,
        transferSearchHaystack,
        (t) => t.createdAt,
        (t) => signedTransferAmount(t, accountId),
      ),
    [scoped, clientFilters, accountId],
  );
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
  const clientOn = activityFiltersActive(clientFilters);
  const filtered = assetFilter !== null || scope !== "all" || clientOn;
  const scopeSentence = activityFilterScopeSentence(visible.length, all.length, clientOn);

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

  // A failed or malformed transfer list (resultPresent === false) is an
  // error state, never an empty ledger claiming "no activity".
  if (!isPending && (transfersQuery.isError || !data || data.resultPresent === false)) {
    return (
      <section className={className} style={{ fontFamily: "var(--font-family)", ...style }}>
        <ListLoadError what="your activity" onRetry={() => void transfersQuery.refetch()} />
      </section>
    );
  }

  return (
    <section className={className} style={{ fontFamily: "var(--font-family)", ...style }}>
      {isPending ? (
        <TableSkeleton columns={transferColumns()} label="Loading activity" />
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

          {all.length > 0 ? (
            <ActivityFilterRow filters={clientFilters} onChange={setClientFilters} scopeSentence={scopeSentence} />
          ) : null}

          {all.length === 0 ? (
            <p style={{ margin: 0, fontSize: "var(--font-size-body)", color: "var(--text-secondary)" }}>
              No activity yet.
            </p>
          ) : visible.length === 0 ? (
            <ActivityFilterEmpty
              onClear={() => {
                setScope("all");
                setAssetFilter(null);
                setClientFilters(EMPTY_ACTIVITY_FILTERS);
              }}
            />
          ) : (
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
          )}
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
