import { useMemo, useState, type CSSProperties, type ReactElement } from "react";
import type { FundflowComponents } from "@venlyfinance/sdk";
import {
  useBankAccountConfig,
  useCompanyBankAccounts,
  useCreateCompanyBankAccount,
} from "@venlyfinance/react";
import { DataTable, RowText, type DataTableColumn } from "../components/data-table.js";
import { StatusPill, type StatusIntent } from "../components/status-pill.js";

/**
 * Bank accounts block – the whitelisting surface withdrawals depend on.
 *
 * What the API models, and therefore what this block renders: a company
 * whitelists its OWN bank accounts (the account holder's legal name, never
 * a third-party payee), each account is verified out-of-band before it can
 * receive withdrawals, and seven account-type variants carry different
 * identifier fields. The list schema carries no account identifier at all –
 * rows are identified by the label you give them; the full identifier lives
 * on the detail record only.
 *
 * Design contract encoded by this block:
 * - Verification status is word + glyph, rendered from the field verbatim:
 *   In review / Verified / Declined.
 * - The add form asks exactly the fields the chosen variant requires –
 *   nothing generic, nothing missing – and confirms the account identifier
 *   by re-entry (transcription risk is real; the API won't catch a typo'd
 *   IBAN that happens to be valid).
 * - The own-name constraint is stated at the field, not discovered at
 *   submit.
 */

type fundflow = FundflowComponents["schemas"];
export type CompanyBankAccountListItem = fundflow["CompanyBankAccountListItem"];
export type BankAccountType = NonNullable<CompanyBankAccountListItem["bankAccountType"]>;

// ── Status + label maps (field values verbatim → UI labels, once) ──────

export const BANK_ACCOUNT_STATUS_PILL: Record<string, { label: string; intent: StatusIntent }> = {
  PENDING: { label: "In review", intent: "pending" },
  VERIFIED: { label: "Verified", intent: "positive" },
  DENIED: { label: "Declined", intent: "negative" },
};

const RAIL_LABEL: Record<string, string> = {
  ON_RAMP: "Adding money",
  OFF_RAMP: "Withdrawals",
  ON_AND_OFF_RAMP: "Adding money + withdrawals",
};

const TYPE_LABEL: Record<string, string> = {
  EUR_SEPA: "EUR · SEPA",
  GBP_FPS: "GBP · Faster Payments",
  GBP_CHAPS: "GBP · CHAPS",
  USD_ACH: "USD · ACH",
  USD_WIRE: "USD · Wire",
  USD_SWIFT: "USD · SWIFT",
  OTHER_SWIFT: "SWIFT (other currency)",
};

// ── Shared styling ─────────────────────────────────────────────────────

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

const helperStyle: CSSProperties = {
  margin: "0 0 var(--space-2xs)",
  fontSize: "var(--font-size-micro)",
  color: "var(--text-tertiary)",
};

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

function Field({
  id,
  label,
  helper,
  value,
  onChange,
  required = true,
}: {
  id: string;
  label: string;
  helper?: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
}): ReactElement {
  return (
    <div>
      <label style={labelStyle} htmlFor={id}>
        {label}
        {required ? "" : " (optional)"}
      </label>
      {helper ? <p style={helperStyle}>{helper}</p> : null}
      <input
        id={id}
        type="text"
        required={required}
        style={inputStyle}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

// ── Per-variant field model (spec-exact) ───────────────────────────────

/** The identifier field per variant – the one worth re-entering. */
const IDENTIFIER_FIELD: Record<string, { key: string; label: string }> = {
  EUR_SEPA: { key: "iban", label: "IBAN" },
  GBP_FPS: { key: "accountNumber", label: "Account number" },
  GBP_CHAPS: { key: "accountNumber", label: "Account number" },
  USD_ACH: { key: "accountNumber", label: "Account number" },
  USD_WIRE: { key: "accountNumber", label: "Account number" },
  USD_SWIFT: { key: "accountNumber", label: "Account number" },
  // OTHER_SWIFT resolves dynamically: whichever of accountNumber/iban is filled.
};

interface VariantField {
  key: string;
  label: string;
  required: boolean;
  helper?: string;
}

/** Variant-specific fields, exactly the ones the create schema declares. */
const VARIANT_FIELDS: Record<string, VariantField[]> = {
  EUR_SEPA: [
    { key: "iban", label: "IBAN", required: true },
    { key: "bic", label: "BIC", required: false },
  ],
  GBP_FPS: [
    { key: "accountNumber", label: "Account number", required: true },
    { key: "sortCode", label: "Sort code", required: true },
  ],
  GBP_CHAPS: [
    { key: "accountNumber", label: "Account number", required: true },
    { key: "sortCode", label: "Sort code", required: true },
  ],
  USD_ACH: [
    { key: "accountNumber", label: "Account number", required: true },
    { key: "routingNumber", label: "Routing number", required: true },
    { key: "email", label: "Beneficiary email", required: true },
    { key: "beneficiaryState", label: "State", required: true },
  ],
  USD_WIRE: [
    { key: "accountNumber", label: "Account number", required: true },
    { key: "routingNumber", label: "Routing number", required: true },
    { key: "email", label: "Beneficiary email", required: true },
    { key: "beneficiaryState", label: "State", required: true },
  ],
  USD_SWIFT: [
    { key: "bic", label: "BIC", required: true },
    { key: "accountNumber", label: "Account number", required: true },
    { key: "bankStreetAddress", label: "Bank street address", required: true },
    { key: "bankCity", label: "Bank city", required: true },
    { key: "bankPostalCode", label: "Bank postal code", required: true },
    { key: "beneficiaryState", label: "State", required: true },
  ],
  OTHER_SWIFT: [
    { key: "currency", label: "Currency (three-letter code)", required: true },
    { key: "bic", label: "BIC", required: true },
    {
      key: "accountNumber",
      label: "Account number",
      required: false,
      helper: "Provide the account number or the IBAN below – one of the two is required.",
    },
    {
      key: "iban",
      label: "IBAN",
      required: false,
      helper: "Provide the IBAN or the account number above – one of the two is required.",
    },
  ],
};

// ── Add form ───────────────────────────────────────────────────────────

export interface AddBankAccountFormProps {
  onCreated: (account: { id?: string; name?: string }) => void;
  onCancel?: () => void;
  style?: CSSProperties;
  className?: string;
}

export function AddBankAccountForm({
  onCreated,
  onCancel,
  style,
  className,
}: AddBankAccountFormProps): ReactElement {
  const { data: config } = useBankAccountConfig();
  const create = useCreateCompanyBankAccount();
  const [accountType, setAccountType] = useState<string>("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [confirmIdentifier, setConfirmIdentifier] = useState("");
  const [error, setError] = useState<string | null>(null);

  const enabledTypes = useMemo(
    () => (config?.enabledAccountTypes ?? []).filter((t) => t.type),
    [config],
  );
  const effectiveType = accountType || enabledTypes[0]?.type || "";
  const identifier =
    effectiveType === "OTHER_SWIFT"
      ? values.iban && !values.accountNumber
        ? { key: "iban", label: "IBAN" }
        : values.accountNumber
          ? { key: "accountNumber", label: "Account number" }
          : undefined
      : IDENTIFIER_FIELD[effectiveType];
  const set = (key: string) => (v: string) => setValues((prev) => ({ ...prev, [key]: v }));

  const submit = (): void => {
    setError(null);
    if (effectiveType === "OTHER_SWIFT" && !values.accountNumber && !values.iban) {
      setError("Provide the account number or the IBAN – one of the two is required.");
      return;
    }
    if (identifier && (values[identifier.key] ?? "") !== confirmIdentifier) {
      setError("These account numbers don't match.");
      return;
    }
    const body = {
      bankAccountType: effectiveType,
      name: values.name,
      bankName: values.bankName,
      companyName: values.companyName,
      bankCountry: values.bankCountry,
      beneficiaryAddressLine1: values.beneficiaryAddressLine1,
      beneficiaryAddressLine2: values.beneficiaryAddressLine2 || undefined,
      beneficiaryCity: values.beneficiaryCity,
      beneficiaryPostalCode: values.beneficiaryPostalCode,
      beneficiaryCountry: values.beneficiaryCountry,
      supportedRampType: values.supportedRampType || "OFF_RAMP",
      ...Object.fromEntries(
        (VARIANT_FIELDS[effectiveType] ?? [])
          .map((f) => [f.key, values[f.key]])
          .filter(([, v]) => v !== undefined && v !== ""),
      ),
    };
    create.mutate(body as Parameters<typeof create.mutate>[0], {
      onError: (e) => setError(e.message),
      onSuccess: (account) => onCreated(account as { id?: string; name?: string }),
    });
  };

  return (
    <form
      className={className}
      style={{
        maxWidth: "var(--form-max-width)",
        fontFamily: "var(--font-family)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-lg)",
        ...style,
      }}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <h2 style={{ margin: 0, fontSize: "var(--font-size-value)", fontWeight: 600, color: "var(--text-primary)" }}>
        Add a bank account
      </h2>

      <div>
        <label style={labelStyle} htmlFor="vf-ba-type">
          Account type
        </label>
        <select
          id="vf-ba-type"
          style={{ ...inputStyle, cursor: "pointer" }}
          value={effectiveType}
          onChange={(e) => {
            setAccountType(e.target.value);
            setConfirmIdentifier("");
          }}
        >
          {enabledTypes.map((t) => (
            <option key={t.type} value={t.type}>
              {TYPE_LABEL[t.type ?? ""] ?? t.type} {t.description ? `– ${t.description}` : ""}
            </option>
          ))}
        </select>
      </div>

      <Field id="vf-ba-name" label="Label" helper="How this account appears in your lists." value={values.name ?? ""} onChange={set("name")} />
      <Field
        id="vf-ba-company"
        label="Account holder (your company's legal name)"
        helper="The account must be in your company's name – withdrawals to third parties aren't supported yet."
        value={values.companyName ?? ""}
        onChange={set("companyName")}
      />
      <Field id="vf-ba-bank" label="Bank name" value={values.bankName ?? ""} onChange={set("bankName")} />
      <Field id="vf-ba-country" label="Bank country (two-letter code)" value={values.bankCountry ?? ""} onChange={set("bankCountry")} />

      {(VARIANT_FIELDS[effectiveType] ?? []).map((f) => (
        <Field key={f.key} id={`vf-ba-${f.key}`} label={f.label} helper={f.helper} required={f.required} value={values[f.key] ?? ""} onChange={set(f.key)} />
      ))}
      {identifier ? (
        <Field
          id="vf-ba-confirm"
          label={`Re-enter ${identifier.label.toLowerCase()}`}
          helper="Typed twice on purpose – a mistyped identifier sends money to the wrong place."
          value={confirmIdentifier}
          onChange={setConfirmIdentifier}
        />
      ) : null}

      <h3 style={{ margin: 0, fontSize: "var(--font-size-label)", fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
        Beneficiary address
      </h3>
      <Field id="vf-ba-addr1" label="Street address" value={values.beneficiaryAddressLine1 ?? ""} onChange={set("beneficiaryAddressLine1")} />
      <div style={{ display: "flex", gap: "var(--space-md)" }}>
        <div style={{ flex: 1 }}>
          <Field id="vf-ba-postal" label="Postal code" value={values.beneficiaryPostalCode ?? ""} onChange={set("beneficiaryPostalCode")} />
        </div>
        <div style={{ flex: 2 }}>
          <Field id="vf-ba-city" label="City" value={values.beneficiaryCity ?? ""} onChange={set("beneficiaryCity")} />
        </div>
      </div>
      <Field id="vf-ba-bcountry" label="Country (two-letter code)" value={values.beneficiaryCountry ?? ""} onChange={set("beneficiaryCountry")} />

      <div>
        <label style={labelStyle} htmlFor="vf-ba-rail">
          Used for
        </label>
        <select
          id="vf-ba-rail"
          style={{ ...inputStyle, cursor: "pointer" }}
          value={values.supportedRampType ?? "OFF_RAMP"}
          onChange={(e) => set("supportedRampType")(e.target.value)}
        >
          {Object.entries(RAIL_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {error ? (
        <p role="alert" style={{ margin: 0, fontSize: "var(--font-size-label)", color: "var(--state-danger-fg)" }}>
          {error}
        </p>
      ) : null}
      <p style={{ margin: 0, fontSize: "var(--font-size-label)", color: "var(--text-secondary)" }}>
        New accounts are verified before they can receive withdrawals.
      </p>
      <div style={{ display: "flex", gap: "var(--space-sm)" }}>
        <button type="submit" disabled={create.isPending} style={primaryButton}>
          {create.isPending ? "Adding…" : "Add bank account"}
        </button>
        {onCancel ? (
          <button type="button" style={quietButton} onClick={onCancel}>
            Cancel
          </button>
        ) : null}
      </div>
    </form>
  );
}

// ── List ───────────────────────────────────────────────────────────────

export interface BankAccountsViewProps {
  accounts: CompanyBankAccountListItem[];
  onAdd?: () => void;
  style?: CSSProperties;
  className?: string;
}

/** Presentational half: the whitelist over already-loaded rows. */
export function BankAccountsView({ accounts, onAdd, style, className }: BankAccountsViewProps): ReactElement {
  const columns: DataTableColumn<CompanyBankAccountListItem>[] = [
    {
      key: "account",
      header: "Account",
      cell: (a) => <RowText primary={a.name ?? "—"} secondary={a.bankName ?? undefined} />,
    },
    {
      key: "type",
      header: "Type",
      cell: (a) => (
        <span style={{ fontSize: "var(--font-size-label)", color: "var(--text-secondary)" }}>
          {TYPE_LABEL[a.bankAccountType ?? ""] ?? a.bankAccountType ?? "—"}
        </span>
      ),
    },
    {
      key: "country",
      header: "Country",
      cell: (a) => (
        <span style={{ fontSize: "var(--font-size-label)", color: "var(--text-secondary)" }}>
          {a.bankCountry ?? "—"}
        </span>
      ),
    },
    {
      key: "rail",
      header: "Used for",
      cell: (a) => (
        <span style={{ fontSize: "var(--font-size-label)", color: "var(--text-secondary)" }}>
          {RAIL_LABEL[a.supportedRampType ?? ""] ?? a.supportedRampType ?? "—"}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (a) => {
        const pill = BANK_ACCOUNT_STATUS_PILL[a.verificationStatus ?? ""];
        return pill ? <StatusPill {...pill} /> : <span style={{ color: "var(--text-tertiary)" }}>—</span>;
      },
    },
  ];

  return (
    <section className={className} style={{ fontFamily: "var(--font-family)", ...style }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-lg)", gap: "var(--space-lg)" }}>
        <h2 style={{ margin: 0, fontSize: "var(--font-size-value)", fontWeight: 600, color: "var(--text-primary)" }}>
          Bank accounts
        </h2>
        {onAdd ? (
          <button type="button" style={primaryButton} onClick={onAdd}>
            Add a bank account
          </button>
        ) : null}
      </div>
      {accounts.length === 0 ? (
        <p style={{ margin: 0, color: "var(--text-secondary)", fontSize: "var(--font-size-body)" }}>
          No bank accounts yet. Add one to withdraw funds.
        </p>
      ) : (
        <div
          style={{
            background: "var(--surface-raised)",
            border: "var(--border-w-hairline) solid var(--border-hairline)",
            borderRadius: "var(--radius-card)",
            overflow: "hidden",
          }}
        >
          <DataTable columns={columns} rows={accounts} rowKey={(a) => a.id ?? a.name ?? ""} />
        </div>
      )}
    </section>
  );
}

/** Connected block: list + add-form toggle over the live whitelist. */
export function BankAccountsBlock({ style, className }: { style?: CSSProperties; className?: string }): ReactElement {
  const { data, isPending } = useCompanyBankAccounts();
  const [adding, setAdding] = useState(false);
  const [announce, setAnnounce] = useState<string | null>(null);

  if (isPending) {
    return (
      <section className={className} style={{ fontFamily: "var(--font-family)", ...style }}>
        <p style={{ color: "var(--text-tertiary)", fontSize: "var(--font-size-body)" }}>Loading bank accounts…</p>
      </section>
    );
  }

  if (adding) {
    return (
      <AddBankAccountForm
        className={className}
        style={style}
        onCancel={() => setAdding(false)}
        onCreated={(account) => {
          setAdding(false);
          setAnnounce(`${account.name ?? "Bank account"} added – verification is in review.`);
        }}
      />
    );
  }

  return (
    <div>
      {announce ? (
        <p role="status" style={{ margin: "0 0 var(--space-md)", fontFamily: "var(--font-family)", fontSize: "var(--font-size-label)", color: "var(--text-primary)" }}>
          {announce}
        </p>
      ) : null}
      <BankAccountsView className={className} style={style} accounts={data?.items ?? []} onAdd={() => setAdding(true)} />
    </div>
  );
}
