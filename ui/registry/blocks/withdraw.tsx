import { useMemo, useState, type CSSProperties, type ReactElement } from "react";
import type { FundflowComponents, RampRequest } from "@venlyfinance/sdk";
import {
  describeRampStatus,
  useCompanyBankAccounts,
  useCreateRampRequest,
  useFeeQuote,
  useFourEyesApproval,
  useInitiateRamp,
  useRampPairs,
  useRampRequest,
  useRampRequests,
  useReferenceData,
  useWallets,
} from "@venlyfinance/react";
import { Money, formatAmount, formatStamp } from "../lib/money.js";
import { DataTable, RowText, type DataTableColumn } from "../components/data-table.js";
import { StatusPill, type StatusIntent } from "../components/status-pill.js";
import { Timeline, type TimelineStep } from "../components/timeline.js";
import { FieldList } from "../components/field-list.js";
import { ArithmeticLadder } from "../components/arithmetic-ladder.js";
import { ListLoadError } from "../components/list-error.js";
import { BANK_ACCOUNT_STATUS_PILL, type CompanyBankAccountListItem } from "./bank-accounts.js";

/**
 * Withdraw block – fiat out to the company's own verified bank account.
 *
 * What the API models, and therefore what this flow renders: a withdrawal
 * is a ramp request. It is created in crypto units (the amount you send),
 * needs a second person's approval (four-eyes: the creator can never
 * approve their own request), then waits for you to send the crypto to a
 * deposit wallet and report the transaction hash, then processes. The fiat
 * figures – gross, fee, net, rate – exist on the CREATED record; the
 * pre-create review shows only what is known (amount, fee quote,
 * destination) and never invents a rate or an arrival time.
 *
 * Design contract encoded by this block:
 * - Destination is one of YOUR whitelisted, verified bank accounts;
 *   unverified rows are disabled with the reason, never hidden.
 * - The fee quote renders with its percentage AND its unit (the entered
 *   asset) – the quote is computed from the amount you typed.
 * - Approval actions render the rule, not the error: the creator sees why
 *   they can't approve; a stale decision (someone acted first) re-fetches
 *   and asks the operator to re-decide, never auto-retries.
 * - Every status renders word + glyph; a refusal never reads as a wait.
 * - The event timeline carries actor, role and absolute timestamps -
 *   this rail's records actually have history, so the UI shows it.
 */

type fundflow = FundflowComponents["schemas"];
type RampListItem = fundflow["RampRequestListItem"];

// ── Status label map (NAV vocabulary, applied once) ────────────────────

export const WITHDRAW_STATUS_PILL: Record<string, { label: string; intent: StatusIntent }> = {
  AWAITING_APPROVAL: { label: "Awaiting approval", intent: "pending" },
  AWAITING_FUNDS: { label: "Approved · awaiting funds", intent: "pending" },
  PROCESSING: { label: "Processing", intent: "active" },
  SUCCEEDED: { label: "Paid out", intent: "positive" },
  FAILED: { label: "Failed", intent: "negative" },
  REJECTED: { label: "Rejected", intent: "negative" },
  CANCELLED: { label: "Cancelled", intent: "neutral" },
  BLOCKED: { label: "On hold · contact support", intent: "neutral" },
  DENIED: { label: "Declined · contact support", intent: "negative" },
};

const PENDING_FAMILY = new Set(["AWAITING_APPROVAL", "AWAITING_FUNDS", "PROCESSING", "BLOCKED"]);

/** Pending family above terminal – a pending debit never sits beside a settled one. */
export function withdrawalGroups(items: RampListItem[]): { key: string; label: string; rows: RampListItem[]; attention?: boolean }[] {
  // Three bands: a failed or refused movement must never sit under a
  // header that asserts success.
  const pending = items.filter((i) => PENDING_FAMILY.has(i.status ?? ""));
  const completed = items.filter((i) => i.status === "SUCCEEDED");
  const incomplete = items.filter(
    (i) => !PENDING_FAMILY.has(i.status ?? "") && i.status !== "SUCCEEDED",
  );
  return [
    { key: "pending", label: "In progress", rows: pending, attention: pending.length > 0 },
    { key: "completed", label: "Completed", rows: completed },
    { key: "incomplete", label: "Didn't complete", rows: incomplete },
  ];
}

// ── Shared styling ─────────────────────────────────────────────────────

const primaryButton: CSSProperties = {
  border: "none",
  background: "var(--accent)",
  color: "var(--accent-fg)",
  borderRadius: "var(--radius-control)",
  padding: "var(--space-sm) var(--space-lg)",
  fontSize: "var(--font-size-body)",
  fontFamily: "var(--font-family)",
  fontWeight: 500,
  cursor: "pointer",
};

const quietButton: CSSProperties = {
  border: "var(--border-w-hairline) solid var(--border-strong)",
  background: "var(--surface-raised)",
  color: "var(--text-primary)",
  borderRadius: "var(--radius-control)",
  padding: "var(--space-sm) var(--space-lg)",
  fontSize: "var(--font-size-body)",
  fontFamily: "var(--font-family)",
  cursor: "pointer",
};

const inputStyle: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  border: "var(--border-w-hairline) solid var(--border-strong)",
  borderRadius: "var(--radius-control)",
  padding: "var(--space-sm) var(--space-md)",
  fontSize: "var(--font-size-body)",
  fontFamily: "var(--font-family)",
  color: "var(--text-primary)",
  background: "var(--surface-raised)",
};

const cardStyle: CSSProperties = {
  background: "var(--surface-raised)",
  border: "var(--border-w-hairline) solid var(--border-hairline)",
  borderRadius: "var(--radius-card)",
  padding: "var(--card-pad)",
};

const sectionHeading: CSSProperties = {
  margin: 0,
  fontSize: "var(--font-size-label)",
  fontWeight: 600,
  color: "var(--text-secondary)",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
};

// ── Withdrawals table ──────────────────────────────────────────────────

export interface WithdrawalsTableProps {
  items: RampListItem[];
  onOpen?: (item: RampListItem) => void;
  selectedId?: string;
  style?: CSSProperties;
  className?: string;
}

export function WithdrawalsTable({ items, onOpen, selectedId, style, className }: WithdrawalsTableProps): ReactElement {
  const columns: DataTableColumn<RampListItem>[] = [
    {
      key: "request",
      header: "Withdrawal",
      cell: (r) => (
        <RowText
          primary={`${r.cryptoCurrency ?? ""} → ${r.fiatCurrency ?? ""}`.trim()}
          secondary={r.paymentReference ?? undefined}
        />
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (r) => {
        const pill = WITHDRAW_STATUS_PILL[r.status ?? ""];
        return pill ? <StatusPill {...pill} /> : <span style={{ color: "var(--text-tertiary)" }}>—</span>;
      },
    },
    {
      key: "created",
      header: "Created",
      cell: (r) => (
        <span style={{ fontSize: "var(--font-size-label)", color: "var(--text-secondary)" }}>
          {r.createdAt ? new Date(r.createdAt).toISOString().slice(0, 10) : "—"}
        </span>
      ),
    },
    {
      key: "amount",
      header: "Amount",
      money: true,
      cell: (r) => <Money amount={r.fiatAmount ?? null} currency={r.fiatCurrency ?? undefined} />,
    },
  ];

  return (
    <div className="venly-table-scroll">
      <DataTable
      className={className}
      style={style}
      columns={columns}
      rows={items}
      groups={withdrawalGroups(items)}
      rowKey={(r) => r.id ?? ""}
      onRowClick={onOpen}
      selectedKey={selectedId}
      emptyMessage="No withdrawals yet."
    />
    </div>
  );
}

// ── Destination picker ─────────────────────────────────────────────────

export interface DestinationPickerProps {
  accounts: CompanyBankAccountListItem[];
  onSelect: (account: CompanyBankAccountListItem) => void;
  onGoToBankAccounts?: () => void;
  style?: CSSProperties;
  className?: string;
}

export function DestinationPicker({ accounts, onSelect, onGoToBankAccounts, style, className }: DestinationPickerProps): ReactElement {
  const verified = accounts.filter((a) => a.verificationStatus === "VERIFIED");

  if (verified.length === 0) {
    return (
      <section className={className} style={{ ...cardStyle, fontFamily: "var(--font-family)", maxWidth: "var(--form-max-width)", ...style }}>
        {/* Copy-owned: "Settings" names this app's bank-accounts page - rename it to match yours. */}
        <p style={{ margin: 0, fontSize: "var(--font-size-body)", color: "var(--text-primary)" }}>
          You need a verified bank account before you can withdraw. Add one in Settings.
        </p>
        {onGoToBankAccounts ? (
          <button type="button" style={{ ...primaryButton, marginTop: "var(--space-lg)" }} onClick={onGoToBankAccounts}>
            Go to bank accounts
          </button>
        ) : null}
      </section>
    );
  }

  return (
    <section className={className} style={{ fontFamily: "var(--font-family)", maxWidth: "var(--form-max-width)", display: "flex", flexDirection: "column", gap: "var(--space-sm)", ...style }}>
      <h2 style={sectionHeading}>Withdraw to</h2>
      {accounts.map((a) => {
        const usable = a.verificationStatus === "VERIFIED";
        const reason =
          a.verificationStatus === "PENDING"
            ? "In review – available once verified."
            : a.verificationStatus === "DENIED"
              ? "Declined – this account can't receive withdrawals. Add a different account or contact support for details."
              : null;
        return (
          <button
            key={a.id}
            type="button"
            disabled={!usable}
            aria-disabled={!usable}
            onClick={() => usable && onSelect(a)}
            style={{
              ...cardStyle,
              textAlign: "left",
              cursor: usable ? "pointer" : "not-allowed",
              opacity: usable ? 1 : 0.75,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: "var(--space-lg)",
              fontFamily: "var(--font-family)",
            }}
          >
            <span style={{ display: "flex", flexDirection: "column", gap: "var(--space-3xs)" }}>
              <span style={{ fontSize: "var(--font-size-body)", fontWeight: 500, color: "var(--text-primary)" }}>
                {a.name}
              </span>
              <span style={{ fontSize: "var(--font-size-label)", color: "var(--text-secondary)" }}>
                {a.bankName} · {a.bankCountry}
              </span>
              {reason ? (
                <span style={{ fontSize: "var(--font-size-label)", color: "var(--text-secondary)" }}>{reason}</span>
              ) : null}
            </span>
            {(() => {
              const pill = BANK_ACCOUNT_STATUS_PILL[a.verificationStatus ?? ""];
              return pill ? <StatusPill {...pill} /> : null;
            })()}
          </button>
        );
      })}
    </section>
  );
}

// ── Amount + quote step ────────────────────────────────────────────────

/** Amount input guard: "" and "Infinity" must not stage. */
export function parseWithdrawAmount(raw: string): number | null {
  if (raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
}

interface StagedWithdrawal {
  destination: CompanyBankAccountListItem;
  amount: number;
  cryptoCurrency: string;
  cryptoCurrencyId: string;
  fiatCurrency: string;
  fiatCurrencyId: string;
  feeAmount?: number;
  feePercentage?: number;
}

function AmountStep({
  accountId,
  destination,
  onStaged,
  onBack,
}: {
  accountId?: string;
  destination: CompanyBankAccountListItem;
  onStaged: (staged: StagedWithdrawal) => void;
  onBack: () => void;
}): ReactElement {
  const { data: pairs } = useRampPairs("off");
  const { data: reference } = useReferenceData();
  const { data: wallets } = useWallets(accountId);
  const [raw, setRaw] = useState("");
  const [pairIndex, setPairIndex] = useState(0);

  const pair = (pairs ?? [])[pairIndex];
  const cryptoCode = pair?.from?.currency ?? "";
  const fiatCode = pair?.to?.currency ?? "";
  const amount = parseWithdrawAmount(raw);
  const { data: quote } = useFeeQuote(amount ? { amount, type: "OFF_RAMP" } : undefined);

  const available = useMemo(() => {
    let sum = 0;
    // Contract 1.3.0: listWallets returns per-asset balance rows directly.
    for (const balance of wallets?.items ?? []) {
      if (balance.asset === cryptoCode) sum += Number(balance.amount?.available ?? 0);
    }
    return sum;
  }, [wallets, cryptoCode]);
  const overBalance = accountId !== undefined && amount !== null && amount > available;

  const cryptoId = (reference?.cryptoCurrencies ?? []).find((c) => c.currency === cryptoCode)?.id;
  const fiatId = (reference?.fiatCurrencies ?? []).find((c) => c.currency === fiatCode)?.id;
  const ready = amount !== null && !overBalance && cryptoId && fiatId;

  return (
    <form
      style={{ fontFamily: "var(--font-family)", maxWidth: "var(--form-max-width)", display: "flex", flexDirection: "column", gap: "var(--space-lg)" }}
      onSubmit={(e) => {
        e.preventDefault();
        if (!ready) return;
        onStaged({
          destination,
          amount: amount as number,
          cryptoCurrency: cryptoCode,
          cryptoCurrencyId: cryptoId as string,
          fiatCurrency: fiatCode,
          fiatCurrencyId: fiatId as string,
          feeAmount: quote?.amount,
          feePercentage: quote?.percentage,
        });
      }}
    >
      <h2 style={sectionHeading}>Amount</h2>
      <div>
        <label
          htmlFor="vf-withdraw-amount"
          style={{ display: "block", fontSize: "var(--font-size-label)", color: "var(--text-secondary)", marginBottom: "var(--space-2xs)" }}
        >
          You send
        </label>
        {/* Amount + asset are ONE field: selector inside the right end. */}
        <div style={{ display: "flex", border: "var(--border-w-hairline) solid var(--border-strong)", borderRadius: "var(--radius-control)", background: "var(--surface-raised)", overflow: "hidden" }}>
          <input
            id="vf-withdraw-amount"
            inputMode="decimal"
            style={{ ...inputStyle, border: "none", flex: 1, fontVariantNumeric: "tabular-nums" }}
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
          />
          <select
            aria-label="Asset and payout currency"
            style={{ border: "none", borderLeft: "var(--border-w-hairline) solid var(--border-hairline)", background: "var(--surface-raised)", fontFamily: "var(--font-family)", fontSize: "var(--font-size-body)", color: "var(--text-primary)", padding: "0 var(--space-md)", cursor: "pointer" }}
            value={pairIndex}
            onChange={(e) => setPairIndex(Number(e.target.value))}
          >
            {(pairs ?? []).map((p, i) => (
              <option key={`${p.from?.currency}-${p.to?.currency}`} value={i}>
                {p.from?.currency} → {p.to?.currency}
              </option>
            ))}
          </select>
        </div>
        {/* The unit trap this flow must never spring: the amount is CRYPTO
            units, and 1,000 USDC is not €1,000. Said here, at the field. */}
        {cryptoCode && fiatCode ? (
          <p style={{ margin: "var(--space-2xs) 0 0", fontSize: "var(--font-size-label)", color: "var(--text-secondary)" }}>
            This amount is in {cryptoCode}, the asset you send. Your bank receives {fiatCode} – the exact amount is confirmed on creation.
          </p>
        ) : null}
        {accountId !== undefined ? (
          <p style={{ margin: "var(--space-2xs) 0 0", fontSize: "var(--font-size-label)", color: overBalance ? "var(--state-danger-fg)" : "var(--text-secondary)" }}>
            Available: {formatAmount(available)} {cryptoCode}
          </p>
        ) : null}
        {overBalance ? (
          <p role="alert" style={{ margin: "var(--space-2xs) 0 0", fontSize: "var(--font-size-label)", color: "var(--state-danger-fg)" }}>
            That's more than your available balance.
          </p>
        ) : null}
      </div>

      {amount !== null && quote ? (
        <p style={{ margin: 0, fontSize: "var(--font-size-body)", color: "var(--text-secondary)" }}>
          Fee ({quote.percentage ?? 0}%) <span style={{ fontVariantNumeric: "tabular-nums" }}>− {formatAmount(quote.amount ?? 0)} {cryptoCode}</span>
        </p>
      ) : null}

      <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-sm)" }}>
        <button type="submit" disabled={!ready} style={primaryButton}>
          Review withdrawal
        </button>
        <button type="button" style={quietButton} onClick={onBack}>
          Back
        </button>
      </div>
    </form>
  );
}

// ── Review (pre-create: the KNOWN figures only) ────────────────────────

export function WithdrawReview({
  staged,
  submitting,
  onConfirm,
  onEdit,
  style,
  className,
}: {
  staged: StagedWithdrawal;
  submitting?: boolean;
  onConfirm: () => void;
  onEdit: () => void;
  style?: CSSProperties;
  className?: string;
}): ReactElement {
  return (
    <section className={className} style={{ fontFamily: "var(--font-family)", maxWidth: "var(--form-max-width)", display: "flex", flexDirection: "column", gap: "var(--space-lg)", ...style }}>
      <h2 style={sectionHeading}>Review</h2>
      <div style={cardStyle}>
        <FieldList
          fields={[
            { label: "You send", value: `${formatAmount(staged.amount)} ${staged.cryptoCurrency}`, copyable: false, mono: true },
            {
              label: staged.feePercentage !== undefined ? `Fee (${staged.feePercentage}%)` : "Fee",
              value:
                staged.feeAmount !== undefined
                  ? `− ${formatAmount(staged.feeAmount)} ${staged.cryptoCurrency}`
                  : "Quote unavailable right now – the fee appears on the created request.",
              copyable: false,
              mono: staged.feeAmount !== undefined,
            },
            { label: "To", value: `${staged.destination.name} · ${staged.destination.bankName}`, copyable: false },
            { label: "Payout currency", value: staged.fiatCurrency, copyable: false },
          ]}
        />
      </div>
      {/* The bank-receives figure is not known before creation: the created
          request carries the fiat amounts and rate, and the detail opens on
          them. Nothing is rendered in its place. */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-sm)" }}>
        <button type="button" disabled={submitting} style={primaryButton} onClick={onConfirm}>
          {submitting ? "Requesting…" : `Request withdrawal of ${formatAmount(staged.amount)} ${staged.cryptoCurrency}`}
        </button>
        <button type="button" disabled={submitting} style={quietButton} onClick={onEdit}>
          Edit
        </button>
      </div>
    </section>
  );
}

// ── Detail (the created record: real figures, approvals, instructions) ─

function eventsToTimeline(events: fundflow["RampRequestEventDto"][] | undefined): TimelineStep[] {
  return (events ?? []).map((event, index, all) => ({
    key: event.id ?? String(index),
    label: (event.eventType ?? "").replaceAll("_", " ").toLowerCase().replace(/^./, (c) => c.toUpperCase()),
    meta: `${event.username ?? ""} (${(event.role ?? "").replaceAll("COMPANY_", "").toLowerCase()}) · ${event.createdAt ? formatStamp(event.createdAt) : ""}`,
    state: index === all.length - 1 ? "current" : "completed",
  }));
}

export interface WithdrawDetailProps {
  request: RampRequest & { createdBy?: string };
  /** The signed-in operator, for the four-eyes capability read. */
  actorId?: string;
  style?: CSSProperties;
  className?: string;
}

export function WithdrawDetail({ request, actorId, style, className }: WithdrawDetailProps): ReactElement {
  const approval = useFourEyesApproval(request, actorId);
  const initiate = useInitiateRamp();
  const [txHash, setTxHash] = useState("");
  const descriptor = describeRampStatus(request.status);
  const pill = WITHDRAW_STATUS_PILL[request.status ?? ""] ?? { label: descriptor.label, intent: "neutral" as StatusIntent };
  const cryptoCode = request.cryptoCurrency?.currency ?? "";
  const fiatCode = request.fiatCurrency?.currency ?? "";

  return (
    <section className={className} style={{ fontFamily: "var(--font-family)", maxWidth: "var(--form-max-width)", display: "flex", flexDirection: "column", gap: "var(--space-xl)", ...style }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "var(--space-lg)" }}>
        <h2 style={{ margin: 0, fontSize: "var(--font-size-value)", fontWeight: 600, color: "var(--text-primary)" }}>
          Withdrawal {request.paymentReference ?? ""}
        </h2>
        <StatusPill {...pill} />
      </div>
      <p style={{ margin: 0, fontSize: "var(--font-size-body)", color: "var(--text-secondary)" }}>{descriptor.explanation}</p>

      {/* The created record carries the real arithmetic: show all of it. */}
      {request.fiatAmount !== undefined ? (
        <div>
          {/* The ladder chains ONLY the figures that participate in the sum;
              the rate was applied upstream of the converted amount, so it
              renders beside the ladder, never behind an operator. */}
          <ArithmeticLadder
            input={{ label: "Converted amount", amount: request.fiatAmount ?? 0, currency: fiatCode }}
            rows={[
              { operator: "−", label: `Fee (${request.feePercentage ?? 0}%)`, amount: request.fiatFeeAmount ?? 0, currency: fiatCode },
            ]}
            total={{ label: "Your bank receives", amount: request.fiatNetAmount ?? 0, currency: fiatCode }}
          />
          {request.exchangeRate !== undefined ? (
            <p style={{ margin: "var(--space-sm) 0 0", fontSize: "var(--font-size-label)", color: "var(--text-secondary)" }}>
              Rate applied: 1 {cryptoCode} = {request.exchangeRate} {fiatCode}
            </p>
          ) : null}
        </div>
      ) : null}

      <div style={cardStyle}>
        <FieldList
          fields={[
            { label: "You send", value: request.cryptoAmount !== undefined ? `${formatAmount(request.cryptoAmount)} ${cryptoCode}` : null, copyable: false, mono: true },
            { label: "To", value: request.companyBankAccount ? `${request.companyBankAccount.name ?? ""} · ${request.companyBankAccount.bankName ?? ""}` : null, copyable: false },
            { label: "Created", value: request.createdAt ? formatStamp(request.createdAt) : null, copyable: false },
          ]}
        />
      </div>

      {/* Four-eyes action bar: render the rule, not the error. */}
      {request.status === "AWAITING_APPROVAL" ? (
        <div style={cardStyle}>
          {approval.capability.reason === "actor-is-creator" ? (
            <p style={{ margin: "0 0 var(--space-md)", fontSize: "var(--font-size-body)", color: "var(--text-secondary)" }}>
              Because you created this request, another team member must approve it. You can still cancel.
            </p>
          ) : null}
          {approval.state.phase === "failed" && approval.state.failure === "stale-version" ? (
            <p role="alert" style={{ margin: "0 0 var(--space-md)", fontSize: "var(--font-size-body)", color: "var(--state-pending-fg)" }}>
              This request changed while you were viewing it. Here's the latest version – review it and decide again.
            </p>
          ) : approval.state.phase === "failed" ? (
            <p role="alert" style={{ margin: "0 0 var(--space-md)", fontSize: "var(--font-size-body)", color: "var(--state-danger-fg)" }}>
              That decision was refused. Refresh and try from the current state.
            </p>
          ) : null}
          <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-sm)" }}>
            {approval.capability.canApprove ? (
              <button type="button" style={primaryButton} disabled={approval.state.phase === "submitting"} onClick={approval.approve}>
                Approve
              </button>
            ) : null}
            {approval.capability.canReject ? (
              <button type="button" style={quietButton} disabled={approval.state.phase === "submitting"} onClick={approval.reject}>
                Reject
              </button>
            ) : null}
            {approval.capability.canCancel ? (
              <button type="button" style={quietButton} disabled={approval.state.phase === "submitting"} onClick={approval.cancel}>
                Cancel request
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* The manual crypto leg: instructions + the hash report. */}
      {request.status === "AWAITING_FUNDS" ? (
        <div style={{ ...cardStyle, display: "flex", flexDirection: "column", gap: "var(--space-lg)" }}>
          <h3 style={sectionHeading}>
            Send {formatAmount(request.cryptoAmount ?? 0)} {cryptoCode} on {request.depositWallet?.chain ?? ""} to this address, then report the transaction hash.
          </h3>
          <FieldList
            fields={[
              { label: "Deposit address", value: request.depositWallet?.address ?? null, mono: true },
              { label: "Chain", value: request.depositWallet?.chain ?? null, copyable: false },
              { label: "Payment reference (include it word for word)", value: request.paymentReference ?? null, required: true, mono: true },
            ]}
          />
          <form
            style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}
            onSubmit={(e) => {
              e.preventDefault();
              if (!request.id || !txHash) return;
              initiate.mutate({ id: request.id, body: { version: request.version ?? 0, blockchainTransactionHash: txHash } });
            }}
          >
            <label htmlFor="vf-withdraw-txhash" style={{ fontSize: "var(--font-size-label)", color: "var(--text-secondary)" }}>
              Transaction hash
            </label>
            <input id="vf-withdraw-txhash" style={{ ...inputStyle, fontVariantNumeric: "tabular-nums" }} value={txHash} onChange={(e) => setTxHash(e.target.value)} />
            <button type="submit" disabled={initiate.isPending || !txHash} style={{ ...primaryButton, alignSelf: "start" }}>
              {initiate.isPending ? "Reporting…" : "Report transfer"}
            </button>
            {initiate.isError ? (
              <p role="alert" style={{ margin: 0, fontSize: "var(--font-size-label)", color: "var(--state-danger-fg)" }}>
                {initiate.error.message}
              </p>
            ) : null}
          </form>
        </div>
      ) : null}

      {(request.events ?? []).length > 0 ? (
        <div>
          <h3 style={{ ...sectionHeading, marginBottom: "var(--space-md)" }}>History</h3>
          <Timeline steps={eventsToTimeline(request.events)} />
        </div>
      ) : null}
    </section>
  );
}

/**
 * Connected list: the account's withdrawal history bound to the ramp-request
 * source. A failed or malformed list (resultPresent === false) renders an
 * explicit error, never an empty history claiming "no withdrawals".
 */
export function WithdrawalsBlock({
  onOpen,
  selectedId,
  style,
  className,
}: {
  onOpen?: (item: RampListItem) => void;
  selectedId?: string | null;
  style?: CSSProperties;
  className?: string;
}): ReactElement {
  const query = useRampRequests({ rampType: "OFF_RAMP" });

  if (query.isPending) {
    return (
      <section className={className} style={{ fontFamily: "var(--font-family)", ...style }}>
        <p style={{ color: "var(--text-tertiary)", fontSize: "var(--font-size-body)" }}>Loading withdrawals…</p>
      </section>
    );
  }

  if (query.isError || !query.data || query.data.resultPresent === false) {
    return (
      <section className={className} style={{ fontFamily: "var(--font-family)", ...style }}>
        <ListLoadError what="your withdrawals" onRetry={() => void query.refetch()} />
      </section>
    );
  }

  return (
    <WithdrawalsTable
      items={query.data.items ?? []}
      onOpen={onOpen}
      selectedId={selectedId ?? undefined}
      style={style}
      className={className}
    />
  );
}

/** Connected detail: fetches the record + the list row that carries createdBy. */
export function ConnectedWithdrawDetail({ id, actorId, style, className }: { id: string; actorId?: string; style?: CSSProperties; className?: string }): ReactElement {
  const { data: request } = useRampRequest(id);
  const { data: list } = useRampRequests({ rampType: "OFF_RAMP" });
  if (!request) {
    return (
      <p style={{ fontFamily: "var(--font-family)", color: "var(--text-tertiary)", fontSize: "var(--font-size-body)" }}>Loading withdrawal…</p>
    );
  }
  // createdBy exists on LIST items only; graft it for the capability read.
  const createdBy = (list?.items ?? []).find((i) => i.id === id)?.createdBy;
  return <WithdrawDetail request={{ ...request, createdBy }} actorId={actorId} style={style} className={className} />;
}

// ── The flow ───────────────────────────────────────────────────────────

export interface WithdrawFlowProps {
  /** Finance account whose balance gates the amount step (optional). */
  accountId?: string;
  /** The signed-in operator, for four-eyes capability on the detail. */
  actorId?: string;
  onGoToBankAccounts?: () => void;
  /** Fires with the created request id (e.g. to route to a detail page). */
  onCreated?: (id: string) => void;
  style?: CSSProperties;
  className?: string;
}

type FlowStep =
  | { step: "pick" }
  | { step: "amount"; destination: CompanyBankAccountListItem }
  | { step: "review"; staged: StagedWithdrawal }
  | { step: "detail"; id: string };

export function WithdrawFlow({ accountId, actorId, onGoToBankAccounts, onCreated, style, className }: WithdrawFlowProps): ReactElement {
  const accountsQuery = useCompanyBankAccounts();
  const { data: accounts } = accountsQuery;
  const create = useCreateRampRequest();
  const [flow, setFlow] = useState<FlowStep>({ step: "pick" });

  if (flow.step === "detail") {
    return <ConnectedWithdrawDetail id={flow.id} actorId={actorId} style={style} className={className} />;
  }

  // The destination picker's feed. A failed or malformed whitelist
  // (resultPresent === false) must not render the "add a bank account"
  // empty state – the accounts may exist and be verified already.
  if (
    flow.step === "pick" &&
    !accountsQuery.isPending &&
    (accountsQuery.isError || !accounts || accounts.resultPresent === false)
  ) {
    return (
      <section className={className} style={{ fontFamily: "var(--font-family)", ...style }}>
        <ListLoadError what="your bank accounts" onRetry={() => void accountsQuery.refetch()} />
      </section>
    );
  }

  if (flow.step === "review") {
    return (
      <WithdrawReview
        className={className}
        style={style}
        staged={flow.staged}
        submitting={create.isPending}
        onEdit={() => setFlow({ step: "amount", destination: flow.staged.destination })}
        onConfirm={() => {
          create.mutate(
            {
              rampType: "OFF_RAMP",
              amount: flow.staged.amount,
              fiatCurrencyId: flow.staged.fiatCurrencyId,
              cryptoCurrencyId: flow.staged.cryptoCurrencyId,
              companyBankAccountId: flow.staged.destination.id,
            },
            {
              onSuccess: (request) => {
                if (request.id) {
                  onCreated?.(request.id);
                  setFlow({ step: "detail", id: request.id });
                }
              },
            },
          );
        }}
      />
    );
  }

  if (flow.step === "amount") {
    return (
      <div className={className} style={style}>
        <AmountStep
          accountId={accountId}
          destination={flow.destination}
          onBack={() => setFlow({ step: "pick" })}
          onStaged={(staged) => setFlow({ step: "review", staged })}
        />
      </div>
    );
  }

  return (
    <DestinationPicker
      className={className}
      style={style}
      accounts={accounts?.items ?? []}
      onGoToBankAccounts={onGoToBankAccounts}
      onSelect={(destination) => setFlow({ step: "amount", destination })}
    />
  );
}
