import type { CSSProperties, ReactElement } from "react";
import type { VirtualBankAccount } from "@venlyfinance/sdk";
import { useVirtualBankAccounts } from "@venlyfinance/react";
import { FieldList, type FieldRow } from "../components/field-list.js";

/**
 * Receive block – the surface a payer's finance team actually reads.
 *
 * Design contract encoded by this block:
 * - Mandatory-reference enforcement is the crux: an incoming payment
 *   without the reference code cannot be matched to this account. The
 *   reference row carries the amber Required pill; the warning callout
 *   sits ABOVE the field list, general advisories below it.
 * - Set-level actions (copy everything) sit above the card, before
 *   row-level copy.
 * - Rows the payer might expect are rendered in their "(not required)"
 *   variant rather than omitted – a conditionally-absent row is ambiguous.
 * - Copy confirmation names the field; surface onCopied to render it as a
 *   toast ("You copied your payment reference").
 */
export interface ReceiveBlockProps {
  virtualBankAccount: Pick<
    VirtualBankAccount,
    "name" | "iban" | "bic" | "bankName" | "beneficiaryName" | "referenceCode" | "currency"
  >;
  /** Called after any copy with the field name and value. */
  onCopied?: (field: string, value: string) => void;
  style?: CSSProperties;
  className?: string;
}

/** True only when the text actually reached the clipboard. */
async function copyText(value: string): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.clipboard) return false;
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

export function ReceiveBlock({
  virtualBankAccount: viba,
  onCopied,
  style,
  className,
}: ReceiveBlockProps): ReactElement {
  const fields: FieldRow[] = [
    { label: "Beneficiary", value: viba.beneficiaryName },
    { label: "IBAN", value: viba.iban, mono: true },
    { label: "BIC", value: viba.bic, mono: true },
    { label: "Bank", value: viba.bankName, copyable: false },
    { label: "Payment reference", value: viba.referenceCode, mono: true, required: true },
  ];

  // The confirmation only fires when the write actually landed: a toast
  // saying "copied" over an empty clipboard is worse than no toast.
  const copyAll = async () => {
    const text = fields
      .filter((f) => f.value)
      .map((f) => `${f.label}: ${f.value}`)
      .join("\n");
    if (await copyText(text)) onCopied?.("all payment details", text);
  };

  return (
    <section className={className} style={{ fontFamily: "var(--font-family)", maxWidth: "var(--card-max-width)", ...style }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginBottom: "var(--space-sm)",
        }}
      >
        <span style={{ fontSize: "var(--font-size-value)", fontWeight: 600, color: "var(--text-primary)" }}>
          Receive {viba.currency ?? ""}
        </span>
        <button
          type="button"
          onClick={copyAll}
          style={{
            border: "var(--border-w-hairline) solid var(--border-strong)",
            background: "var(--surface-raised)",
            borderRadius: "var(--radius-control)",
            padding: "var(--space-2xs) var(--space-md)",
            fontSize: "var(--font-size-label)",
            fontWeight: 500,
            color: "var(--text-primary)",
            cursor: "pointer",
          }}
        >
          Copy all
        </button>
      </div>

      <div
        role="alert"
        style={{
          background: "var(--state-pending-bg)",
          color: "var(--state-pending-fg)",
          borderRadius: "var(--radius-control)",
          padding: "var(--space-sm) var(--space-md)",
          fontSize: "var(--font-size-label)",
          marginBottom: "var(--space-sm)",
        }}
      >
        The payment reference must be included word for word – transfers without it cannot be
        matched to this account and will be held until claimed.
      </div>

      <FieldList
        fields={fields}
        onCopy={(label, value) => {
          void copyText(value).then((ok) => {
            if (ok) onCopied?.(label, value);
          });
        }}
      />

      <p
        style={{
          fontSize: "var(--font-size-micro)",
          color: "var(--text-tertiary)",
          marginTop: "var(--space-sm)",
        }}
      >
        SEPA transfers typically arrive the same business day; the first transfer from a new
        counterparty can take longer.
      </p>
    </section>
  );
}

/** Data-bound variant: first active virtual bank account of the account. */
export function ConnectedReceiveBlock({
  accountId,
  onCopied,
}: {
  accountId: string;
  onCopied?: ReceiveBlockProps["onCopied"];
}): ReactElement | null {
  const { data, isPending, isError } = useVirtualBankAccounts(accountId);
  const viba = data?.items[0];
  if (isPending) {
    return (
      <p style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-family)" }}>
        Loading account details…
      </p>
    );
  }
  if (isError || !viba) {
    return (
      <p style={{ color: "var(--text-secondary)", fontFamily: "var(--font-family)" }}>
        No virtual bank account yet – create one to receive bank transfers.
      </p>
    );
  }
  return <ReceiveBlock virtualBankAccount={viba} onCopied={onCopied} />;
}
