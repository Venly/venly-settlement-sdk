import { useMemo, useState, useSyncExternalStore, type CSSProperties, type ReactElement } from "react";
import { useQueries } from "@tanstack/react-query";
import type { Party, PayoutBankAccount, PayoutRoute } from "@venlyfinance/sdk";
import {
  useAccountSupportedAssets,
  useAddPartyRole,
  useCompletePayoutOwnershipProof,
  useCreateParty,
  useCreatePayoutRoute,
  usePartyRoles,
  usePayoutRoutes,
  usePreparePayoutOwnershipProof,
  useRegisterPayoutBankAccount,
  useVenly,
  venlyQueries,
} from "@venlyfinance/react";
import { DataTable, RowText, type DataTableColumn } from "../components/data-table.js";
import { StatusPill, type StatusIntent } from "../components/status-pill.js";
import { FieldList, type FieldRow } from "../components/field-list.js";
import { ListLoadError } from "../components/list-error.js";

/**
 * Recipients block - the prerequisite surface for third-party payouts.
 *
 * The object model is two levels deep, and payments reference a ROUTE:
 * a recipient is a PARTY holding the PAYOUT_RECIPIENT role on your account;
 * the recipient owns beneficiary BANK ACCOUNTS (registered, reviewed,
 * details masked server-side); a payout ROUTE binds one bank account to
 * your account and a deposit asset, and activates only after the funding
 * wallet proves ownership by signing a server-issued message.
 *
 * Design contract encoded by this block:
 * - Every route state renders - the machine is shown, never hidden. A
 *   REJECTED route is terminal-negative with a way forward, not a dead end.
 * - Bank-account details come back MASKED (last4); render them, never
 *   re-ask for the full number.
 * - Rows that cannot be used yet are disabled WITH the reason.
 * - No claim is made about how long review takes - no such field exists.
 */

// ── Session route links (the join the wire does not carry) ─────────────

/**
 * The payout-route list read carries no route -> bank-account key; the only
 * moment the pairing is known is route CREATION, whose request names both.
 * This session-scoped registry captures that pairing so recipient rows can
 * render their route state. Identity renders only where the pairing is
 * known - nothing is guessed for routes this session did not create.
 */
const routeLinkMap = new Map<string, string>();
const routeLinkListeners = new Set<() => void>();
let routeLinkVersion = 0;

export const payoutRouteLinks = {
  record(routeId: string, payoutBankAccountId: string): void {
    routeLinkMap.set(routeId, payoutBankAccountId);
    routeLinkVersion++;
    for (const listener of routeLinkListeners) listener();
  },
  bankAccountFor(routeId: string): string | undefined {
    return routeLinkMap.get(routeId);
  },
  subscribe(listener: () => void): () => void {
    routeLinkListeners.add(listener);
    return () => routeLinkListeners.delete(listener);
  },
  version(): number {
    return routeLinkVersion;
  },
};

function useRouteLinkVersion(): number {
  return useSyncExternalStore(payoutRouteLinks.subscribe, payoutRouteLinks.version, payoutRouteLinks.version);
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

const labelStyle: CSSProperties = {
  display: "block",
  fontSize: "var(--font-size-label)",
  color: "var(--text-secondary)",
  marginBottom: "var(--space-2xs)",
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

// ── Vocabulary (verbatim status -> word + intent) ──────────────────────

export const RECIPIENT_ROLE_STATUS_PILL: Record<string, { label: string; intent: StatusIntent }> = {
  ACTIVE: { label: "Active", intent: "positive" },
  INACTIVE: { label: "Inactive", intent: "neutral" },
};

export const BENEFICIARY_ACCOUNT_STATUS_PILL: Record<string, { label: string; intent: StatusIntent }> = {
  PENDING: { label: "In review", intent: "pending" },
  ACTIVE: { label: "Active", intent: "positive" },
  DISABLED: { label: "Disabled", intent: "neutral" },
};

export const ROUTE_STATUS_PILL: Record<string, { label: string; intent: StatusIntent }> = {
  PENDING: { label: "Setting up", intent: "pending" },
  REGISTERING: { label: "Setting up", intent: "pending" },
  AWAITING_OWNERSHIP_PROOF: { label: "Waiting on wallet proof", intent: "pending" },
  ACTIVE: { label: "Active", intent: "positive" },
  REJECTED: { label: "Declined", intent: "negative" },
};

export function maskedDetailLine(account: PayoutBankAccount): string {
  const last4 = account.details?.ibanLast4 ?? account.details?.accountNumberLast4;
  return [account.accountHolderName, account.bankName, last4 ? `••${last4}` : undefined, account.rail]
    .filter(Boolean)
    .join(" · ");
}

// ── The joined read ────────────────────────────────────────────────────

export interface RecipientEntry {
  partyId: string;
  name: string;
  roleStatus?: string;
  roleCreatedAt?: string;
  bankAccounts: { account: PayoutBankAccount; route?: PayoutRoute }[];
}

/** Row shape the send door consumes (structurally, no import needed). */
export interface RecipientSendRow {
  key: string;
  label?: string;
  accountHolderName?: string;
  bankName?: string;
  rail?: string;
  fiatCurrency?: string;
  last4?: string;
  accountStatus?: string;
  route?: {
    id: string;
    status?: string;
    depositAssetName?: string;
    depositAssetChain?: string;
    fiatCurrency?: string;
  };
}

/**
 * Saved payout recipients: PAYOUT_RECIPIENT roles on the account, joined to
 * their parties, their beneficiary bank accounts, and (where this session
 * created the route) their payout routes.
 */
export function useSavedRecipients(accountId?: string): {
  recipients: RecipientEntry[];
  sendRows: RecipientSendRow[];
  routes: PayoutRoute[];
  isPending: boolean;
  isError: boolean;
  refetch: () => void;
} {
  const clients = useVenly();
  useRouteLinkVersion(); // re-render when a new route link is recorded
  const rolesQuery = usePartyRoles(accountId);
  const routesQuery = usePayoutRoutes(accountId);
  const recipientRoles = useMemo(
    () => (rolesQuery.data?.items ?? []).filter((r) => r.roleType === "PAYOUT_RECIPIENT" && r.partyId),
    [rolesQuery.data],
  );
  const partyQueries = useQueries({
    queries: recipientRoles.map((role) => ({
      ...venlyQueries.party(clients, role.partyId as string),
    })),
  });
  const accountQueries = useQueries({
    queries: recipientRoles.map((role) => ({
      ...venlyQueries.payoutBankAccounts(clients, role.partyId as string),
    })),
  });

  const routes = routesQuery.data ?? [];
  const routeByBankAccount = new Map<string, PayoutRoute>();
  for (const route of routes) {
    if (!route.id) continue;
    const bankAccountId = payoutRouteLinks.bankAccountFor(route.id);
    if (bankAccountId) routeByBankAccount.set(bankAccountId, route);
  }

  const recipients: RecipientEntry[] = recipientRoles.map((role, i) => {
    const party = partyQueries[i]?.data as Party | undefined;
    const accounts = accountQueries[i]?.data?.items ?? [];
    return {
      partyId: role.partyId as string,
      name: party
        ? (party.name ?? [party.firstName, party.lastName].filter(Boolean).join(" ")).trim()
        : "",
      roleStatus: role.status,
      roleCreatedAt: role.createdAt,
      bankAccounts: accounts.map((account) => ({
        account,
        route: account.id ? routeByBankAccount.get(account.id) : undefined,
      })),
    };
  });

  const sendRows: RecipientSendRow[] = recipients.flatMap((entry) =>
    entry.bankAccounts.map(({ account, route }) => ({
      key: account.id ?? "",
      label: account.label,
      accountHolderName: account.accountHolderName,
      bankName: account.bankName,
      rail: account.rail,
      fiatCurrency: account.fiatCurrency,
      last4: account.details?.ibanLast4 ?? account.details?.accountNumberLast4,
      accountStatus: account.status,
      route:
        route?.id !== undefined
          ? {
              id: route.id,
              status: route.status,
              depositAssetName: route.depositAsset?.name,
              depositAssetChain: route.depositAsset?.chain,
              fiatCurrency: route.fiatCurrency,
            }
          : undefined,
    })),
  );

  return {
    recipients,
    sendRows,
    routes,
    isPending:
      rolesQuery.isPending ||
      routesQuery.isPending ||
      partyQueries.some((q) => q.isPending) ||
      accountQueries.some((q) => q.isPending),
    isError:
      rolesQuery.isError ||
      routesQuery.isError ||
      partyQueries.some((q) => q.isError) ||
      accountQueries.some((q) => q.isError),
    refetch: () => {
      void rolesQuery.refetch();
      void routesQuery.refetch();
      for (const q of partyQueries) void q.refetch();
      for (const q of accountQueries) void q.refetch();
    },
  };
}

// ── Add a recipient (party + PAYOUT_RECIPIENT role) ────────────────────

export interface AddRecipientFormProps {
  accountId: string;
  onAdded?: (partyId: string) => void;
  onCancel?: () => void;
  style?: CSSProperties;
  className?: string;
}

/** Creates the party, then attaches the PAYOUT_RECIPIENT role. */
export function AddRecipientForm({ accountId, onAdded, onCancel, style, className }: AddRecipientFormProps): ReactElement {
  const createParty = useCreateParty();
  const addRole = useAddPartyRole();
  const [partyType, setPartyType] = useState<"ORGANISATION" | "INDIVIDUAL">("ORGANISATION");
  const [name, setName] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const busy = createParty.isPending || addRole.isPending;
  const ready = partyType === "ORGANISATION" ? name.trim().length > 0 : firstName.trim().length > 0 && lastName.trim().length > 0;

  return (
    <form
      className={className}
      style={{ ...cardStyle, display: "flex", flexDirection: "column", gap: "var(--space-lg)", fontFamily: "var(--font-family)", maxWidth: "var(--form-max-width)", ...style }}
      onSubmit={(e) => {
        e.preventDefault();
        if (!ready || busy) return;
        setError(null);
        createParty.mutate(
          partyType === "ORGANISATION"
            ? { partyType, name: name.trim() }
            : { partyType, firstName: firstName.trim(), lastName: lastName.trim() },
          {
            onSuccess: (party) => {
              if (!party.id) return;
              addRole.mutate(
                { accountId, body: { partyId: party.id, roleType: "PAYOUT_RECIPIENT" } },
                {
                  onSuccess: () => onAdded?.(party.id as string),
                  onError: (e) => setError(e instanceof Error ? e.message : "The request was refused."),
                },
              );
            },
            onError: (e) => setError(e instanceof Error ? e.message : "The request was refused."),
          },
        );
      }}
    >
      <h3 style={sectionHeading}>Add a recipient</h3>
      <div role="radiogroup" aria-label="Recipient type" style={{ display: "flex", gap: "var(--space-2xs)" }}>
        {(["ORGANISATION", "INDIVIDUAL"] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="radio"
            aria-checked={partyType === t}
            onClick={() => setPartyType(t)}
            style={{
              ...quietButton,
              padding: "var(--space-2xs) var(--space-md)",
              fontWeight: partyType === t ? 600 : 400,
              background: partyType === t ? "var(--selected-tint)" : "var(--surface-raised)",
            }}
          >
            {t === "ORGANISATION" ? "Business" : "Person"}
          </button>
        ))}
      </div>
      {partyType === "ORGANISATION" ? (
        <div>
          <label style={labelStyle} htmlFor="vf-recipient-name">
            Business name
          </label>
          <input id="vf-recipient-name" style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-md)" }}>
          <div style={{ flex: "1 1 12em" }}>
            <label style={labelStyle} htmlFor="vf-recipient-first">
              First name
            </label>
            <input id="vf-recipient-first" style={inputStyle} value={firstName} onChange={(e) => setFirstName(e.target.value)} />
          </div>
          <div style={{ flex: "1 1 12em" }}>
            <label style={labelStyle} htmlFor="vf-recipient-last">
              Last name
            </label>
            <input id="vf-recipient-last" style={inputStyle} value={lastName} onChange={(e) => setLastName(e.target.value)} />
          </div>
        </div>
      )}
      {error ? (
        <p role="alert" style={{ margin: 0, fontSize: "var(--font-size-label)", color: "var(--state-danger-fg)" }}>
          {error}
        </p>
      ) : null}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-sm)" }}>
        <button type="submit" disabled={!ready || busy} style={primaryButton}>
          {busy ? "Adding…" : "Add recipient"}
        </button>
        {onCancel ? (
          <button type="button" style={quietButton} onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        ) : null}
      </div>
    </form>
  );
}

// ── Register a beneficiary bank account ────────────────────────────────

export interface BeneficiaryAccountFormProps {
  partyId: string;
  onRegistered?: (account: PayoutBankAccount) => void;
  onCancel?: () => void;
  style?: CSSProperties;
  className?: string;
}

/**
 * The request schema publishes no required[] list and its `rail` is a bare
 * string; the US_ACH|SEPA constraint exists only on the response DTOs. This
 * form treats rail, fiatCurrency, label, accountHolderName, railDetails and
 * bankName as required and offers only the response-enum rails - product
 * logic, disclosed, pending contract confirmation.
 */
export function BeneficiaryAccountForm({ partyId, onRegistered, onCancel, style, className }: BeneficiaryAccountFormProps): ReactElement {
  const register = useRegisterPayoutBankAccount();
  const [rail, setRail] = useState<"SEPA" | "US_ACH">("SEPA");
  const [fiatCurrency, setFiatCurrency] = useState("EUR");
  const [label, setLabel] = useState("");
  const [holder, setHolder] = useState("");
  const [bankName, setBankName] = useState("");
  const [iban, setIban] = useState("");
  const [bic, setBic] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [routingNumber, setRoutingNumber] = useState("");
  const [accountType, setAccountType] = useState<"CHECKING" | "SAVINGS">("CHECKING");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [street, setStreet] = useState("");
  const [city, setCity] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [country, setCountry] = useState("");

  const railDetailsReady = rail === "SEPA" ? iban.trim().length > 0 : accountNumber.trim().length > 0 && routingNumber.trim().length > 0;
  const ready =
    fiatCurrency.trim().length >= 3 &&
    label.trim().length > 0 &&
    holder.trim().length > 0 &&
    bankName.trim().length > 0 &&
    railDetailsReady;

  return (
    <form
      className={className}
      style={{ ...cardStyle, display: "flex", flexDirection: "column", gap: "var(--space-lg)", fontFamily: "var(--font-family)", maxWidth: "var(--form-max-width)", ...style }}
      onSubmit={(e) => {
        e.preventDefault();
        if (!ready || register.isPending) return;
        register.mutate(
          {
            partyId,
            body: {
              rail,
              fiatCurrency: fiatCurrency.trim().toUpperCase(),
              label: label.trim(),
              accountHolderName: holder.trim(),
              bankName: bankName.trim(),
              railDetails:
                rail === "SEPA"
                  ? { iban: iban.trim(), ...(bic.trim() ? { bic: bic.trim() } : {}) }
                  : { accountNumber: accountNumber.trim(), abaRoutingNumber: routingNumber.trim(), accountType },
              ...(email.trim() ? { beneficiaryEmail: email.trim() } : {}),
              ...(phone.trim() ? { beneficiaryPhoneNumber: phone.trim() } : {}),
              ...(street.trim() || city.trim() || postalCode.trim() || country.trim()
                ? {
                    bankAddress: {
                      ...(street.trim() ? { street1: street.trim() } : {}),
                      ...(city.trim() ? { city: city.trim() } : {}),
                      ...(postalCode.trim() ? { postalCode: postalCode.trim() } : {}),
                      ...(country.trim() ? { country: country.trim() } : {}),
                    },
                  }
                : {}),
            },
          },
          { onSuccess: (account) => onRegistered?.(account) },
        );
      }}
    >
      <h3 style={sectionHeading}>Add a bank account</h3>
      <div>
        <label style={labelStyle} htmlFor="vf-beneficiary-rail">
          Rail
        </label>
        <select
          id="vf-beneficiary-rail"
          style={{ ...inputStyle, cursor: "pointer" }}
          value={rail}
          onChange={(e) => {
            const next = e.target.value as "SEPA" | "US_ACH";
            setRail(next);
            setFiatCurrency(next === "SEPA" ? "EUR" : "USD");
          }}
        >
          <option value="SEPA">SEPA</option>
          <option value="US_ACH">US_ACH</option>
        </select>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-md)" }}>
        <div style={{ flex: "1 1 8em" }}>
          <label style={labelStyle} htmlFor="vf-beneficiary-currency">
            Payout currency
          </label>
          <input
            id="vf-beneficiary-currency"
            style={{ ...inputStyle, textTransform: "uppercase" }}
            value={fiatCurrency}
            onChange={(e) => setFiatCurrency(e.target.value.toUpperCase())}
          />
        </div>
        <div style={{ flex: "2 1 14em" }}>
          <label style={labelStyle} htmlFor="vf-beneficiary-label">
            Label
          </label>
          <input id="vf-beneficiary-label" style={inputStyle} value={label} onChange={(e) => setLabel(e.target.value)} />
        </div>
      </div>
      <div>
        <label style={labelStyle} htmlFor="vf-beneficiary-holder">
          Account holder name
        </label>
        <input id="vf-beneficiary-holder" style={inputStyle} value={holder} onChange={(e) => setHolder(e.target.value)} />
      </div>
      <div>
        <label style={labelStyle} htmlFor="vf-beneficiary-bank">
          Bank name
        </label>
        <input id="vf-beneficiary-bank" style={inputStyle} value={bankName} onChange={(e) => setBankName(e.target.value)} />
      </div>
      {rail === "SEPA" ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-md)" }}>
          <div style={{ flex: "2 1 16em" }}>
            <label style={labelStyle} htmlFor="vf-beneficiary-iban">
              IBAN
            </label>
            <input id="vf-beneficiary-iban" style={{ ...inputStyle, fontVariantNumeric: "tabular-nums" }} value={iban} onChange={(e) => setIban(e.target.value)} />
          </div>
          <div style={{ flex: "1 1 8em" }}>
            <label style={labelStyle} htmlFor="vf-beneficiary-bic">
              BIC (optional)
            </label>
            <input id="vf-beneficiary-bic" style={inputStyle} value={bic} onChange={(e) => setBic(e.target.value)} />
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-md)" }}>
          <div style={{ flex: "2 1 12em" }}>
            <label style={labelStyle} htmlFor="vf-beneficiary-account-number">
              Account number
            </label>
            <input id="vf-beneficiary-account-number" style={{ ...inputStyle, fontVariantNumeric: "tabular-nums" }} value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} />
          </div>
          <div style={{ flex: "1 1 10em" }}>
            <label style={labelStyle} htmlFor="vf-beneficiary-routing">
              ABA routing number
            </label>
            <input id="vf-beneficiary-routing" style={{ ...inputStyle, fontVariantNumeric: "tabular-nums" }} value={routingNumber} onChange={(e) => setRoutingNumber(e.target.value)} />
          </div>
          <div style={{ flex: "1 1 8em" }}>
            <label style={labelStyle} htmlFor="vf-beneficiary-account-type">
              Account type
            </label>
            <select id="vf-beneficiary-account-type" style={{ ...inputStyle, cursor: "pointer" }} value={accountType} onChange={(e) => setAccountType(e.target.value as "CHECKING" | "SAVINGS")}>
              <option value="CHECKING">CHECKING</option>
              <option value="SAVINGS">SAVINGS</option>
            </select>
          </div>
        </div>
      )}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-md)" }}>
        <div style={{ flex: "1 1 12em" }}>
          <label style={labelStyle} htmlFor="vf-beneficiary-email">
            Beneficiary email (optional)
          </label>
          <input id="vf-beneficiary-email" type="email" style={inputStyle} value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div style={{ flex: "1 1 12em" }}>
          <label style={labelStyle} htmlFor="vf-beneficiary-phone">
            Beneficiary phone (optional)
          </label>
          <input id="vf-beneficiary-phone" style={inputStyle} value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
      </div>
      <details>
        <summary style={{ fontSize: "var(--font-size-label)", color: "var(--text-secondary)", cursor: "pointer" }}>
          Bank address (optional)
        </summary>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)", marginTop: "var(--space-md)" }}>
          <div>
            <label style={labelStyle} htmlFor="vf-beneficiary-street">
              Street
            </label>
            <input id="vf-beneficiary-street" style={inputStyle} value={street} onChange={(e) => setStreet(e.target.value)} />
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-md)" }}>
            <div style={{ flex: "2 1 10em" }}>
              <label style={labelStyle} htmlFor="vf-beneficiary-city">
                City
              </label>
              <input id="vf-beneficiary-city" style={inputStyle} value={city} onChange={(e) => setCity(e.target.value)} />
            </div>
            <div style={{ flex: "1 1 8em" }}>
              <label style={labelStyle} htmlFor="vf-beneficiary-postal">
                Postal code
              </label>
              <input id="vf-beneficiary-postal" style={inputStyle} value={postalCode} onChange={(e) => setPostalCode(e.target.value)} />
            </div>
            <div style={{ flex: "1 1 8em" }}>
              <label style={labelStyle} htmlFor="vf-beneficiary-country">
                Country
              </label>
              <input id="vf-beneficiary-country" style={inputStyle} value={country} onChange={(e) => setCountry(e.target.value)} />
            </div>
          </div>
        </div>
      </details>
      {register.isError ? (
        <p role="alert" style={{ margin: 0, fontSize: "var(--font-size-label)", color: "var(--state-danger-fg)" }}>
          {register.error instanceof Error ? register.error.message : "The request was refused."}
        </p>
      ) : null}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-sm)" }}>
        <button type="submit" disabled={!ready || register.isPending} style={primaryButton}>
          {register.isPending ? "Registering…" : "Add bank account"}
        </button>
        {onCancel ? (
          <button type="button" style={quietButton} onClick={onCancel} disabled={register.isPending}>
            Cancel
          </button>
        ) : null}
      </div>
    </form>
  );
}

// ── Route ceremony (create → proof → active; every state rendered) ─────

const ROUTE_CEREMONY_ORDER = ["PENDING", "REGISTERING", "AWAITING_OWNERSHIP_PROOF", "ACTIVE"] as const;

/** Timeline-lite: the ceremony order with the current state marked. */
function RouteStateTrack({ status }: { status?: string }): ReactElement {
  if (status === "REJECTED") {
    return (
      <p style={{ margin: 0, fontSize: "var(--font-size-label)", color: "var(--state-danger-fg)" }}>
        <span aria-hidden="true">✕</span> Declined – this route can't be used. Add a different bank account or contact support.
      </p>
    );
  }
  const currentIndex = ROUTE_CEREMONY_ORDER.indexOf(status as (typeof ROUTE_CEREMONY_ORDER)[number]);
  return (
    <ol style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexWrap: "wrap", gap: "var(--space-sm)", fontSize: "var(--font-size-micro)", color: "var(--text-tertiary)" }}>
      {ROUTE_CEREMONY_ORDER.map((step, i) => (
        <li
          key={step}
          aria-current={i === currentIndex ? "step" : undefined}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "var(--space-2xs)",
            color: i === currentIndex ? "var(--text-primary)" : i < currentIndex ? "var(--text-secondary)" : "var(--text-tertiary)",
            fontWeight: i === currentIndex ? 600 : 400,
          }}
        >
          <span aria-hidden="true">{i < currentIndex ? "●" : i === currentIndex ? "◐" : "○"}</span>
          {ROUTE_STATUS_PILL[step]?.label ?? step}
          {i < ROUTE_CEREMONY_ORDER.length - 1 ? <span aria-hidden="true">→</span> : null}
        </li>
      ))}
    </ol>
  );
}

export interface RouteCeremonyProps {
  accountId: string;
  bankAccount: PayoutBankAccount;
  /** The routes known to belong to this bank account (session-linked). */
  routes: PayoutRoute[];
  onRouteCreated?: (route: PayoutRoute) => void;
  style?: CSSProperties;
  className?: string;
}

/**
 * One bank account's routes: create, then walk the machine to ACTIVE via
 * the ownership proof. Every state renders; nothing about review timing is
 * claimed anywhere - no such field exists.
 */
export function RouteCeremony({ accountId, bankAccount, routes, onRouteCreated, style, className }: RouteCeremonyProps): ReactElement {
  const { data: assets } = useAccountSupportedAssets(accountId);
  const createRoute = useCreatePayoutRoute();
  const prepare = usePreparePayoutOwnershipProof();
  const complete = useCompletePayoutOwnershipProof();
  const [assetIndex, setAssetIndex] = useState(0);
  const [signature, setSignature] = useState("");
  const [proofRouteId, setProofRouteId] = useState<string | null>(null);

  const assetRows = assets?.items ?? [];
  const chosen = assetRows[assetIndex];
  const accountActive = bankAccount.status === "ACTIVE";

  return (
    <div className={className} style={{ display: "flex", flexDirection: "column", gap: "var(--space-lg)", fontFamily: "var(--font-family)", ...style }}>
      {routes.length === 0 ? (
        <p style={{ margin: 0, fontSize: "var(--font-size-label)", color: "var(--text-secondary)" }}>
          No route yet. A payout route binds this bank account to your account and a deposit asset.
        </p>
      ) : null}
      {routes.map((route) => {
        const pill = ROUTE_STATUS_PILL[route.status ?? ""];
        const awaitingProof = route.status === "AWAITING_OWNERSHIP_PROOF";
        const proof = proofRouteId === route.id ? prepare.data : undefined;
        return (
          <div key={route.id} style={{ ...cardStyle, display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "var(--space-md)", flexWrap: "wrap" }}>
              <span style={{ fontSize: "var(--font-size-body)", color: "var(--text-primary)" }}>
                {route.depositAsset ? `${route.depositAsset.name} · ${route.depositAsset.chain}` : "Route"}
                {route.fiatCurrency ? (
                  <span style={{ color: "var(--text-secondary)" }}> → {route.fiatCurrency}</span>
                ) : null}
              </span>
              {pill ? <StatusPill {...pill} /> : null}
            </div>
            <RouteStateTrack status={route.status} />
            {awaitingProof ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
                <p style={{ margin: 0, fontSize: "var(--font-size-label)", color: "var(--text-secondary)" }}>
                  Waiting on wallet proof – sign the message with your connected wallet to activate this route.
                </p>
                {!proof ? (
                  <button
                    type="button"
                    style={{ ...quietButton, alignSelf: "start" }}
                    disabled={prepare.isPending}
                    onClick={() => {
                      setProofRouteId(route.id ?? null);
                      prepare.mutate({ accountId, routeId: route.id ?? "" });
                    }}
                  >
                    {prepare.isPending && proofRouteId === route.id ? "Preparing…" : "Show the message to sign"}
                  </button>
                ) : (
                  <form
                    style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (!signature.trim() || !proof.message) return;
                      complete.mutate(
                        {
                          accountId,
                          routeId: route.id ?? "",
                          body: { message: proof.message, signature: signature.trim() },
                        },
                        { onSuccess: () => setSignature("") },
                      );
                    }}
                  >
                    <FieldList
                      fields={[
                        { label: "Wallet address", value: proof.walletAddress ?? null, mono: true },
                        { label: "Blockchain", value: proof.blockchain ?? null, copyable: false },
                        { label: "Message to sign", value: proof.message ?? null, mono: true },
                      ]}
                    />
                    <div>
                      <label style={labelStyle} htmlFor={`vf-route-signature-${route.id}`}>
                        Signature
                      </label>
                      <input
                        id={`vf-route-signature-${route.id}`}
                        style={{ ...inputStyle, fontVariantNumeric: "tabular-nums" }}
                        value={signature}
                        onChange={(e) => setSignature(e.target.value)}
                      />
                    </div>
                    {complete.isError ? (
                      <p role="alert" style={{ margin: 0, fontSize: "var(--font-size-label)", color: "var(--state-danger-fg)" }}>
                        {complete.error instanceof Error ? complete.error.message : "The request was refused."}
                      </p>
                    ) : null}
                    <button type="submit" disabled={complete.isPending || !signature.trim()} style={{ ...primaryButton, alignSelf: "start" }}>
                      {complete.isPending ? "Submitting…" : "Submit proof"}
                    </button>
                  </form>
                )}
              </div>
            ) : null}
          </div>
        );
      })}

      {/* Create a(nother) route. Disabled with the reason while the bank
          account is not ACTIVE - the API refuses routes on non-active
          accounts, so the control says why instead of failing. */}
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
        {!accountActive ? (
          <p style={{ margin: 0, fontSize: "var(--font-size-label)", color: "var(--text-secondary)" }}>
            {bankAccount.status === "PENDING"
              ? "In review – routes can use this account once it's active."
              : "Disabled – this account can't take new routes."}
          </p>
        ) : null}
        <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-sm)", alignItems: "center" }}>
          <select
            aria-label="Deposit asset"
            style={{ ...inputStyle, width: "auto", cursor: "pointer" }}
            value={assetIndex}
            disabled={!accountActive}
            onChange={(e) => setAssetIndex(Number(e.target.value))}
          >
            {assetRows.map((row, i) => (
              <option key={`${row.cryptoCurrency}-${row.chain}`} value={i}>
                {row.cryptoCurrency} · {row.chain}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={!accountActive || !chosen || createRoute.isPending}
            aria-disabled={!accountActive || !chosen}
            style={primaryButton}
            onClick={() => {
              if (!chosen || !bankAccount.id) return;
              createRoute.mutate(
                {
                  accountId,
                  body: {
                    payoutBankAccountId: bankAccount.id,
                    depositAsset: {
                      chain: (chosen.chain ?? "BASE") as NonNullable<PayoutRoute["depositAsset"]>["chain"],
                      name: chosen.cryptoCurrency ?? "",
                    },
                  },
                },
                {
                  onSuccess: (route) => {
                    if (route.id && bankAccount.id) payoutRouteLinks.record(route.id, bankAccount.id);
                    onRouteCreated?.(route);
                  },
                },
              );
            }}
          >
            {createRoute.isPending ? "Creating…" : "Create route"}
          </button>
        </div>
        {createRoute.isError ? (
          <p role="alert" style={{ margin: 0, fontSize: "var(--font-size-label)", color: "var(--state-danger-fg)" }}>
            {createRoute.error instanceof Error ? createRoute.error.message : "The request was refused."}
          </p>
        ) : null}
      </div>
    </div>
  );
}

// ── The recipients page view ───────────────────────────────────────────

export interface RecipientsViewProps {
  accountId: string;
  style?: CSSProperties;
  className?: string;
}

/**
 * Saved recipients: the list, each recipient's beneficiary bank accounts
 * (masked), and the route ceremony per account.
 */
export function RecipientsView({ accountId, style, className }: RecipientsViewProps): ReactElement {
  const saved = useSavedRecipients(accountId);
  const [adding, setAdding] = useState(false);
  const [addingAccountFor, setAddingAccountFor] = useState<string | null>(null);
  const [selectedPartyId, setSelectedPartyId] = useState<string | null>(null);

  if (saved.isError) {
    return (
      <section className={className} style={{ fontFamily: "var(--font-family)", ...style }}>
        <ListLoadError what="your saved recipients" onRetry={saved.refetch} />
      </section>
    );
  }
  if (saved.isPending) {
    return (
      <p className={className} style={{ margin: 0, fontFamily: "var(--font-family)", color: "var(--text-tertiary)", fontSize: "var(--font-size-body)", ...style }}>
        Loading recipients…
      </p>
    );
  }

  const selected = saved.recipients.find((r) => r.partyId === selectedPartyId) ?? saved.recipients[0];

  const columns: DataTableColumn<RecipientEntry>[] = [
    {
      key: "recipient",
      header: "Recipient",
      cell: (r) => (
        <RowText
          primary={r.name || "—"}
          secondary={`${r.bankAccounts.length} bank account${r.bankAccounts.length === 1 ? "" : "s"}`}
        />
      ),
    },
    {
      key: "role",
      header: "Role",
      cell: (r) => {
        const pill = r.roleStatus ? RECIPIENT_ROLE_STATUS_PILL[r.roleStatus] : undefined;
        return pill ? <StatusPill {...pill} /> : <span style={{ color: "var(--text-tertiary)" }}>—</span>;
      },
    },
    {
      key: "added",
      header: "Added",
      cell: (r) => (
        <span style={{ fontSize: "var(--font-size-label)", color: "var(--text-secondary)" }}>
          {r.roleCreatedAt ? new Date(r.roleCreatedAt).toISOString().slice(0, 10) : "—"}
        </span>
      ),
    },
  ];

  return (
    <div className={className} style={{ display: "flex", flexDirection: "column", gap: "var(--space-xl)", fontFamily: "var(--font-family)", ...style }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "var(--space-md)", flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, fontSize: "var(--font-size-value)", fontWeight: 600, color: "var(--text-primary)" }}>
          Recipients
        </h2>
        <button type="button" style={primaryButton} onClick={() => setAdding((a) => !a)}>
          Add a recipient
        </button>
      </div>

      {adding ? (
        <AddRecipientForm
          accountId={accountId}
          onCancel={() => setAdding(false)}
          onAdded={(partyId) => {
            setAdding(false);
            setSelectedPartyId(partyId);
          }}
        />
      ) : null}

      {saved.recipients.length === 0 ? (
        !adding ? (
          <div style={cardStyle}>
            <p style={{ margin: 0, fontSize: "var(--font-size-body)", color: "var(--text-primary)" }}>
              No saved recipients. Add a recipient to pay a bank account.
            </p>
          </div>
        ) : null
      ) : (
        <>
          <div className="venly-table-scroll">
            <DataTable
              columns={columns}
              rows={saved.recipients}
              rowKey={(r) => r.partyId}
              onRowClick={(r) => setSelectedPartyId(r.partyId)}
              selectedKey={selected?.partyId}
              emptyMessage="No saved recipients."
            />
          </div>

          {selected ? (
            <section style={{ display: "flex", flexDirection: "column", gap: "var(--space-lg)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "var(--space-md)", flexWrap: "wrap" }}>
                <h3 style={{ margin: 0, fontSize: "var(--font-size-body)", fontWeight: 600, color: "var(--text-primary)" }}>
                  {selected.name}
                </h3>
                <button type="button" style={quietButton} onClick={() => setAddingAccountFor(addingAccountFor === selected.partyId ? null : selected.partyId)}>
                  Add a bank account
                </button>
              </div>

              {addingAccountFor === selected.partyId ? (
                <BeneficiaryAccountForm
                  partyId={selected.partyId}
                  onCancel={() => setAddingAccountFor(null)}
                  onRegistered={() => setAddingAccountFor(null)}
                />
              ) : null}

              {selected.bankAccounts.length === 0 && addingAccountFor !== selected.partyId ? (
                <p style={{ margin: 0, fontSize: "var(--font-size-label)", color: "var(--text-secondary)" }}>
                  No bank accounts yet. Add one to build a payout route.
                </p>
              ) : null}

              {selected.bankAccounts.map(({ account, route }) => {
                const pill = account.status ? BENEFICIARY_ACCOUNT_STATUS_PILL[account.status] : undefined;
                const accountFields: FieldRow[] = [
                  { label: "Account", value: maskedDetailLine(account), copyable: false },
                  { label: "Payout currency", value: account.fiatCurrency ?? null, copyable: false },
                ];
                if (account.details?.bic) accountFields.push({ label: "BIC", value: account.details.bic, copyable: false, mono: true });
                if (account.details?.abaRoutingNumber) accountFields.push({ label: "ABA routing number", value: account.details.abaRoutingNumber, copyable: false, mono: true });
                return (
                  <div key={account.id} style={{ ...cardStyle, display: "flex", flexDirection: "column", gap: "var(--space-lg)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "var(--space-md)", flexWrap: "wrap" }}>
                      <span style={{ fontSize: "var(--font-size-body)", fontWeight: 500, color: "var(--text-primary)", overflowWrap: "anywhere" }}>
                        {account.label ?? account.accountHolderName}
                      </span>
                      {pill ? <StatusPill {...pill} /> : null}
                    </div>
                    <FieldList fields={accountFields} />
                    <RouteCeremony
                      accountId={accountId}
                      bankAccount={account}
                      routes={route ? [route] : []}
                    />
                  </div>
                );
              })}
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
