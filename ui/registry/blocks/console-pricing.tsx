import { useMemo, type CSSProperties, type ReactElement } from "react";
import type { Fee } from "@venlyfinance/sdk";
import {
  DataTable,
  TableSkeleton,
  type DataTableColumn,
} from "../components/data-table.js";
import { ListLoadError } from "../components/list-error.js";
import { ArithmeticLadder } from "../components/arithmetic-ladder.js";
import { FieldList, type FieldRow } from "../components/field-list.js";
import { formatAmount } from "../lib/money.js";

/**
 * Console pricing – the fee model, made legible.
 *
 * Design contract encoded by this block:
 * - The pricing data the packages actually serve is a VOLUME-TIER model
 *   (tier name, ramp direction, min/max volume, percentage, version) read
 *   over `GET /v1/fees` – the same model the shipped withdrawal quote
 *   consumes, so this screen shows where a real quote comes from.
 * - That read is GET-only. `FeePanel` is therefore a READ-ONLY detail
 *   (renamed from FeeConfigForm): it renders fields, never inputs, and
 *   nothing on this screen pretends to write.
 * - A worked arithmetic ladder is mandatory: sample amount × tier
 *   percentage = fee, operator glyphs in the gutter, computed against the
 *   tier the sample actually lands in – and that tier is highlighted in
 *   the table, so the row and the ladder are visibly the same fact.
 * - The ladder renders ONLY over data that exists. The richer per-rail
 *   platform configuration model lives on an internal plane; it renders as
 *   a labelled omission (copy in PRICING_COPY) and never as an empty form,
 *   and it gets no ladder – arithmetic over absent numbers is invented.
 * - Volumes and percentages render verbatim; no currency code is attached
 *   to a volume bound, because the fee model does not declare one.
 */

// ─── User-facing copy ────────────────────────────────────────────────────────

export const PRICING_COPY = {
  tiersTitle: "Ramp fee tiers",
  tiersBody:
    "Volume tiers served by the fees read. The withdrawal quote on the consumer surface is computed from this same model.",
  emptyHeadline: "No fee tiers",
  emptyBody: "Tiers appear here once Venly configures pricing for your tenant.",
  ladderTitle: "Worked example",
  sampleLabel: "Sample amount",
  ladderTotal: "Fee on this sample",
  landsHere: "sample lands here",
  noLandingTier:
    "The sample amount falls outside every tier's volume bounds, so there is no fee row to work through.",
  omissionTitle: "Platform fee configuration",
  /**
   * The labelled omission for the internal per-rail configuration model.
   * Names the next step, never only the absence; describes the split-fee
   * structure in words, never as figures.
   */
  omissionCopy:
    "Per-rail platform fee configuration – including the Venly and tenant fee split, fixed and percentage parts, minimum and maximum totals, and effective windows – is managed by Venly for your tenant and is not exposed on this API. Contact your account manager to change it.",
} as const;

const DIRECTION_LABEL: Record<string, string> = {
  ON_RAMP: "On-ramp",
  OFF_RAMP: "Off-ramp",
};

function directionLabel(type: string | undefined): string {
  return (type && DIRECTION_LABEL[type]) || type || "—";
}

/** Percentage rendered verbatim; the model stores a percentage, not a rate. */
function percentageLabel(fee: Fee): string {
  return `${fee.percentage}%`;
}

// ─── Landing-tier derivation (pure) ─────────────────────────────────────────

/**
 * The tier a sample amount lands in: minVolume ≤ amount, and amount below
 * maxVolume when a bound exists. Evaluated per ramp direction – a sample
 * lands once per direction, not once per table.
 */
export function landingTier(fees: Fee[], sampleAmount: number, type?: string): Fee | undefined {
  return fees
    .filter((fee) => (type === undefined ? true : fee.type === type))
    .filter(
      (fee) =>
        (fee.minVolume ?? 0) <= sampleAmount &&
        (fee.maxVolume === undefined || sampleAmount < fee.maxVolume),
    )
    .sort((a, b) => (a.minVolume ?? 0) - (b.minVolume ?? 0))[0];
}

// ─── The tier table ──────────────────────────────────────────────────────────

export interface ConsolePricingTableProps {
  fees: Fee[];
  loading?: boolean;
  /** `resultPresent === false` on the fees read. */
  loadFailed?: boolean;
  onRetry?: () => void;
  /** Sample amount driving the highlight + the ladder beside this table. */
  sampleAmount?: number;
  onSelect?: (fee: Fee) => void;
  selectedId?: string;
  style?: CSSProperties;
  className?: string;
}

export function ConsolePricingTable({
  fees,
  loading,
  loadFailed,
  onRetry,
  sampleAmount,
  onSelect,
  selectedId,
  style,
  className,
}: ConsolePricingTableProps): ReactElement {
  const ordered = useMemo(
    () =>
      [...fees].sort(
        (a, b) =>
          (a.type ?? "").localeCompare(b.type ?? "") ||
          (a.minVolume ?? 0) - (b.minVolume ?? 0),
      ),
    [fees],
  );
  const landingIds = useMemo(() => {
    if (sampleAmount === undefined) return new Set<string>();
    const perDirection = [...new Set(ordered.map((f) => f.type))].map(
      (type) => landingTier(ordered, sampleAmount, type)?.id,
    );
    return new Set(perDirection.filter((id): id is string => Boolean(id)));
  }, [ordered, sampleAmount]);

  const columns: DataTableColumn<Fee>[] = [
    {
      key: "name",
      header: "Tier",
      cell: (fee) => (
        <span style={{ fontWeight: landingIds.has(fee.id ?? "") ? 600 : 400 }}>
          {fee.name}
          {landingIds.has(fee.id ?? "") && (
            <span
              style={{
                marginLeft: "var(--space-sm)",
                fontSize: "var(--font-size-micro)",
                color: "var(--text-secondary)",
              }}
            >
              ◂ {PRICING_COPY.landsHere}
            </span>
          )}
        </span>
      ),
    },
    { key: "type", header: "Direction", cell: (fee) => directionLabel(fee.type) },
    {
      key: "minVolume",
      header: "Min volume",
      money: true,
      cell: (fee) => (fee.minVolume === undefined ? undefined : formatAmount(fee.minVolume, 0)),
    },
    {
      key: "maxVolume",
      header: "Max volume",
      money: true,
      cell: (fee) => (fee.maxVolume === undefined ? undefined : formatAmount(fee.maxVolume, 0)),
    },
    { key: "percentage", header: "Percentage", align: "right", cell: percentageLabel },
  ];

  if (loading) {
    return <TableSkeleton columns={columns} label="Loading fee tiers" style={style} />;
  }
  if (loadFailed) {
    return <ListLoadError what="fee tiers" onRetry={onRetry} />;
  }
  return (
    <div className={className} style={{ overflowX: "auto", ...style }}>
      <DataTable
        columns={columns}
        rows={ordered}
        rowKey={(fee) => fee.id ?? `${fee.name}-${fee.minVolume}`}
        onRowClick={onSelect}
        selectedKey={selectedId}
        emptyMessage={PRICING_COPY.emptyHeadline}
        style={{
          minWidth: 560,
          // The landing tier is highlighted via the selected mechanism only
          // when the caller has not selected another row; the inline marker
          // above keeps the fact visible either way.
        }}
      />
    </div>
  );
}

// ─── The mandatory worked ladder ─────────────────────────────────────────────

export interface FeeLadderProps {
  /** The tier the sample amount lands in (see `landingTier`). */
  fee: Fee | undefined;
  sampleAmount: number;
  style?: CSSProperties;
  className?: string;
}

/**
 * `amount × tier percentage = fee`, literal operators in the gutter. Renders
 * only over a tier that exists; without a landing tier it states that fact
 * instead of inventing arithmetic.
 */
export function FeeLadder({ fee, sampleAmount, style, className }: FeeLadderProps): ReactElement {
  if (!fee || fee.percentage === undefined) {
    return (
      <p
        className={className}
        style={{
          margin: 0,
          fontSize: "var(--font-size-label)",
          color: "var(--text-secondary)",
          ...style,
        }}
      >
        {PRICING_COPY.noLandingTier}
      </p>
    );
  }
  const feeAmount = (sampleAmount * fee.percentage) / 100;
  return (
    <ArithmeticLadder
      className={className}
      style={style}
      input={{ label: PRICING_COPY.sampleLabel, amount: sampleAmount }}
      rows={[
        {
          operator: "×",
          label: `Tier percentage (${fee.name ?? "tier"})`,
          value: percentageLabel(fee),
        },
      ]}
      total={{ label: PRICING_COPY.ladderTotal, amount: feeAmount }}
    />
  );
}

// ─── Read-only tier detail (renamed from FeeConfigForm – the read is GET-only) ─

export interface FeePanelProps {
  fee: Fee;
  style?: CSSProperties;
  className?: string;
}

/**
 * Read-only detail for one tier. The fees operation is GET-only, so this
 * panel renders fields and nothing else – an editable form here would
 * pretend at a write the API does not carry.
 */
export function FeePanel({ fee, style, className }: FeePanelProps): ReactElement {
  const fields: FieldRow[] = [
    { label: "Tier", value: fee.name, copyable: false },
    { label: "Direction", value: directionLabel(fee.type), copyable: false },
    {
      label: "Min volume",
      value: fee.minVolume === undefined ? undefined : formatAmount(fee.minVolume, 0),
      copyable: false,
      mono: true,
    },
    {
      label: "Max volume",
      value: fee.maxVolume === undefined ? undefined : formatAmount(fee.maxVolume, 0),
      copyable: false,
      mono: true,
    },
    { label: "Percentage", value: percentageLabel(fee), copyable: false, mono: true },
    {
      label: "Version",
      value: fee.version === undefined ? undefined : String(fee.version),
      copyable: false,
      mono: true,
    },
  ];
  return <FieldList fields={fields} style={style} className={className} />;
}
