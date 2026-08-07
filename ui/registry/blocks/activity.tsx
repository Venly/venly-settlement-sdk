import { useState, type CSSProperties, type ReactElement } from "react";
import type { Transfer } from "@venlyfinance/sdk";
import { useTransfers } from "@venlyfinance/react";
import { Money } from "../lib/money.js";
import { DataTable, RowText, type DataTableColumn } from "../components/data-table.js";
import { StatusPill, type StatusIntent } from "../components/status-pill.js";
import { SidePanel } from "../components/side-panel.js";
import { Timeline, type TimelineStep } from "../components/timeline.js";

/**
 * Activity block – the ledger plus its detail panel.
 *
 * Design contract encoded by this block:
 * - Clicking a row opens the side panel; it never navigates. The source
 *   row stays tinted while the panel is open.
 * - Status renders as an inline pill after the primary label – zero column
 *   width, only on rows that need it (PENDING/FAILED; COMPLETED rows stay
 *   quiet because success is the default, not news).
 * - The failure explanation lives where the status is: the panel timeline's
 *   terminal node carries the error message.
 */

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

export function ActivityTable({
  transfers,
  selectedId,
  onSelect,
}: {
  transfers: Transfer[];
  selectedId?: string;
  onSelect?: (transfer: Transfer) => void;
}): ReactElement {
  const columns: DataTableColumn<Transfer>[] = [
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
      cell: (t) => (t.amount === undefined ? null : <Money amount={t.amount} currency={t.asset} />),
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={transfers}
      rowKey={(t) => t.id ?? ""}
      selectedKey={selectedId}
      onRowClick={onSelect}
      emptyMessage="No transfers yet"
    />
  );
}

export function TransferDetailPanel({
  transfer,
  onClose,
}: {
  transfer: Transfer;
  onClose: () => void;
}): ReactElement {
  return (
    <SidePanel
      context={`Transfer · ${transfer.createdAt?.slice(0, 10) ?? ""}`}
      amount={transfer.amount}
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

/** Ledger + panel, bound to the account's transfers. */
export function ActivityBlock({
  accountId,
  style,
  className,
}: {
  accountId: string;
  style?: CSSProperties;
  className?: string;
}): ReactElement {
  const { data, isPending } = useTransfers(accountId);
  const [selected, setSelected] = useState<Transfer | null>(null);

  return (
    <section className={className} style={{ fontFamily: "var(--font-family)", ...style }}>
      {isPending ? (
        <p style={{ color: "var(--text-tertiary)" }}>Loading activity…</p>
      ) : (
        <ActivityTable
          transfers={data?.items ?? []}
          selectedId={selected?.id}
          onSelect={setSelected}
        />
      )}
      {selected ? (
        <TransferDetailPanel transfer={selected} onClose={() => setSelected(null)} />
      ) : null}
    </section>
  );
}
