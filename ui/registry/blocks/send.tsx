import { useState, type CSSProperties, type ReactElement } from "react";
import {
  useStagedTransfer,
  type StagedTransferState,
  type TransferDraft,
} from "@venlyfinance/react";
import { formatAmount } from "../lib/money.js";
import { ArithmeticLadder, type LadderRow } from "../components/arithmetic-ladder.js";
import { Timeline, type TimelineStep } from "../components/timeline.js";

/**
 * Send block – stage-then-confirm, rendered.
 *
 * Design contract encoded by this block:
 * - Money movement is never form-submit-to-execution: the review step
 *   renders the EXACT staged request (the arithmetic ladder), and only
 *   confirm() executes – once, on a pinned idempotency key.
 * - The commit button restates the amount: "Pay €1,240.00". Never a
 *   countdown on the button.
 * - Values are never masked on a review screen.
 * - After confirm, the transfer's status story renders as the timeline;
 *   failure is a terminal state with the reason, not a toast.
 */

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

const labelStyle: CSSProperties = {
  display: "block",
  fontSize: "var(--font-size-label)",
  color: "var(--text-secondary)",
  marginBottom: "var(--space-2xs)",
};

export interface SendFormValues {
  receiverAccountId: string;
  currency: string;
  amount: string;
  description: string;
}

export function SendForm({
  values,
  issues,
  onChange,
  onStage,
}: {
  values: SendFormValues;
  issues: string[];
  onChange: (values: SendFormValues) => void;
  onStage: () => void;
}): ReactElement {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onStage();
      }}
      style={{ display: "grid", gap: "var(--space-md)", fontFamily: "var(--font-family)" }}
    >
      <div>
        <label style={labelStyle} htmlFor="vf-send-recipient">
          Recipient account
        </label>
        <input
          id="vf-send-recipient"
          style={inputStyle}
          value={values.receiverAccountId}
          onChange={(e) => onChange({ ...values, receiverAccountId: e.target.value })}
        />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: "var(--space-md)" }}>
        <div>
          <label style={labelStyle} htmlFor="vf-send-currency">
            Currency
          </label>
          <input
            id="vf-send-currency"
            style={inputStyle}
            value={values.currency}
            onChange={(e) => onChange({ ...values, currency: e.target.value.toUpperCase() })}
          />
        </div>
        <div>
          <label style={labelStyle} htmlFor="vf-send-amount">
            Amount
          </label>
          <input
            id="vf-send-amount"
            style={{ ...inputStyle, fontVariantNumeric: "tabular-nums" }}
            inputMode="decimal"
            value={values.amount}
            onChange={(e) => onChange({ ...values, amount: e.target.value })}
          />
        </div>
      </div>
      <div>
        <label style={labelStyle} htmlFor="vf-send-description">
          Description
        </label>
        <input
          id="vf-send-description"
          style={inputStyle}
          value={values.description}
          onChange={(e) => onChange({ ...values, description: e.target.value })}
        />
      </div>
      {issues.length > 0 ? (
        <ul
          role="alert"
          style={{
            margin: 0,
            paddingLeft: "var(--space-lg)",
            color: "var(--state-danger-fg)",
            fontSize: "var(--font-size-label)",
          }}
        >
          {issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      ) : null}
      <button type="submit" style={primaryButton}>
        Review transfer
      </button>
    </form>
  );
}

const primaryButton: CSSProperties = {
  border: "none",
  background: "var(--accent)",
  color: "var(--accent-fg)",
  borderRadius: "var(--radius-control)",
  padding: "var(--space-sm) var(--space-lg)",
  fontSize: "var(--font-size-body)",
  fontWeight: 500,
  cursor: "pointer",
  justifySelf: "start",
};

const quietButton: CSSProperties = {
  border: "var(--border-w-hairline) solid var(--border-strong)",
  background: "var(--surface-raised)",
  color: "var(--text-primary)",
  borderRadius: "var(--radius-control)",
  padding: "var(--space-sm) var(--space-lg)",
  fontSize: "var(--font-size-body)",
  fontWeight: 500,
  cursor: "pointer",
};

export function SendReview({
  draft,
  fee,
  onConfirm,
  onEdit,
  submitting,
}: {
  draft: TransferDraft;
  /** Fee amount when known; renders as an estimate row. */
  fee?: number;
  onConfirm: () => void;
  onEdit: () => void;
  submitting?: boolean;
}): ReactElement {
  const body = draft.body as { amount?: number; currency?: string; description?: string };
  const amount = body.amount ?? 0;
  const currency = draft.kind === "fiat" ? (body.currency ?? "") : "";
  const rows: LadderRow[] = fee
    ? [{ operator: "−", label: "Transfer fee", amount: fee, currency, uncertain: true }]
    : [];
  const net = fee ? amount - fee : amount;

  return (
    <div style={{ display: "grid", gap: "var(--space-md)", fontFamily: "var(--font-family)" }}>
      <ArithmeticLadder
        input={{ label: "You send", amount, currency }}
        rows={rows}
        total={{ label: "Recipient receives", amount: net, currency, uncertain: Boolean(fee) }}
      />
      <div style={{ display: "flex", gap: "var(--space-md)" }}>
        <button type="button" onClick={onConfirm} disabled={submitting} style={primaryButton}>
          {submitting ? "Sending…" : `Pay ${formatAmount(amount)} ${currency}`.trim()}
        </button>
        <button type="button" onClick={onEdit} disabled={submitting} style={quietButton}>
          Edit
        </button>
      </div>
    </div>
  );
}

export function transferProgressSteps(state: StagedTransferState): TimelineStep[] {
  const submitted = state.phase === "pending" || state.phase === "completed" || state.phase === "failed";
  return [
    { key: "staged", label: "Reviewed and confirmed", state: "completed" },
    {
      key: "submitted",
      label: "Submitted",
      state: submitted ? "completed" : "current",
    },
    {
      key: "settled",
      label:
        state.phase === "failed"
          ? (state.transfer?.errorMessage ?? "Transfer failed")
          : "Settled",
      state:
        state.phase === "completed"
          ? "completed"
          : state.phase === "failed"
            ? "failed"
            : state.phase === "pending"
              ? "current"
              : "future",
      meta: state.phase === "pending" ? "Usually under a minute in mock mode" : undefined,
    },
  ];
}

/** The full stage → review → confirm → track flow, bound to the machine. */
export function SendBlock({
  senderAccountId,
  defaultCurrency = "EUR",
  style,
  className,
}: {
  senderAccountId: string;
  defaultCurrency?: string;
  style?: CSSProperties;
  className?: string;
}): ReactElement {
  const { state, stage, edit, confirm, reset } = useStagedTransfer();
  const [values, setValues] = useState<SendFormValues>({
    receiverAccountId: "",
    currency: defaultCurrency,
    amount: "",
    description: "",
  });
  const [issues, setIssues] = useState<string[]>([]);

  const toDraft = (): TransferDraft => ({
    kind: "fiat",
    senderAccountId,
    body: {
      receiverAccountId: values.receiverAccountId,
      currency: values.currency,
      amount: Number(values.amount),
      description: values.description || undefined,
    },
  });

  return (
    <section className={className} style={{ maxWidth: "var(--card-max-width)", ...style }}>
      {state.phase === "draft" ? (
        <SendForm
          values={values}
          issues={issues.length > 0 ? issues : state.issues}
          onChange={setValues}
          onStage={() => {
            if (!values.amount || Number.isNaN(Number(values.amount))) {
              setIssues(["amount must be a number"]);
              return;
            }
            setIssues([]);
            stage(toDraft());
          }}
        />
      ) : null}
      {state.phase === "staged" || state.phase === "submitting" ? (
        <SendReview
          draft={state.staged.draft}
          onConfirm={() => void confirm()}
          onEdit={edit}
          submitting={state.phase === "submitting"}
        />
      ) : null}
      {state.phase === "pending" || state.phase === "completed" || state.phase === "failed" ? (
        <div style={{ display: "grid", gap: "var(--space-md)", fontFamily: "var(--font-family)" }}>
          <Timeline steps={transferProgressSteps(state)} />
          <button type="button" onClick={reset} style={quietButton}>
            New transfer
          </button>
        </div>
      ) : null}
    </section>
  );
}
