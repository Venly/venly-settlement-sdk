import { useMemo, useState, type CSSProperties, type ReactElement } from "react";
import type { Party, Account } from "@venlyfinance/sdk";
import { useAccount, useCreateAccount, useCreateParty, useParty } from "@venlyfinance/react";
import { StatusPill, type StatusIntent } from "../components/status-pill.js";
import { Timeline, type TimelineStep } from "../components/timeline.js";
import { FieldList } from "../components/field-list.js";

/**
 * Onboarding block – company details in, an application status out.
 *
 * What the API actually carries, and therefore what this block renders:
 * creating the organisation (`POST /parties`) and its account
 * (`POST /accounts`) starts verification; from then on the API reports one
 * application-level status per record (`Party.kybStatus`,
 * `Account.kycStatus`). There is no endpoint to submit documents, advance
 * verification, or read per-requirement progress – so this block renders
 * the literal status humanely and never invents a step it can't observe.
 *
 * Design contract encoded by this block:
 * - Statuses come from the API's fields verbatim; the UI label map is
 *   applied once, here. There is no path to a "Verified" badge that the
 *   API didn't report.
 * - The waiting state answers the operator's four questions: must I act,
 *   who has it, how long, and what still works. Where the API publishes no
 *   review window, the copy says so instead of inventing an SLA.
 * - A decline is humane: it names the organisation, offers a review as the
 *   primary action, and invents no reasons – the API carries none.
 * - Re-verification on a live account is a banner naming the consequence
 *   and what keeps working, never a lockout.
 */

// ── Status label maps (API enums verbatim → UI labels, mapped once) ────

const KYB_PILL: Record<string, { label: string; intent: StatusIntent }> = {
  PENDING: { label: "In review", intent: "pending" },
  VERIFIED: { label: "Verified", intent: "positive" },
  DENIED: { label: "Declined", intent: "negative" },
};

const KYC_PILL: Record<string, { label: string; intent: StatusIntent }> = {
  VERIFICATION_PENDING: { label: "In review", intent: "pending" },
  VERIFIED: { label: "Verified", intent: "positive" },
  REJECTED: { label: "Declined", intent: "negative" },
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

const sectionHeading: CSSProperties = {
  margin: 0,
  fontSize: "var(--font-size-label)",
  fontWeight: 600,
  color: "var(--text-secondary)",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
};

// ── Company form ───────────────────────────────────────────────────────

export interface CompanyFormValues {
  name: string;
  vatNumber: string;
  addressLine1: string;
  city: string;
  postalCode: string;
  country: string;
}

export interface CompanyFormProps {
  /** Pre-fill from sign-up (the session already knows the company name). */
  initialName?: string;
  /** Chain the auto-provisioned wallet lives on. */
  chain?: "AVALANCHE" | "BASE" | "POLYGON";
  /** Your identifier for the account; defaults to one derived from the name. */
  accountExternalId?: string;
  onCreated: (ids: { partyId: string; accountId: string }) => void;
  style?: CSSProperties;
  className?: string;
}

/**
 * Single page, two sections, review before submit. Submit creates the
 * ORGANISATION party, then the account (which auto-provisions the
 * custodial wallet) – verification starts as a side effect.
 */
export function CompanyForm({
  initialName,
  chain = "BASE",
  accountExternalId,
  onCreated,
  style,
  className,
}: CompanyFormProps): ReactElement {
  const [values, setValues] = useState<CompanyFormValues>({
    name: initialName ?? "",
    vatNumber: "",
    addressLine1: "",
    city: "",
    postalCode: "",
    country: "",
  });
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const createParty = useCreateParty();
  const createAccount = useCreateAccount();
  const submitting = createParty.isPending || createAccount.isPending;

  const set = (key: keyof CompanyFormValues) => (v: string) =>
    setValues((prev) => ({ ...prev, [key]: v }));

  const hasAddress = values.addressLine1 || values.city || values.postalCode || values.country;

  const submit = (): void => {
    setError(null);
    const externalId =
      accountExternalId ??
      `acct-${values.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")}`;
    createParty.mutate(
      {
        partyType: "ORGANISATION",
        name: values.name,
        vatNumber: values.vatNumber || undefined,
        address: hasAddress
          ? {
              addressLine1: values.addressLine1 || undefined,
              city: values.city || undefined,
              postalCode: values.postalCode || undefined,
              country: values.country || undefined,
            }
          : undefined,
      },
      {
        onError: (e) => setError(e.message),
        onSuccess: (party) => {
          createAccount.mutate(
            {
              externalId,
              chain,
              name: `${values.name} – Main`,
              partyId: party.id,
            },
            {
              onError: (e) => setError(e.message),
              onSuccess: (account) =>
                onCreated({ partyId: party.id as string, accountId: account.id as string }),
            },
          );
        },
      },
    );
  };

  if (reviewing) {
    return (
      <section
        className={className}
        style={{
          maxWidth: "var(--form-max-width)",
          fontFamily: "var(--font-family)",
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-lg)",
          ...style,
        }}
      >
        <h1 style={{ margin: 0, fontSize: "var(--font-size-value)", fontWeight: 600, color: "var(--text-primary)" }}>
          Review your details
        </h1>
        <div
          style={{
            background: "var(--surface-raised)",
            border: "var(--border-w-hairline) solid var(--border-hairline)",
            borderRadius: "var(--radius-card)",
            padding: "var(--card-pad)",
          }}
        >
          <FieldList
            fields={[
              { label: "Company name", value: values.name, copyable: false },
              {
                label: "VAT number",
                value: values.vatNumber || "Not provided",
                copyable: false,
                mono: Boolean(values.vatNumber),
              },
              {
                label: "Address",
                value: hasAddress
                  ? [values.addressLine1, values.postalCode, values.city, values.country]
                      .filter(Boolean)
                      .join(", ")
                  : "Not provided",
                copyable: false,
              },
            ]}
          />
        </div>
        {error ? (
          <p role="alert" style={{ margin: 0, fontSize: "var(--font-size-label)", color: "var(--state-danger-fg)" }}>
            {error}
          </p>
        ) : null}
        <div style={{ display: "flex", gap: "var(--space-sm)" }}>
          <button type="button" style={primaryButton} disabled={submitting} onClick={submit}>
            {submitting ? "Submitting…" : "Submit application"}
          </button>
          <button type="button" style={quietButton} disabled={submitting} onClick={() => setReviewing(false)}>
            Edit
          </button>
        </div>
      </section>
    );
  }

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
        setReviewing(true);
      }}
    >
      <h1 style={{ margin: 0, fontSize: "var(--font-size-value)", fontWeight: 600, color: "var(--text-primary)" }}>
        Tell us about your company
      </h1>
      <h2 style={sectionHeading}>Company</h2>
      <div>
        <label style={labelStyle} htmlFor="vf-onb-name">
          Company name
        </label>
        <input
          id="vf-onb-name"
          type="text"
          required
          style={inputStyle}
          value={values.name}
          onChange={(e) => set("name")(e.target.value)}
        />
      </div>
      <div>
        <label style={labelStyle} htmlFor="vf-onb-vat">
          VAT number (optional)
        </label>
        <input
          id="vf-onb-vat"
          type="text"
          style={inputStyle}
          value={values.vatNumber}
          onChange={(e) => set("vatNumber")(e.target.value)}
        />
      </div>
      <h2 style={sectionHeading}>Registered address (optional)</h2>
      <div>
        <label style={labelStyle} htmlFor="vf-onb-address">
          Street address
        </label>
        <input
          id="vf-onb-address"
          type="text"
          style={inputStyle}
          value={values.addressLine1}
          onChange={(e) => set("addressLine1")(e.target.value)}
        />
      </div>
      <div style={{ display: "flex", gap: "var(--space-md)" }}>
        <div style={{ flex: 1 }}>
          <label style={labelStyle} htmlFor="vf-onb-postal">
            Postal code
          </label>
          <input
            id="vf-onb-postal"
            type="text"
            style={inputStyle}
            value={values.postalCode}
            onChange={(e) => set("postalCode")(e.target.value)}
          />
        </div>
        <div style={{ flex: 2 }}>
          <label style={labelStyle} htmlFor="vf-onb-city">
            City
          </label>
          <input
            id="vf-onb-city"
            type="text"
            style={inputStyle}
            value={values.city}
            onChange={(e) => set("city")(e.target.value)}
          />
        </div>
      </div>
      <div>
        <label style={labelStyle} htmlFor="vf-onb-country">
          Country (two-letter code)
        </label>
        <input
          id="vf-onb-country"
          type="text"
          maxLength={2}
          style={{ ...inputStyle, textTransform: "uppercase" }}
          value={values.country}
          onChange={(e) => set("country")(e.target.value.toUpperCase())}
        />
      </div>
      <button type="submit" style={{ ...primaryButton, alignSelf: "start" }}>
        Continue
      </button>
    </form>
  );
}

// ── Verification status home ───────────────────────────────────────────

export type VerificationOutcome = "in-review" | "verified" | "declined";

/** The gate derivation the shell shares: both records report VERIFIED. */
export function verificationOutcome(party?: Party, account?: Account): VerificationOutcome {
  if (party?.kybStatus === "DENIED" || account?.kycStatus === "REJECTED") return "declined";
  if (party?.kybStatus === "VERIFIED" && account?.kycStatus === "VERIFIED") return "verified";
  return "in-review";
}

export interface VerificationStatusViewProps {
  party?: Party;
  account?: Account;
  /** Where status-change notice goes – echoed in the waiting copy. */
  email: string;
  /** Primary action on the declined state; opens your support channel. */
  onAskForReview?: () => void;
  /** The verified state's forward action ("Go to your account"). */
  onContinue?: () => void;
  style?: CSSProperties;
  className?: string;
}

/** Presentational half: the status page over already-loaded records. */
export function VerificationStatusView({
  party,
  account,
  email,
  onAskForReview,
  onContinue,
  style,
  className,
}: VerificationStatusViewProps): ReactElement {
  const outcome = verificationOutcome(party, account);

  const steps: TimelineStep[] = useMemo(() => {
    if (outcome === "verified") {
      return [
        { key: "submitted", label: "Submitted", state: "completed" },
        { key: "review", label: "In review", state: "completed" },
        { key: "ready", label: "Ready", state: "completed" },
      ];
    }
    if (outcome === "declined") {
      return [
        { key: "submitted", label: "Submitted", state: "completed" },
        { key: "review", label: "In review", state: "completed" },
        { key: "ready", label: "Declined", state: "failed" },
      ];
    }
    return [
      { key: "submitted", label: "Submitted", state: "completed" },
      { key: "review", label: "In review", state: "current" },
      { key: "ready", label: "Ready", state: "future" },
    ];
  }, [outcome]);

  const kybPill = party?.kybStatus ? KYB_PILL[party.kybStatus] : undefined;
  const kycPill = account?.kycStatus ? KYC_PILL[account.kycStatus] : undefined;
  const companyName = party?.name ?? "your company";

  return (
    <section
      className={className}
      style={{
        maxWidth: "var(--form-max-width)",
        fontFamily: "var(--font-family)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-xl)",
        ...style,
      }}
    >
      <Timeline steps={steps} />

      {outcome === "declined" ? (
        <div
          style={{
            background: "var(--surface-raised)",
            border: "var(--border-w-hairline) solid var(--border-hairline)",
            borderRadius: "var(--radius-card)",
            padding: "var(--card-pad)",
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-md)",
          }}
        >
          <h1 style={{ margin: 0, fontSize: "var(--font-size-value)", fontWeight: 600, color: "var(--text-primary)" }}>
            We couldn't verify {companyName} based on the information provided.
          </h1>
          <p style={{ margin: 0, fontSize: "var(--font-size-body)", color: "var(--text-secondary)" }}>
            Ask for a review and we'll take another look.
          </p>
          {onAskForReview ? (
            <button type="button" style={{ ...primaryButton, alignSelf: "start" }} onClick={onAskForReview}>
              Ask for a review
            </button>
          ) : null}
        </div>
      ) : outcome === "verified" ? (
        <div
          style={{
            background: "var(--surface-raised)",
            border: "var(--border-w-hairline) solid var(--border-hairline)",
            borderRadius: "var(--radius-card)",
            padding: "var(--card-pad)",
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-md)",
          }}
        >
          <h1 style={{ margin: 0, fontSize: "var(--font-size-value)", fontWeight: 600, color: "var(--text-primary)" }}>
            {companyName} is verified.
          </h1>
          {onContinue ? (
            <button type="button" style={{ ...primaryButton, alignSelf: "start" }} onClick={onContinue}>
              Go to your account
            </button>
          ) : null}
        </div>
      ) : (
        <div
          style={{
            background: "var(--surface-raised)",
            border: "var(--border-w-hairline) solid var(--border-hairline)",
            borderRadius: "var(--radius-card)",
            padding: "var(--card-pad)",
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-md)",
          }}
        >
          <h1 style={{ margin: 0, fontSize: "var(--font-size-value)", fontWeight: 600, color: "var(--text-primary)" }}>
            Your application is in review.
          </h1>
          <p style={{ margin: 0, fontSize: "var(--font-size-body)", color: "var(--text-secondary)" }}>
            Nothing is needed from you right now. We don't have a fixed review window to share
            yet – we'll email {email} the moment your status changes.
          </p>
          <p style={{ margin: 0, fontSize: "var(--font-size-body)", color: "var(--text-secondary)" }}>
            While you wait: explore the app · prepare your first recipients · your account
            details for receiving arrive once you're verified.
          </p>
        </div>
      )}

      <div
        style={{
          background: "var(--surface-raised)",
          border: "var(--border-w-hairline) solid var(--border-hairline)",
          borderRadius: "var(--radius-card)",
          padding: "var(--card-pad)",
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-md)",
        }}
      >
        <h2 style={sectionHeading}>Application status</h2>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: "var(--font-size-body)", color: "var(--text-primary)" }}>
            Business verification
          </span>
          {kybPill ? <StatusPill {...kybPill} /> : <span style={{ color: "var(--text-tertiary)" }}>—</span>}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: "var(--font-size-body)", color: "var(--text-primary)" }}>
            Account verification
          </span>
          {kycPill ? <StatusPill {...kycPill} /> : <span style={{ color: "var(--text-tertiary)" }}>—</span>}
        </div>
      </div>
    </section>
  );
}

export interface VerificationStatusHomeProps
  extends Omit<VerificationStatusViewProps, "party" | "account"> {
  partyId: string;
  accountId: string;
  /** Status poll interval; the page watches for the decision. */
  pollIntervalMs?: number;
}

/** Connected block: literal party + account statuses, polled for changes. */
export function VerificationStatusHome({
  partyId,
  accountId,
  pollIntervalMs = 2000,
  ...viewProps
}: VerificationStatusHomeProps): ReactElement {
  const { data: party } = useParty(partyId, { refetchInterval: pollIntervalMs });
  const { data: account } = useAccount(accountId, { refetchInterval: pollIntervalMs });
  return <VerificationStatusView party={party} account={account} {...viewProps} />;
}

// ── Restricted banner ──────────────────────────────────────────────────

export interface RestrictedBannerProps {
  companyName: string;
  /**
   * "unverified": first-time verification still in review.
   * "reverification": a live, previously verified account flipped back to
   * in-review – the banner names the consequence and what keeps working.
   */
  variant: "unverified" | "reverification";
  /** Link back to the status page. */
  onViewStatus?: () => void;
  style?: CSSProperties;
  className?: string;
}

export function RestrictedBanner({
  companyName,
  variant,
  onViewStatus,
  style,
  className,
}: RestrictedBannerProps): ReactElement {
  return (
    <div
      role="status"
      className={className}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "var(--space-lg)",
        background: "var(--state-pending-bg)",
        border: "var(--border-w-hairline) solid var(--border-hairline)",
        borderRadius: "var(--radius-card)",
        padding: "var(--space-md) var(--space-lg)",
        fontFamily: "var(--font-family)",
        fontSize: "var(--font-size-body)",
        color: "var(--state-pending-fg)",
        ...style,
      }}
    >
      <span>
        {variant === "reverification"
          ? `We need updated details for ${companyName}. Money movement pauses until this is done – everything else keeps working.`
          : `${companyName}'s application is in review. Money movement and your account details for receiving unlock once you're verified – everything else keeps working.`}
      </span>
      {onViewStatus ? (
        <button
          type="button"
          onClick={onViewStatus}
          style={{
            border: "var(--border-w-hairline) solid var(--border-strong)",
            background: "var(--surface-raised)",
            color: "var(--text-primary)",
            borderRadius: "var(--radius-control)",
            padding: "var(--space-2xs) var(--space-sm)",
            fontSize: "var(--font-size-label)",
            fontFamily: "var(--font-family)",
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          View status
        </button>
      ) : null}
    </div>
  );
}
