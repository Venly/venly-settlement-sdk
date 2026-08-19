import type { CSSProperties, ReactElement } from "react";
import type { SupportedAsset, WalletBalance } from "@venlyfinance/sdk";
import { useSupportedAssets, useWallets } from "@venlyfinance/react";
import { Money, MASK, formatAmount } from "../lib/money.js";
import { BalanceCard } from "../components/balance-card.js";
import { DataTable, RowText, type DataTableColumn } from "../components/data-table.js";

/**
 * Balances block – the home surface, wired to the wallet balance source.
 *
 * Design contract encoded by this block:
 * - The figures come from the API's wallet balances (total / available /
 *   reserved per asset), never from literals. The hero is `available` –
 *   the figure the Send button spends; `total` is demoted below the rule.
 * - The segmented bar renders only at two or more non-zero buckets: a
 *   100%-wide single band implies a split that isn't there.
 * - Masking covers EVERYTHING – hero, buckets, and every table row. A
 *   masked hero beside visible per-asset rows leaks what masking hides.
 * - Reserved rows render an em-dash at zero: `0.00` in every cell buries
 *   the one real reservation.
 * - The reserved bucket drills through to the records causing it.
 * - The available figure echoes into the chrome via BalanceMiniature –
 *   the persistent miniature is part of this component's contract.
 */

export interface AssetBalanceRow {
  asset: string;
  /** Chains this asset sits on, for the secondary row line. */
  chains: string[];
  total: number;
  available: number;
  reserved: number;
  /** Render precision: the asset's on-chain decimals, or 2 when unresolved. */
  decimals: number;
  /** Where `decimals` came from – rendered as provenance, never implied. */
  decimalsSource: "supported-assets" | "default";
}

/**
 * Resolve an asset's render precision from the supported-assets rows: by
 * contract address first (the unambiguous key), then by currency symbol.
 * Unresolved assets fall back to 2dp – and say so via `decimalsSource`.
 */
export function assetDecimals(
  balance: Pick<WalletBalance, "asset" | "contractAddress">,
  supportedAssets: SupportedAsset[] | undefined,
): { decimals: number; source: AssetBalanceRow["decimalsSource"] } {
  const match =
    supportedAssets?.find(
      (a) =>
        a.contractAddress != null &&
        balance.contractAddress != null &&
        a.contractAddress.toLowerCase() === balance.contractAddress.toLowerCase(),
    ) ?? supportedAssets?.find((a) => a.cryptoCurrency === balance.asset);
  return typeof match?.decimals === "number"
    ? { decimals: match.decimals, source: "supported-assets" }
    : { decimals: 2, source: "default" };
}

/**
 * Aggregates balance rows per asset, sorted by available descending so
 * magnitudes stack. Contract 1.3.0: listWallets returns per-asset balance
 * rows (amounts as numbers) and no longer names the wallet's chain, so the
 * chain chips render only when the API someday says which chain a balance
 * lives on - a labelled gap, never an invented value.
 *
 * Each row carries the asset's on-chain `decimals` (from supported-assets)
 * so sub-cent amounts render instead of rounding to 0.00.
 */
export function assetBalanceRows(
  wallets: WalletBalance[],
  supportedAssets?: SupportedAsset[],
): AssetBalanceRow[] {
  const byAsset = new Map<string, AssetBalanceRow>();
  for (const balance of wallets) {
    if (!balance.asset) continue;
    const precision = assetDecimals(balance, supportedAssets);
    const row = byAsset.get(balance.asset) ?? {
      asset: balance.asset,
      chains: [],
      total: 0,
      available: 0,
      reserved: 0,
      decimals: precision.decimals,
      decimalsSource: precision.source,
    };
    row.total += Number(balance.amount?.total ?? 0);
    row.available += Number(balance.amount?.available ?? 0);
    row.reserved += Number(balance.amount?.reserved ?? 0);
    byAsset.set(balance.asset, row);
  }
  return [...byAsset.values()].sort((a, b) => b.available - a.available);
}

/**
 * The provenance line under the table: where the render precision came
 * from. Precision is a claim about money, so its source is stated rather
 * than implied – including the fallback, which would otherwise silently
 * reintroduce the 0.00 defect for the assets it covers.
 */
export function precisionProvenance(rows: AssetBalanceRow[]): string | null {
  if (rows.length === 0) return null;
  const fallback = rows.filter((r) => r.decimalsSource === "default").map((r) => r.asset);
  if (fallback.length === 0) {
    return "Amounts shown at each asset's on-chain precision (from supported-assets).";
  }
  if (fallback.length === rows.length) {
    return "Shown at 2 decimals – on-chain precision is unavailable right now. Sub-cent amounts may display as 0.00.";
  }
  return `Amounts shown at each asset's on-chain precision (from supported-assets), except ${fallback.join(
    ", ",
  )} at 2 decimals – precision unavailable. Sub-cent amounts there may display as 0.00.`;
}

/**
 * Rows whose own figures don't reconcile (total ≠ available + reserved,
 * beyond float noise on 6-decimal amounts). The surface SHOWS the API's
 * numbers unchanged and says they don't add up – it never "corrects" money.
 */
export function arithmeticMismatches(rows: AssetBalanceRow[]): string[] {
  return rows
    .filter((r) => Math.abs(r.total - (r.available + r.reserved)) > 0.000001)
    .map((r) => r.asset);
}

/** The bar renders only when a split actually exists. */
export function segmentedBarBuckets(row: AssetBalanceRow): { label: string; amount: number }[] {
  const buckets = [
    { label: "Available", amount: row.available },
    { label: "Reserved", amount: row.reserved },
  ].filter((b) => b.amount > 0);
  return buckets.length >= 2 ? buckets : [];
}

function SegmentedBar({ row, masked }: { row: AssetBalanceRow; masked: boolean }): ReactElement | null {
  const buckets = segmentedBarBuckets(row);
  if (buckets.length === 0) return null;
  const sum = buckets.reduce((acc, b) => acc + b.amount, 0);
  return (
    <div
      role="img"
      // Masking is surface-wide: the accessible name must not leak the
      // figures the visible surface just hid.
      aria-label={
        masked
          ? "Available and reserved split (amounts hidden)"
          : buckets.map((b) => `${b.label} ${formatAmount(b.amount, 2, row.decimals)}`).join(", ")
      }
      style={{
        display: "flex",
        gap: "var(--space-3xs)",
        height: "var(--bar-height)",
        borderRadius: "var(--radius-pill)",
        overflow: "hidden",
        marginTop: "var(--space-md)",
        maxWidth: "var(--card-max-width)",
      }}
    >
      {buckets.map((b) => (
        <div
          key={b.label}
          style={{
            flex: b.amount / sum,
            background: b.label === "Available" ? "var(--accent)" : "var(--state-neutral-bg)",
            border:
              b.label === "Available"
                ? undefined
                : "var(--border-w-hairline) solid var(--border-hairline)",
          }}
        />
      ))}
    </div>
  );
}

export interface BalancesViewProps {
  rows: AssetBalanceRow[];
  /** Asset whose composition leads. Defaults to the largest available. */
  primaryAsset?: string;
  /** Qualifier line under the hero, e.g. the account name. */
  qualifier?: string;
  masked?: boolean;
  onToggleMasked?: () => void;
  /** Drill-through from the reserved bucket to the causing records. */
  onReservedDrill?: () => void;
  style?: CSSProperties;
  className?: string;
}

/** Presentational half: everything below the data fetch. */
export function BalancesView({
  rows,
  primaryAsset,
  qualifier,
  masked = false,
  onToggleMasked,
  onReservedDrill,
  style,
  className,
}: BalancesViewProps): ReactElement {
  const primary = rows.find((r) => r.asset === primaryAsset) ?? rows[0];

  if (!primary) {
    return (
      <section className={className} style={{ fontFamily: "var(--font-family)", ...style }}>
        <p style={{ color: "var(--text-secondary)", fontSize: "var(--font-size-body)" }}>
          No balances yet. Funds arriving on your account details will appear here.
        </p>
      </section>
    );
  }

  const columns: DataTableColumn<AssetBalanceRow>[] = [
    {
      key: "asset",
      header: "Asset",
      cell: (r) => <RowText primary={r.asset} secondary={r.chains.join(" · ")} />,
    },
    {
      key: "total",
      header: "Total",
      money: true,
      cell: (r) => (
        <Money
          amount={r.total}
          maxFractionDigits={r.decimals}
          masked={masked}
          style={{ fontWeight: 400, color: "var(--text-secondary)" }}
        />
      ),
    },
    {
      key: "reserved",
      header: "Reserved",
      money: true,
      // Zero reserves render the em-dash: an empty column of 0.00 buries
      // the one row that actually has money locked up.
      cell: (r) => (
        <Money
          amount={r.reserved > 0 ? r.reserved : null}
          maxFractionDigits={r.decimals}
          masked={masked}
          style={{ fontWeight: 400 }}
        />
      ),
    },
    {
      key: "available",
      header: "Available",
      money: true,
      cell: (r) => (
        <Money amount={r.available} currency={r.asset} maxFractionDigits={r.decimals} masked={masked} />
      ),
    },
  ];

  return (
    <section className={className} style={{ fontFamily: "var(--font-family)", ...style }}>
      <BalanceCard
        available={primary.available}
        currency={primary.asset}
        decimals={primary.decimals}
        qualifier={qualifier}
        masked={masked}
        onToggleMasked={onToggleMasked}
        buckets={[
          { label: "Total", amount: primary.total },
          {
            label: "Reserved for in-flight transfers",
            amount: primary.reserved,
            locked: true,
            onDrill: primary.reserved > 0 ? onReservedDrill : undefined,
          },
        ]}
      />
      <SegmentedBar row={primary} masked={masked} />
      {primary.reserved > 0 ? (
        // Architecture honesty: a reservation is not money gone. Say so.
        <p
          style={{
            margin: "var(--space-md) 0 0",
            maxWidth: "var(--card-max-width)",
            fontSize: "var(--font-size-micro)",
            color: "var(--text-tertiary)",
          }}
        >
          Reserved funds are still yours – they're held for transfers in flight and release
          when those settle or fail.
        </p>
      ) : null}
      {arithmeticMismatches(rows).length > 0 ? (
        <p
          role="status"
          style={{
            margin: "var(--space-md) 0 0",
            fontSize: "var(--font-size-label)",
            color: "var(--state-pending-fg)",
          }}
        >
          The figures for {arithmeticMismatches(rows).join(", ")} don't add up (total ≠
          available + reserved). Showing the numbers as reported, unchanged.
        </p>
      ) : null}
      {rows.length > 0 ? (
        <div
          style={{
            marginTop: "var(--space-2xl)",
            background: "var(--surface-raised)",
            border: "var(--border-w-hairline) solid var(--border-hairline)",
            borderRadius: "var(--radius-card)",
            overflowX: "auto",
          }}
          className="venly-table-scroll"
        >
          <DataTable columns={columns} rows={rows} rowKey={(r) => r.asset} />
        </div>
      ) : null}
      {precisionProvenance(rows) ? (
        <p
          style={{
            margin: "var(--space-sm) 0 0",
            maxWidth: "var(--card-max-width)",
            fontSize: "var(--font-size-micro)",
            color: "var(--text-tertiary)",
          }}
        >
          {precisionProvenance(rows)}
        </p>
      ) : null}
    </section>
  );
}

/** Connected block: wallet balances for the account, live from the client. */
export function BalancesBlock({
  accountId,
  primaryAsset,
  qualifier,
  masked,
  onToggleMasked,
  onReservedDrill,
  style,
  className,
}: Omit<BalancesViewProps, "rows"> & { accountId: string }): ReactElement {
  const { data, isPending, isError, refetch } = useWallets(accountId);
  // Render precision. Its failure must not take the balance surface down:
  // rows fall back to 2dp and the provenance line says so.
  const assetsQuery = useSupportedAssets();

  if (isPending) {
    return (
      <section className={className} style={{ fontFamily: "var(--font-family)", ...style }}>
        <p style={{ color: "var(--text-tertiary)", fontSize: "var(--font-size-body)" }}>Loading balances…</p>
      </section>
    );
  }

  // A transport failure and a malformed envelope (resultPresent === false)
  // land in the same place: an empty balance list is a claim – "you hold
  // nothing" – that neither state can support.
  if (isError || !data || data.resultPresent === false) {
    return (
      <section className={className} style={{ fontFamily: "var(--font-family)", ...style }}>
        <p style={{ color: "var(--text-secondary)", fontSize: "var(--font-size-body)", margin: 0 }}>
          Balances couldn't load. The rest of the app still works – your money is unaffected
          by a display error.
        </p>
        <button
          type="button"
          onClick={() => void refetch()}
          style={{
            marginTop: "var(--space-md)",
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
          Try again
        </button>
      </section>
    );
  }

  const supportedAssets =
    assetsQuery.data?.resultPresent === false ? undefined : assetsQuery.data?.items;

  return (
    <BalancesView
      rows={assetBalanceRows(data.items ?? [], supportedAssets)}
      primaryAsset={primaryAsset}
      qualifier={qualifier}
      masked={masked}
      onToggleMasked={onToggleMasked}
      onReservedDrill={onReservedDrill}
      style={style}
      className={className}
    />
  );
}

/**
 * Persistent miniature – the primary available figure echoed in the chrome
 * (sidebar or top bar). Shares the surface's masked state: a masked hero
 * beside a visible miniature would leak the number the user just hid.
 */
export function BalanceMiniature({
  accountId,
  primaryAsset,
  masked = false,
  style,
  className,
}: {
  accountId: string;
  primaryAsset?: string;
  masked?: boolean;
  style?: CSSProperties;
  className?: string;
}): ReactElement | null {
  const { data } = useWallets(accountId);
  const assetsQuery = useSupportedAssets();
  const supportedAssets =
    assetsQuery.data?.resultPresent === false ? undefined : assetsQuery.data?.items;
  const rows = assetBalanceRows(data?.items ?? [], supportedAssets);
  const primary = rows.find((r) => r.asset === primaryAsset) ?? rows[0];
  if (!primary) return null;

  return (
    <div
      className={className}
      style={{
        fontFamily: "var(--font-family)",
        fontSize: "var(--font-size-micro)",
        color: "var(--text-secondary)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-3xs)",
        ...style,
      }}
    >
      <span style={{ color: "var(--text-tertiary)" }}>Available</span>
      <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 500, color: "var(--text-primary)" }}>
        {masked ? MASK : formatAmount(primary.available, 2, primary.decimals)}{" "}
        <span style={{ color: "var(--text-secondary)", fontWeight: 400 }}>{primary.asset}</span>
      </span>
    </div>
  );
}
