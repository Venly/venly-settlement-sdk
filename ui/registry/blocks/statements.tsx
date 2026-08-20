import { useMemo, useState, type CSSProperties, type ReactElement } from "react";
import type { SupportedAsset, Transfer, VirtualBankAccount, WalletBalance } from "@venlyfinance/sdk";
import {
  useRampRequests,
  useSupportedAssets,
  useTransfers,
  useVirtualBankAccounts,
  useWallets,
} from "@venlyfinance/react";
import { FieldList } from "../components/field-list.js";
import { ListLoadError } from "../components/list-error.js";
import {
  DataTable,
  RowText,
  TableSkeleton,
  type DataTableColumn,
} from "../components/data-table.js";
import { Money, formatAmount, formatStamp } from "../lib/money.js";
import {
  rampSigned,
  signedTransferAmount,
  unifyActivity,
  unifiedTypeLabel,
  type RampActivityItem,
  type UnifiedActivityRow,
} from "./activity.js";
function assetDecimals(
  asset: string,
  supportedAssets: SupportedAsset[] | undefined,
): { decimals: number; source: "supported-assets" | "default" } {
  const match = supportedAssets?.find((a) => a.cryptoCurrency === asset);
  return typeof match?.decimals === "number"
    ? { decimals: match.decimals, source: "supported-assets" }
    : { decimals: 2, source: "default" };
}

/**
 * Statements block – a fixed-period document, not a filtered CSV.
 *
 * Opening and closing are walked from the current wallet total using this
 * account's completed transfers. Company-wide ramps appear as rows but do
 * not move the running balance (the ramp list has no account linkage).
 * Pay-in sessions are not in this feed: the document says so.
 */

export const STATEMENT_COVERAGE =
  "This statement covers this account's transfers and the company's withdrawals and add-money requests from the pages already loaded. Pay-in sessions are not included.";

export const STATEMENT_BALANCE_NOTE =
  "Opening and closing are derived from this account's completed transfers, walked from the current wallet total. Company-wide payouts do not move this account's running balance.";

export type StatementPeriod = {
  kind: "month" | "custom";
  year?: number;
  month?: number;
  start: string;
  end: string;
  label: string;
};

export type StatementIdentity = {
  partyName?: string;
  accountId: string;
  iban?: string;
  bic?: string;
  beneficiaryName?: string;
};

export type StatementLine = {
  key: string;
  createdAt?: string;
  kind: "transfer" | "ramp";
  label: string;
  detail?: string;
  asset?: string;
  signedAmount?: number;
  countsTowardBalance: boolean;
};

export type DerivedBalances = {
  opening?: number;
  closing?: number;
  omitted?: string;
};

export function lastCompleteMonth(now: Date): { year: number; month: number } {
  const utcMonth = now.getUTCMonth();
  if (utcMonth === 0) return { year: now.getUTCFullYear() - 1, month: 12 };
  return { year: now.getUTCFullYear(), month: utcMonth };
}

export function monthPeriod(year: number, month: number): StatementPeriod {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const mm = String(month).padStart(2, "0");
  const dd = String(lastDay).padStart(2, "0");
  const label = new Date(Date.UTC(year, month - 1, 1)).toLocaleString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  return {
    kind: "month",
    year,
    month,
    start: `${year}-${mm}-01T00:00:00.000Z`,
    end: `${year}-${mm}-${dd}T23:59:59.999Z`,
    label,
  };
}

export function customPeriod(from: string, to: string): StatementPeriod | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return null;
  if (from > to) return null;
  return {
    kind: "custom",
    start: `${from}T00:00:00.000Z`,
    end: `${to}T23:59:59.999Z`,
    label: `${from} – ${to}`,
  };
}

export function recentCompleteMonths(now: Date, count = 12): { year: number; month: number }[] {
  const last = lastCompleteMonth(now);
  const out: { year: number; month: number }[] = [];
  let year = last.year;
  let month = last.month;
  for (let i = 0; i < count; i += 1) {
    out.push({ year, month });
    month -= 1;
    if (month === 0) {
      month = 12;
      year -= 1;
    }
  }
  return out;
}

export function inPeriod(iso: string | undefined, start: string, end: string): boolean {
  if (!iso) return false;
  return iso >= start && iso <= end;
}

export function statementIdentity(accountId: string, vbas: VirtualBankAccount[]): StatementIdentity {
  const active = vbas.find((v) => v.status === "ACTIVE" && (v.iban || v.bic || v.beneficiaryName));
  const chosen = active ?? vbas[0];
  const partyName = chosen?.beneficiaryName;
  return {
    accountId,
    ...(partyName ? { partyName, beneficiaryName: partyName } : {}),
    ...(chosen?.iban ? { iban: chosen.iban } : {}),
    ...(chosen?.bic ? { bic: chosen.bic } : {}),
  };
}

export function walletTotalForAsset(wallets: WalletBalance[], asset: string): number | undefined {
  const rows = wallets.filter((w) => w.asset === asset);
  if (rows.length === 0) return undefined;
  return rows.reduce((sum, w) => sum + Number(w.amount?.total ?? 0), 0);
}

/**
 * Walk current wallet total backwards through completed transfers.
 * Pending and failed rows do not move the ledger. Missing amounts omit.
 */
export function deriveOpeningClosing(input: {
  currentTotal?: number;
  transfers: Transfer[];
  accountId: string;
  asset: string;
  periodStart: string;
  periodEnd: string;
}): DerivedBalances {
  if (input.currentTotal === undefined) {
    return { omitted: "No wallet total for this asset – opening and closing are not shown." };
  }
  let after = 0;
  let inRange = 0;
  for (const transfer of input.transfers) {
    if (transfer.status !== "COMPLETED") continue;
    if (transfer.asset !== input.asset) continue;
    const signed = signedTransferAmount(transfer, input.accountId);
    if (signed === undefined) {
      return { omitted: "A completed transfer in the loaded pages has no amount – opening and closing are not shown." };
    }
    const at = transfer.createdAt;
    if (!at) {
      return { omitted: "A completed transfer in the loaded pages has no timestamp – opening and closing are not shown." };
    }
    if (at > input.periodEnd) after += signed;
    else if (inPeriod(at, input.periodStart, input.periodEnd)) inRange += signed;
  }
  const closing = input.currentTotal - after;
  const opening = closing - inRange;
  return { opening, closing };
}

export function statementLines(
  rows: UnifiedActivityRow[],
  accountId: string,
  asset: string,
  period: StatementPeriod,
): StatementLine[] {
  const lines: StatementLine[] = [];
  for (const row of rows) {
    if (!inPeriod(row.createdAt, period.start, period.end)) continue;
    if (row.kind === "transfer") {
      if (row.transfer.asset !== asset) continue;
      lines.push({
        key: row.key,
        createdAt: row.createdAt,
        kind: "transfer",
        label: unifiedTypeLabel(row, accountId),
        detail: row.transfer.description ?? row.transfer.merchantReference,
        asset: row.transfer.asset,
        signedAmount: signedTransferAmount(row.transfer, accountId),
        countsTowardBalance: row.transfer.status === "COMPLETED" && signedTransferAmount(row.transfer, accountId) !== undefined,
      });
    } else {
      if (row.ramp.cryptoCurrency !== asset) continue;
      lines.push({
        key: row.key,
        createdAt: row.createdAt,
        kind: "ramp",
        label: unifiedTypeLabel(row, accountId),
        detail: row.ramp.paymentReference,
        asset: row.ramp.cryptoCurrency,
        signedAmount: rampSigned(row.ramp)?.amount,
        countsTowardBalance: false,
      });
    }
  }
  return lines.sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""));
}

export function runningBalances(opening: number | undefined, lines: StatementLine[]): (number | undefined)[] {
  if (opening === undefined) return lines.map(() => undefined);
  let running = opening;
  return lines.map((line) => {
    if (!line.countsTowardBalance || line.signedAmount === undefined) return undefined;
    running += line.signedAmount;
    return running;
  });
}

export function defaultStatementAsset(
  wallets: WalletBalance[],
  vbas: VirtualBankAccount[],
): string | undefined {
  const target = vbas.find((v) => v.status === "ACTIVE")?.targetCryptocurrency;
  if (target && wallets.some((w) => w.asset === target)) return target;
  const first = wallets.find((w) => w.asset)?.asset;
  return first;
}

const controlStyle = (active: boolean): CSSProperties => ({
  fontFamily: "var(--font-family)",
  fontSize: "var(--font-size-label)",
  color: active ? "var(--text-primary)" : "var(--text-secondary)",
  background: active ? "var(--selected-tint)" : "var(--surface-raised)",
  border: "var(--border-w-hairline) solid var(--border-hairline)",
  borderRadius: "var(--radius-control)",
  padding: "var(--space-2xs) var(--space-sm)",
});

export function serializeStatementHtml(input: {
  identity: StatementIdentity;
  period: StatementPeriod;
  asset: string;
  decimals: number;
  opening?: number;
  closing?: number;
  omitted?: string;
  lines: StatementLine[];
  generatedAt: string;
}): string {
  const { identity, period, asset, decimals, opening, closing, omitted, lines, generatedAt } = input;
  const run = runningBalances(opening, lines);
  const money = (amount: number | undefined) =>
    amount === undefined ? "—" : `${formatAmount(amount, 2, decimals)} ${asset}`;
  const identityRows = [
    identity.partyName ? `<tr><th>Party</th><td>${identity.partyName}</td></tr>` : "",
    `<tr><th>Account</th><td>${identity.accountId}</td></tr>`,
    identity.iban ? `<tr><th>IBAN</th><td>${identity.iban}</td></tr>` : "",
    identity.bic ? `<tr><th>BIC</th><td>${identity.bic}</td></tr>` : "",
    identity.beneficiaryName && identity.beneficiaryName !== identity.partyName
      ? `<tr><th>Beneficiary</th><td>${identity.beneficiaryName}</td></tr>`
      : "",
  ].join("");
  const body = lines
    .map((line, i) => {
      const amount = line.signedAmount === undefined ? "—" : money(line.signedAmount);
      const bal = run[i] === undefined ? "—" : money(run[i]);
      return `<tr><td>${line.createdAt?.slice(0, 10) ?? "—"}</td><td>${line.label}${line.detail ? ` · ${line.detail}` : ""}</td><td>${amount}</td><td>${bal}</td></tr>`;
    })
    .join("");
  return `<!doctype html>
<html><head><title>Statement ${period.label}</title>
<style>body{font-family:sans-serif;padding:3em;max-width:48em}
h1{font-size:1.25em;margin-bottom:0.4em}h2{font-size:1em;margin-top:1.5em;margin-bottom:0.3em}
p{margin:0.3em 0;font-size:0.9em;line-height:1.4}table{width:100%;border-collapse:collapse;margin:0.5em 0}
td,th{text-align:left;padding:0.3em 0;font-size:0.9em;border-bottom:1px solid gray}
th{width:8em}td:nth-child(3),td:nth-child(4),th:nth-child(3),th:nth-child(4){text-align:right}</style></head><body>
<h1>Account statement</h1>
<p>Period: ${period.label}</p>
<p>Generated: ${generatedAt}</p>
<h2>Account</h2>
<table>${identityRows}</table>
<h2>Balances</h2>
${omitted ? `<p>${omitted}</p>` : `<table><tr><th>Opening</th><td>${money(opening)}</td></tr><tr><th>Closing</th><td>${money(closing)}</td></tr></table>`}
<h2>Activity</h2>
<table><thead><tr><th>Date</th><th>Activity</th><th>Amount</th><th>Balance</th></tr></thead><tbody>${body}</tbody></table>
<p>${STATEMENT_COVERAGE}</p>
<p>${STATEMENT_BALANCE_NOTE}</p>
</body></html>`;
}

/** Same print-to-PDF pipeline as receive.tsx: a print window, no PDF library. */
export function downloadStatementPdf(html: string): void {
  const win = window.open("", "_blank");
  if (!win) return;
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => {
    win.print();
    setTimeout(() => win.close(), 2000);
  }, 300);
}

export function StatementsView({
  identity,
  period,
  months,
  customFrom,
  customTo,
  onSelectMonth,
  onCustomFrom,
  onCustomTo,
  onChooseCustom,
  asset,
  decimals,
  opening,
  closing,
  omitted,
  lines,
  onDownload,
  style,
  className,
}: {
  identity: StatementIdentity;
  period: StatementPeriod;
  months: { year: number; month: number }[];
  customFrom: string;
  customTo: string;
  onSelectMonth: (year: number, month: number) => void;
  onCustomFrom: (value: string) => void;
  onCustomTo: (value: string) => void;
  onChooseCustom: () => void;
  asset: string;
  decimals: number;
  opening?: number;
  closing?: number;
  omitted?: string;
  lines: StatementLine[];
  onDownload?: () => void;
  style?: CSSProperties;
  className?: string;
}): ReactElement {
  const run = runningBalances(opening, lines);
  const monthValue = period.kind === "month" && period.year && period.month ? `${period.year}-${period.month}` : "custom";
  const columns: DataTableColumn<StatementLine & { running?: number }>[] = [
    { key: "date", header: "Date", cell: (line) => line.createdAt?.slice(0, 10) },
    {
      key: "what",
      header: "Activity",
      cell: (line) => <RowText primary={line.label} secondary={line.detail} />,
    },
    {
      key: "amount",
      header: "Amount",
      money: true,
      cell: (line) =>
        line.signedAmount === undefined ? (
          <Money amount={null} />
        ) : (
          <Money amount={line.signedAmount} currency={line.asset} maxFractionDigits={decimals} />
        ),
    },
    {
      key: "balance",
      header: "Balance",
      money: true,
      cell: (line) =>
        line.running === undefined ? (
          <Money amount={null} />
        ) : (
          <Money amount={line.running} currency={asset} maxFractionDigits={decimals} />
        ),
    },
  ];
  const tableRows = lines.map((line, i) => ({ ...line, running: run[i] }));
  const identityFields = [
    ...(identity.partyName ? [{ label: "Party", value: identity.partyName, copyable: false }] : []),
    { label: "Account", value: identity.accountId, copyable: true, mono: true },
    ...(identity.iban ? [{ label: "IBAN", value: identity.iban, copyable: true, mono: true }] : []),
    ...(identity.bic ? [{ label: "BIC", value: identity.bic, copyable: true, mono: true }] : []),
  ];

  return (
    <section className={className} style={{ fontFamily: "var(--font-family)", maxWidth: "100%", minWidth: 0, ...style }}>
      <div className="venly-toolbar" style={{ marginBottom: "var(--space-lg)", flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: "var(--font-size-micro)", color: "var(--text-tertiary)", marginBottom: "var(--space-3xs)" }}>
            Period
          </div>
          <select
            aria-label="Statement period"
            value={monthValue}
            onChange={(event) => {
              if (event.target.value === "custom") {
                onChooseCustom();
                return;
              }
              const [year, month] = event.target.value.split("-").map(Number);
              onSelectMonth(year, month);
            }}
            style={controlStyle(true)}
          >
            {months.map((m) => (
              <option key={`${m.year}-${m.month}`} value={`${m.year}-${m.month}`}>
                {monthPeriod(m.year, m.month).label}
              </option>
            ))}
            <option value="custom">Custom range</option>
          </select>
        </div>
        {period.kind === "custom" ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-sm)", alignItems: "center" }}>
            <label style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-2xs)", fontSize: "var(--font-size-label)", color: "var(--text-secondary)" }}>
              From
              <input
                type="date"
                aria-label="Statement from date"
                value={customFrom}
                onChange={(event) => onCustomFrom(event.target.value)}
                style={controlStyle(Boolean(customFrom))}
              />
            </label>
            <label style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-2xs)", fontSize: "var(--font-size-label)", color: "var(--text-secondary)" }}>
              To
              <input
                type="date"
                aria-label="Statement to date"
                value={customTo}
                onChange={(event) => onCustomTo(event.target.value)}
                style={controlStyle(Boolean(customTo))}
              />
            </label>
          </div>
        ) : null}
        <div className="venly-toolbar-end">
          {onDownload ? (
            <button
              type="button"
              onClick={onDownload}
              style={{
                fontFamily: "var(--font-family)",
                fontSize: "var(--font-size-label)",
                fontWeight: 500,
                color: "var(--accent-fg)",
                background: "var(--accent)",
                border: "none",
                borderRadius: "var(--radius-control)",
                padding: "var(--space-2xs) var(--space-sm)",
                cursor: "pointer",
              }}
            >
              Download PDF
            </button>
          ) : null}
        </div>
      </div>

      <article
        aria-label="Statement document"
        style={{
          background: "var(--surface-raised)",
          border: "var(--border-w-hairline) solid var(--border-hairline)",
          borderRadius: "var(--radius-card)",
          padding: "var(--card-pad)",
          maxWidth: "100%",
          minWidth: 0,
          overflowWrap: "anywhere",
        }}
      >
        <h1 style={{ fontSize: "var(--font-size-title)", fontWeight: 600, margin: "0 0 var(--space-sm)", color: "var(--text-primary)" }}>
          Account statement
        </h1>
        <p style={{ margin: "0 0 var(--space-lg)", fontSize: "var(--font-size-label)", color: "var(--text-secondary)" }}>
          {period.label}
        </p>

        <FieldList fields={identityFields} />
        {!identity.iban && !identity.bic ? (
          <p style={{ margin: "var(--space-sm) 0 0", fontSize: "var(--font-size-label)", color: "var(--text-secondary)" }}>
            No virtual bank account coordinates on this account.
          </p>
        ) : null}

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "var(--space-2xl)",
            margin: "var(--space-xl) 0",
          }}
        >
          <div>
            <div style={{ fontSize: "var(--font-size-micro)", color: "var(--text-tertiary)" }}>Opening</div>
            {omitted || opening === undefined ? (
              <Money amount={null} emphasis="value" />
            ) : (
              <Money amount={opening} currency={asset} emphasis="value" maxFractionDigits={decimals} />
            )}
          </div>
          <div>
            <div style={{ fontSize: "var(--font-size-micro)", color: "var(--text-tertiary)" }}>Closing</div>
            {omitted || closing === undefined ? (
              <Money amount={null} emphasis="value" />
            ) : (
              <Money amount={closing} currency={asset} emphasis="value" maxFractionDigits={decimals} />
            )}
          </div>
        </div>
        {omitted ? (
          <p style={{ margin: "0 0 var(--space-lg)", fontSize: "var(--font-size-label)", color: "var(--text-secondary)" }}>
            {omitted}
          </p>
        ) : null}

        <div className="venly-table-scroll">
          <DataTable
            columns={columns}
            rows={tableRows}
            rowKey={(row) => row.key}
            emptyMessage="No transfers or payouts in this period"
          />
        </div>

        <p style={{ margin: "var(--space-lg) 0 0", fontSize: "var(--font-size-label)", color: "var(--text-secondary)" }}>
          {STATEMENT_COVERAGE}
        </p>
        <p style={{ margin: "var(--space-xs) 0 0", fontSize: "var(--font-size-label)", color: "var(--text-secondary)" }}>
          {STATEMENT_BALANCE_NOTE}
        </p>
      </article>
    </section>
  );
}

export function StatementsBlock({
  accountId,
  clock,
  style,
  className,
}: {
  accountId: string;
  /** Injected so tests pin the default month. */
  clock?: Date;
  style?: CSSProperties;
  className?: string;
}): ReactElement {
  const now = clock ?? new Date();
  const months = useMemo(() => recentCompleteMonths(now), [now]);
  const defaultPeriod = useMemo(() => {
    const last = lastCompleteMonth(now);
    return monthPeriod(last.year, last.month);
  }, [now]);
  const [period, setPeriod] = useState<StatementPeriod>(defaultPeriod);
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [assetOverride, setAssetOverride] = useState<string | null>(null);

  const transfersQuery = useTransfers(accountId);
  const rampsQuery = useRampRequests();
  const walletsQuery = useWallets(accountId);
  const vbaQuery = useVirtualBankAccounts(accountId);
  const assetsQuery = useSupportedAssets();

  const pending =
    transfersQuery.isPending ||
    rampsQuery.isPending ||
    walletsQuery.isPending ||
    vbaQuery.isPending ||
    assetsQuery.isPending;

  const malformed =
    transfersQuery.isError ||
    rampsQuery.isError ||
    walletsQuery.isError ||
    vbaQuery.isError ||
    assetsQuery.isError ||
    !transfersQuery.data ||
    transfersQuery.data.resultPresent === false ||
    !rampsQuery.data ||
    rampsQuery.data.resultPresent === false ||
    !walletsQuery.data ||
    walletsQuery.data.resultPresent === false ||
    !vbaQuery.data ||
    vbaQuery.data.resultPresent === false ||
    !assetsQuery.data ||
    assetsQuery.data.resultPresent === false;

  const transfers = transfersQuery.data?.items ?? [];
  const ramps = (rampsQuery.data?.items ?? []) as RampActivityItem[];
  const wallets = walletsQuery.data?.items ?? [];
  const vbas = vbaQuery.data?.items ?? [];
  const supported = (assetsQuery.data?.items ?? []) as SupportedAsset[];

  const identity = statementIdentity(accountId, vbas);
  const resolvedAsset = assetOverride ?? defaultStatementAsset(wallets, vbas) ?? "";
  const precision = assetDecimals(resolvedAsset, supported);
  const unified = unifyActivity(transfers, ramps);
  const lines = statementLines(unified, accountId, resolvedAsset, period);
  const derived = deriveOpeningClosing({
    currentTotal: resolvedAsset ? walletTotalForAsset(wallets, resolvedAsset) : undefined,
    transfers,
    accountId,
    asset: resolvedAsset,
    periodStart: period.start,
    periodEnd: period.end,
  });

  const handleDownload = (): void => {
    const html = serializeStatementHtml({
      identity,
      period,
      asset: resolvedAsset,
      decimals: precision.decimals,
      opening: derived.opening,
      closing: derived.closing,
      omitted: derived.omitted,
      lines,
      generatedAt: formatStamp(now),
    });
    downloadStatementPdf(html);
  };

  if (pending) {
    return (
      <section className={className} style={{ fontFamily: "var(--font-family)", ...style }}>
        <TableSkeleton
          columns={[
            { key: "date", header: "Date", cell: () => null },
            { key: "what", header: "Activity", cell: () => null },
            { key: "amount", header: "Amount", money: true, cell: () => null },
            { key: "balance", header: "Balance", money: true, cell: () => null },
          ]}
          label="Loading statement"
        />
      </section>
    );
  }

  if (malformed) {
    return (
      <section className={className} style={{ fontFamily: "var(--font-family)", ...style }}>
        <ListLoadError
          what="your statement"
          onRetry={() => {
            void transfersQuery.refetch();
            void rampsQuery.refetch();
            void walletsQuery.refetch();
            void vbaQuery.refetch();
            void assetsQuery.refetch();
          }}
        />
      </section>
    );
  }

  const assets = [...new Set(wallets.map((w) => w.asset).filter((a): a is string => Boolean(a)))];

  return (
    <div className={className} style={style}>
      {assets.length > 1 ? (
        <div style={{ marginBottom: "var(--space-md)" }}>
          <select
            aria-label="Statement asset"
            value={resolvedAsset}
            onChange={(event) => setAssetOverride(event.target.value)}
            style={controlStyle(true)}
          >
            {assets.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      <StatementsView
        identity={identity}
        period={period}
        months={months}
        customFrom={customFrom}
        customTo={customTo}
        onSelectMonth={(year, month) => setPeriod(monthPeriod(year, month))}
        onCustomFrom={(value) => {
          setCustomFrom(value);
          const next = customPeriod(value, customTo || value);
          if (next) setPeriod(next);
        }}
        onCustomTo={(value) => {
          setCustomTo(value);
          const next = customPeriod(customFrom || value, value);
          if (next) setPeriod(next);
        }}
        onChooseCustom={() => {
          const from = customFrom || period.start.slice(0, 10);
          const to = customTo || period.end.slice(0, 10);
          setCustomFrom(from);
          setCustomTo(to);
          const next = customPeriod(from, to);
          if (next) setPeriod(next);
        }}
        asset={resolvedAsset}
        decimals={precision.decimals}
        opening={derived.opening}
        closing={derived.closing}
        omitted={derived.omitted}
        lines={lines}
        onDownload={handleDownload}
      />
    </div>
  );
}
