import { useEffect, useMemo, useState, type CSSProperties, type ReactElement } from "react";
import * as OneTimePasswordField from "@radix-ui/react-one-time-password-field";
import { useQueries } from "@tanstack/react-query";
import type { Party, Payout, Transfer } from "@venlyfinance/sdk";
import type { CryptoTransferDraft } from "@venlyfinance/react";
import {
  useAccounts,
  useAccountSupportedAssets,
  useCreateCryptoTransfer,
  useCreateFiatTransfer,
  useParties,
  usePayouts,
  useRequestPayout,
  useTransfer,
  useTransfers,
  usePayout,
  useVenly,
  useWallets,
  venlyQueries,
} from "@venlyfinance/react";
import { Money, formatAmount, formatStamp } from "../lib/money.js";
import { DataTable, RowText, type DataTableColumn } from "../components/data-table.js";
import { StatusPill, type StatusIntent } from "../components/status-pill.js";
import { FieldList, type FieldRow } from "../components/field-list.js";
import { ListLoadError } from "../components/list-error.js";

/**
 * Send block - ONE door for money leaving the account, forked on what the
 * recipient IS rather than on rails:
 *
 * - a person or business on the platform (directory row)  -> transfer
 * - a saved third-party recipient (verified bank account) -> payout
 * - your own bank account                                 -> the withdraw flow
 *
 * Design contract encoded by this block:
 * - The first screen is the recipient picker; the intent is the recipient's
 *   object type. There is no rail picker and no send-to-raw-address surface.
 * - Directory rows render a name and a handle, never a UUID; rows that
 *   cannot receive are disabled WITH the reason, never hidden.
 * - Every money confirm passes the step-up ceremony (a 6-digit code against
 *   YOUR auth adapter). This is app-side ceremony, not an API guarantee.
 * - Reviews render only figures the API has produced. Fees, delivery times
 *   and pre-create rates are not returned by these operations, so no such
 *   row renders - and the payout review says so in words.
 * - Execution is single-shot: the idempotency key is minted once per staged
 *   draft and every retry replays the same record.
 * - Details render the record's own fields verbatim (status, hash, error,
 *   failure reason) plus an app-side observation log - never invented
 *   stages, never an ETA.
 */

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

const rowButton: CSSProperties = {
  ...cardStyle,
  textAlign: "left",
  width: "100%",
  boxSizing: "border-box",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: "var(--space-lg)",
  fontFamily: "var(--font-family)",
  cursor: "pointer",
};

// ── Amount guard ───────────────────────────────────────────────────────

/**
 * Amount input guard. Number("")/Number(" ") are 0 and Number("Infinity")
 * is > 0, so a falsy/NaN check alone lets nonsense reach the review step.
 * Returns the parsed amount, or null when the input must not stage.
 */
export function parseAmountInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const amount = Number(trimmed);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

// ── Directory (intent 1's recipient class) ─────────────────────────────

export type DirectoryVerification = "verified" | "pending" | "rejected";

/**
 * A party's can-it-receive state, from the verification field its type
 * carries: `kycStatus` on individuals, `kybStatus` on organisations. A
 * party with no decision yet reads as pending - unverified until proven.
 */
export function directoryVerification(party: Party): DirectoryVerification {
  if (party.partyType === "ORGANISATION") {
    if (party.kybStatus === "VERIFIED") return "verified";
    if (party.kybStatus === "DENIED") return "rejected";
    return "pending";
  }
  if (party.kycStatus === "VERIFIED") return "verified";
  if (party.kycStatus === "REJECTED") return "rejected";
  return "pending";
}

/** Rendered identity only: the name, never an id. */
export function partyDisplayName(party: Party): string {
  return (
    party.name ??
    [party.firstName, party.lastName].filter(Boolean).join(" ")
  ).trim();
}

export interface DirectoryEntry {
  key: string;
  /** The rendered identity: a name, never a UUID. */
  name: string;
  /** The integrator-side handle (externalId). Ids stay request-side. */
  handle?: string;
  verification: DirectoryVerification;
  /** Resolution target for the transfer create call. */
  receiverAccountId: string;
}

/**
 * The reference directory adapter: the integrator's user table stands in as
 * the accounts joined to their holder parties (account -> ACCOUNT_HOLDER
 * role -> party). A real product replaces this hook with its own user
 * directory; the entry shape is the contract.
 */
export function useDirectoryEntries(excludeAccountId?: string): {
  entries: DirectoryEntry[];
  isPending: boolean;
  isError: boolean;
  refetch: () => void;
} {
  const clients = useVenly();
  const accountsQuery = useAccounts();
  const partiesQuery = useParties();
  const accounts = useMemo(
    () => (accountsQuery.data?.items ?? []).filter((a) => a.id && a.id !== excludeAccountId),
    [accountsQuery.data, excludeAccountId],
  );
  const roleQueries = useQueries({
    queries: accounts.map((account) => ({
      ...venlyQueries.partyRoles(clients, account.id as string),
    })),
  });

  const partiesById = useMemo(() => {
    const map = new Map<string, Party>();
    for (const party of partiesQuery.data?.items ?? []) {
      if (party.id) map.set(party.id, party);
    }
    return map;
  }, [partiesQuery.data]);

  const entries: DirectoryEntry[] = [];
  for (let i = 0; i < accounts.length; i++) {
    const account = accounts[i]!;
    const roles = roleQueries[i]?.data?.items ?? [];
    const holder = roles.find((r) => r.roleType === "ACCOUNT_HOLDER" && r.status === "ACTIVE");
    const party = holder?.partyId ? partiesById.get(holder.partyId) : undefined;
    if (!party) continue;
    const name = partyDisplayName(party);
    if (!name) continue;
    entries.push({
      key: account.id as string,
      name,
      handle: party.externalId ?? account.externalId ?? undefined,
      verification: directoryVerification(party),
      receiverAccountId: account.id as string,
    });
  }

  return {
    entries,
    isPending:
      accountsQuery.isPending || partiesQuery.isPending || roleQueries.some((q) => q.isPending),
    isError: accountsQuery.isError || partiesQuery.isError || roleQueries.some((q) => q.isError),
    refetch: () => {
      void accountsQuery.refetch();
      void partiesQuery.refetch();
      for (const q of roleQueries) void q.refetch();
    },
  };
}

function initialsOf(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase();
}

function Avatar({ name }: { name: string }): ReactElement {
  return (
    <span
      aria-hidden="true"
      style={{
        flex: "none",
        width: "var(--space-2xl)",
        height: "var(--space-2xl)",
        borderRadius: "var(--radius-pill)",
        background: "var(--surface-sunken)",
        border: "var(--border-w-hairline) solid var(--border-hairline)",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: "var(--font-size-label)",
        fontWeight: 600,
        color: "var(--text-secondary)",
      }}
    >
      {initialsOf(name)}
    </span>
  );
}

const DIRECTORY_DISABLED_REASON: Record<Exclude<DirectoryVerification, "verified">, string> = {
  pending: "Can't receive yet – identity verification pending.",
  rejected: "Can't receive – verification declined.",
};

export interface DirectoryPickProps {
  entries: DirectoryEntry[];
  platformName: string;
  onSelect: (entry: DirectoryEntry) => void;
  /** The empty state's invite CTA is display-only unless you wire it. */
  onInvite?: () => void;
  style?: CSSProperties;
  className?: string;
}

/** Directory rows: name + handle + initials, disabled-with-reason. */
export function DirectoryPick({
  entries,
  platformName,
  onSelect,
  onInvite,
  style,
  className,
}: DirectoryPickProps): ReactElement {
  const [inviteNote, setInviteNote] = useState(false);
  if (entries.length === 0) {
    return (
      <section
        className={className}
        style={{ ...cardStyle, fontFamily: "var(--font-family)", ...style }}
      >
        <p style={{ margin: 0, fontSize: "var(--font-size-body)", color: "var(--text-primary)" }}>
          No one to pay yet. People you can pay appear here once they join {platformName}.
        </p>
        <button
          type="button"
          style={{ ...quietButton, marginTop: "var(--space-lg)" }}
          onClick={() => (onInvite ? onInvite() : setInviteNote(true))}
        >
          Invite someone
        </button>
        {inviteNote ? (
          <p style={{ margin: "var(--space-sm) 0 0", fontSize: "var(--font-size-label)", color: "var(--text-tertiary)" }}>
            Invites live in your user directory – this demo doesn't include one.
          </p>
        ) : null}
      </section>
    );
  }
  return (
    <div
      className={className}
      style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)", ...style }}
    >
      {entries.map((entry) => {
        const usable = entry.verification === "verified";
        return (
          <button
            key={entry.key}
            type="button"
            disabled={!usable}
            aria-disabled={!usable}
            onClick={() => usable && onSelect(entry)}
            style={{ ...rowButton, cursor: usable ? "pointer" : "not-allowed", opacity: usable ? 1 : 0.75 }}
          >
            <span style={{ display: "flex", alignItems: "center", gap: "var(--space-md)", minWidth: 0 }}>
              <Avatar name={entry.name} />
              <span style={{ display: "flex", flexDirection: "column", gap: "var(--space-3xs)", minWidth: 0 }}>
                <span style={{ fontSize: "var(--font-size-body)", fontWeight: 500, color: "var(--text-primary)", overflowWrap: "anywhere" }}>
                  {entry.name}
                </span>
                {entry.handle ? (
                  <span style={{ fontSize: "var(--font-size-label)", color: "var(--text-secondary)", overflowWrap: "anywhere" }}>
                    {entry.handle}
                  </span>
                ) : null}
                {!usable ? (
                  <span style={{ fontSize: "var(--font-size-label)", color: "var(--text-secondary)" }}>
                    {DIRECTORY_DISABLED_REASON[entry.verification as "pending" | "rejected"]}
                  </span>
                ) : null}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ── Saved recipients (intent 3's recipient class) ──────────────────────

/**
 * The route list read carries no route -> bank-account key, so a rendered
 * join exists only where the app captured it at route creation (the create
 * request names both). Identity renders only when known; nothing is guessed.
 */
export interface SavedRecipientRow {
  key: string;
  /** Beneficiary identity, from the payout bank account. */
  label?: string;
  accountHolderName?: string;
  bankName?: string;
  rail?: string;
  fiatCurrency?: string;
  /** Masked server-side: ••{last4}. Render it, never re-ask. */
  last4?: string;
  accountStatus?: string;
  /** The ACTIVE-or-not route this recipient is payable over, when linked. */
  route?: {
    id: string;
    status?: string;
    depositAssetName?: string;
    depositAssetChain?: string;
    fiatCurrency?: string;
  };
}

export const PAYOUT_BANK_ACCOUNT_STATUS_PILL: Record<string, { label: string; intent: StatusIntent }> = {
  PENDING: { label: "In review", intent: "pending" },
  ACTIVE: { label: "Active", intent: "positive" },
  DISABLED: { label: "Disabled", intent: "neutral" },
};

/** Route-state vocabulary (verbatim status -> word + intent). */
export const PAYOUT_ROUTE_STATUS_PILL: Record<string, { label: string; intent: StatusIntent }> = {
  PENDING: { label: "Setting up", intent: "pending" },
  REGISTERING: { label: "Setting up", intent: "pending" },
  AWAITING_OWNERSHIP_PROOF: { label: "Waiting on wallet proof", intent: "pending" },
  ACTIVE: { label: "Active", intent: "positive" },
  REJECTED: { label: "Declined", intent: "negative" },
};

export function recipientUnusableReason(row: SavedRecipientRow): string | null {
  if (row.route?.status === "ACTIVE") return null;
  if (!row.route) return "No active route yet – finish setup in Recipients.";
  switch (row.route.status) {
    case "PENDING":
    case "REGISTERING":
      return "Setting up – this route isn't ready to pay yet.";
    case "AWAITING_OWNERSHIP_PROOF":
      return "Waiting on wallet proof – sign the message with your connected wallet to activate this route.";
    case "REJECTED":
      return "Declined – this route can't be used. Add a different bank account or contact support.";
    default:
      return "This route isn't ready to pay yet.";
  }
}

function RecipientRowBody({ row }: { row: SavedRecipientRow }): ReactElement {
  const reason = recipientUnusableReason(row);
  return (
    <span style={{ display: "flex", alignItems: "center", gap: "var(--space-md)", minWidth: 0 }}>
      <Avatar name={row.accountHolderName ?? row.label ?? ""} />
      <span style={{ display: "flex", flexDirection: "column", gap: "var(--space-3xs)", minWidth: 0 }}>
        <span style={{ fontSize: "var(--font-size-body)", fontWeight: 500, color: "var(--text-primary)", overflowWrap: "anywhere" }}>
          {row.label ?? row.accountHolderName}
        </span>
        <span style={{ fontSize: "var(--font-size-label)", color: "var(--text-secondary)", overflowWrap: "anywhere" }}>
          {[row.accountHolderName, row.bankName, row.last4 ? `••${row.last4}` : undefined, row.rail]
            .filter(Boolean)
            .join(" · ")}
        </span>
        {reason ? (
          <span style={{ fontSize: "var(--font-size-label)", color: "var(--text-secondary)" }}>{reason}</span>
        ) : null}
      </span>
    </span>
  );
}

// ── Step-up ceremony (D-class: every money confirm) ────────────────────

/**
 * The slice of an auth adapter the ceremony binds to. Structurally
 * compatible with the auth block's AuthAdapter - pass yours straight in.
 */
export interface StepUpVerifier {
  verifyTotp(code: string): Promise<{ status: "ok" | "invalid" | "2fa-required"; message?: string }>;
}

export interface StepUpConfirmProps {
  /** Names what is being authorized in the ceremony copy. */
  kind: "transfer" | "payout";
  /** The commit CTA, restating the amount: "Send 100.00 EUR". */
  commitLabel: string;
  verifier: StepUpVerifier;
  /** Fires only after the code verifies - the commit, exactly once. */
  onConfirmed: () => void;
  onCancel: () => void;
  submitting?: boolean;
  style?: CSSProperties;
  className?: string;
}

const otpSlotStyle: CSSProperties = {
  width: "var(--space-xl)",
  height: "var(--space-2xl)",
  boxSizing: "content-box",
  padding: "var(--space-2xs)",
  textAlign: "center",
  border: "var(--border-w-hairline) solid var(--border-strong)",
  borderRadius: "var(--radius-control)",
  fontSize: "var(--font-size-value)",
  fontFamily: "var(--font-family)",
  fontVariantNumeric: "tabular-nums",
  color: "var(--text-primary)",
  background: "var(--surface-raised)",
};

/**
 * Step-up re-auth on a money confirm: a 6-digit code against YOUR auth
 * adapter, verified BEFORE the commit fires. This is app-side ceremony -
 * the Venly APIs do not require or check it - and the integrator guide
 * says so plainly. One shared component for every confirm.
 */
export function StepUpConfirm({
  kind,
  commitLabel,
  verifier,
  onConfirmed,
  onCancel,
  submitting,
  style,
  className,
}: StepUpConfirmProps): ReactElement {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  return (
    <form
      className={className}
      style={{ ...cardStyle, display: "flex", flexDirection: "column", gap: "var(--space-lg)", fontFamily: "var(--font-family)", maxWidth: "var(--form-max-width)", ...style }}
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        setVerifying(true);
        void verifier.verifyTotp(code).then((result) => {
          setVerifying(false);
          if (result.status === "ok") {
            onConfirmed();
          } else {
            setError("That code didn't match. Try again.");
          }
        });
      }}
    >
      <h3 style={{ margin: 0, fontSize: "var(--font-size-value)", fontWeight: 600, color: "var(--text-primary)" }}>
        Confirm it's you
      </h3>
      <p style={{ margin: 0, fontSize: "var(--font-size-body)", color: "var(--text-secondary)" }}>
        Enter your 6-digit code to authorize this {kind}.
      </p>
      <OneTimePasswordField.Root
        value={code}
        onValueChange={setCode}
        validationType="numeric"
        aria-label="6-digit authorization code"
        style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-xs)" }}
      >
        {Array.from({ length: 6 }, (_, i) => (
          <OneTimePasswordField.Input key={i} style={otpSlotStyle} />
        ))}
        <OneTimePasswordField.HiddenInput />
      </OneTimePasswordField.Root>
      {error ? (
        <p role="alert" style={{ margin: 0, fontSize: "var(--font-size-label)", color: "var(--state-danger-fg)" }}>
          {error}
        </p>
      ) : null}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-sm)" }}>
        <button type="submit" disabled={verifying || submitting || code.length < 6} style={primaryButton}>
          {verifying || submitting ? "Confirming…" : commitLabel}
        </button>
        <button type="button" style={quietButton} onClick={onCancel} disabled={verifying || submitting}>
          Back
        </button>
      </div>
    </form>
  );
}

// ── The door ───────────────────────────────────────────────────────────

export interface RecipientPickerProps {
  platformName: string;
  directory: { entries: DirectoryEntry[]; isPending?: boolean; isError?: boolean; refetch?: () => void };
  savedRecipients: { rows: SavedRecipientRow[]; isPending?: boolean; isError?: boolean; refetch?: () => void };
  onPickPerson: (entry: DirectoryEntry) => void;
  onPickRecipient: (row: SavedRecipientRow) => void;
  onAddRecipient?: () => void;
  onGoToWithdraw: () => void;
  onInvite?: () => void;
  style?: CSSProperties;
  className?: string;
}

/**
 * The one recipient picker: two populated classes plus the own-bank link
 * row. The fork is the recipient's object type - never a rail choice.
 * Sending to a raw external wallet address has no surface here at all.
 */
export function RecipientPicker({
  platformName,
  directory,
  savedRecipients,
  onPickPerson,
  onPickRecipient,
  onAddRecipient,
  onGoToWithdraw,
  onInvite,
  style,
  className,
}: RecipientPickerProps): ReactElement {
  return (
    <div
      className={className}
      style={{ display: "flex", flexDirection: "column", gap: "var(--space-xl)", fontFamily: "var(--font-family)", maxWidth: "var(--form-max-width)", ...style }}
    >
      <section style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
        <h2 style={sectionHeading}>People on {platformName}</h2>
        {directory.isError ? (
          <ListLoadError what="the people you can pay" onRetry={directory.refetch} />
        ) : directory.isPending ? (
          <p style={{ margin: 0, color: "var(--text-tertiary)", fontSize: "var(--font-size-body)" }}>Loading people…</p>
        ) : (
          <DirectoryPick
            entries={directory.entries}
            platformName={platformName}
            onSelect={onPickPerson}
            onInvite={onInvite}
          />
        )}
      </section>

      <section style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
        <h2 style={sectionHeading}>Saved recipients</h2>
        {savedRecipients.isError ? (
          <ListLoadError what="your saved recipients" onRetry={savedRecipients.refetch} />
        ) : savedRecipients.isPending ? (
          <p style={{ margin: 0, color: "var(--text-tertiary)", fontSize: "var(--font-size-body)" }}>Loading recipients…</p>
        ) : savedRecipients.rows.length === 0 ? (
          <div style={{ ...cardStyle }}>
            <p style={{ margin: 0, fontSize: "var(--font-size-body)", color: "var(--text-primary)" }}>
              No saved recipients. Add a recipient to pay a bank account.
            </p>
            {onAddRecipient ? (
              <button type="button" style={{ ...quietButton, marginTop: "var(--space-lg)" }} onClick={onAddRecipient}>
                Add a recipient
              </button>
            ) : null}
          </div>
        ) : (
          savedRecipients.rows.map((row) => {
            const usable = row.route?.status === "ACTIVE";
            return (
              <button
                key={row.key}
                type="button"
                disabled={!usable}
                aria-disabled={!usable}
                onClick={() => usable && onPickRecipient(row)}
                style={{ ...rowButton, cursor: usable ? "pointer" : "not-allowed", opacity: usable ? 1 : 0.75 }}
              >
                <RecipientRowBody row={row} />
                {(() => {
                  const pill = row.accountStatus ? PAYOUT_BANK_ACCOUNT_STATUS_PILL[row.accountStatus] : undefined;
                  return pill ? <StatusPill {...pill} /> : null;
                })()}
              </button>
            );
          })
        )}
      </section>

      <section style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
        <h2 style={sectionHeading}>Your own bank account</h2>
        <button type="button" onClick={onGoToWithdraw} style={rowButton}>
          <span style={{ display: "flex", flexDirection: "column", gap: "var(--space-3xs)" }}>
            <span style={{ fontSize: "var(--font-size-body)", fontWeight: 500, color: "var(--text-primary)" }}>
              Withdraw to your bank
            </span>
            <span style={{ fontSize: "var(--font-size-label)", color: "var(--text-secondary)" }}>
              Move money between accounts you already control.
            </span>
          </span>
          <span aria-hidden="true" style={{ color: "var(--text-tertiary)" }}>→</span>
        </button>
      </section>
    </div>
  );
}

// ── Recents on the door (per-intent panes; the cross-ledger feed is Activity) ──

export const TRANSFER_STATUS_PILL: Record<string, { label: string; intent: StatusIntent }> = {
  PENDING: { label: "Pending", intent: "pending" },
  COMPLETED: { label: "Completed", intent: "positive" },
  FAILED: { label: "Failed", intent: "negative" },
};

export const PAYOUT_STATUS_PILL: Record<string, { label: string; intent: StatusIntent }> = {
  REQUESTED: { label: "Requested", intent: "pending" },
  SENDING: { label: "Sending", intent: "active" },
  PROVIDER_PROCESSING: { label: "Provider processing", intent: "active" },
  COMPLETED: { label: "Completed", intent: "positive" },
  REJECTED: { label: "Rejected", intent: "negative" },
  FAILED: { label: "Failed", intent: "negative" },
  // Money came back - a neutral terminal, never styled as a plain failure.
  RETURNED: { label: "Returned", intent: "neutral" },
};

function threeBands<Row>(
  items: Row[],
  statusOf: (row: Row) => string,
  pendingFamily: Set<string>,
  completed: Set<string>,
): { key: string; label: string; rows: Row[]; attention?: boolean }[] {
  const pending = items.filter((i) => pendingFamily.has(statusOf(i)));
  const done = items.filter((i) => completed.has(statusOf(i)));
  const incomplete = items.filter(
    (i) => !pendingFamily.has(statusOf(i)) && !completed.has(statusOf(i)),
  );
  return [
    { key: "pending", label: "In progress", rows: pending, attention: pending.length > 0 },
    { key: "completed", label: "Completed", rows: done },
    { key: "incomplete", label: "Didn't complete", rows: incomplete },
  ];
}

/** Recent platform transfers on the door: pending above terminal. */
export function SendRecentTransfers({
  accountId,
  onOpen,
  style,
  className,
}: {
  accountId?: string;
  onOpen?: (transfer: Transfer) => void;
  style?: CSSProperties;
  className?: string;
}): ReactElement {
  const query = useTransfers(accountId);
  if (query.isPending) {
    return <p className={className} style={{ margin: 0, color: "var(--text-tertiary)", fontFamily: "var(--font-family)", fontSize: "var(--font-size-body)", ...style }}>Loading transfers…</p>;
  }
  if (query.isError || !query.data || query.data.resultPresent === false) {
    return <ListLoadError what="your transfers" onRetry={() => void query.refetch()} />;
  }
  const items = query.data.items ?? [];
  const columns: DataTableColumn<Transfer>[] = [
    {
      key: "transfer",
      header: "Transfer",
      cell: (t) => (
        <RowText
          primary={t.description ?? t.merchantReference ?? (t.fiatOrigin?.currency ? `Transfer (${t.fiatOrigin.currency})` : "Transfer")}
          secondary={t.asset && t.chain ? `${t.asset} · ${t.chain}` : undefined}
        />
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (t) => {
        const pill = TRANSFER_STATUS_PILL[t.status ?? ""];
        return pill ? <StatusPill {...pill} /> : <span style={{ color: "var(--text-tertiary)" }}>—</span>;
      },
    },
    {
      key: "created",
      header: "Created",
      cell: (t) => (
        <span style={{ fontSize: "var(--font-size-label)", color: "var(--text-secondary)" }}>
          {t.createdAt ? new Date(t.createdAt).toISOString().slice(0, 10) : "—"}
        </span>
      ),
    },
    {
      key: "amount",
      header: "Amount",
      money: true,
      cell: (t) => <Money amount={t.amount ?? null} currency={t.asset ?? undefined} />,
    },
  ];
  return (
    <div className="venly-table-scroll">
      <DataTable
        className={className}
        style={style}
        columns={columns}
        rows={items}
        groups={threeBands(items, (t) => t.status ?? "", new Set(["PENDING"]), new Set(["COMPLETED"]))}
        rowKey={(t) => t.id ?? ""}
        onRowClick={onOpen}
        emptyMessage="No transfers yet."
      />
    </div>
  );
}

const PAYOUT_PENDING_FAMILY = new Set(["REQUESTED", "SENDING", "PROVIDER_PROCESSING"]);

/** Recent payouts on the door: pending above terminal. */
export function SendRecentPayouts({
  accountId,
  onOpen,
  style,
  className,
}: {
  accountId?: string;
  onOpen?: (payout: Payout) => void;
  style?: CSSProperties;
  className?: string;
}): ReactElement {
  const query = usePayouts(accountId);
  if (query.isPending) {
    return <p className={className} style={{ margin: 0, color: "var(--text-tertiary)", fontFamily: "var(--font-family)", fontSize: "var(--font-size-body)", ...style }}>Loading payouts…</p>;
  }
  if (query.isError || !query.data || query.data.resultPresent === false) {
    return <ListLoadError what="your payouts" onRetry={() => void query.refetch()} />;
  }
  const items = query.data.items ?? [];
  const columns: DataTableColumn<Payout>[] = [
    {
      key: "payout",
      header: "Payout",
      cell: (p) => (
        <RowText
          primary={p.payoutRoute?.fiatCurrency ? `Bank payout (${p.payoutRoute.fiatCurrency})` : "Bank payout"}
          secondary={
            p.payoutRoute?.depositAsset
              ? `${p.payoutRoute.depositAsset.name} · ${p.payoutRoute.depositAsset.chain}`
              : undefined
          }
        />
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (p) => {
        const pill = PAYOUT_STATUS_PILL[p.status ?? ""];
        return pill ? <StatusPill {...pill} /> : <span style={{ color: "var(--text-tertiary)" }}>—</span>;
      },
    },
    {
      key: "requested",
      header: "Requested",
      cell: (p) => (
        <span style={{ fontSize: "var(--font-size-label)", color: "var(--text-secondary)" }}>
          {p.requestedAt ? new Date(p.requestedAt).toISOString().slice(0, 10) : "—"}
        </span>
      ),
    },
    {
      key: "amount",
      header: "Amount",
      money: true,
      cell: (p) => (
        <Money amount={p.cryptoAmount ?? null} currency={p.payoutRoute?.depositAsset?.name ?? undefined} />
      ),
    },
  ];
  return (
    <div className="venly-table-scroll">
      <DataTable
        className={className}
        style={style}
        columns={columns}
        rows={items}
        groups={threeBands(items, (p) => p.status ?? "", PAYOUT_PENDING_FAMILY, new Set(["COMPLETED"]))}
        rowKey={(p) => p.id ?? ""}
        onRowClick={onOpen}
        emptyMessage="No payouts yet."
      />
    </div>
  );
}

/** The door: picker on top, each intent's own recent movements below. */
export function SendDoor(props: RecipientPickerProps & {
  accountId?: string;
  onOpenTransfer?: (transfer: Transfer) => void;
  onOpenPayout?: (payout: Payout) => void;
}): ReactElement {
  const { accountId, onOpenTransfer, onOpenPayout, ...picker } = props;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2xl)" }}>
      <RecipientPicker {...picker} />
      <section>
        <h2 style={{ ...sectionHeading, marginBottom: "var(--space-md)" }}>Recent transfers</h2>
        <SendRecentTransfers accountId={accountId} onOpen={onOpenTransfer} />
      </section>
      <section>
        <h2 style={{ ...sectionHeading, marginBottom: "var(--space-md)" }}>Recent payouts</h2>
        <SendRecentPayouts accountId={accountId} onOpen={onOpenPayout} />
      </section>
    </div>
  );
}

// ── Intent 1: platform transfer flow ───────────────────────────────────

type SendUnit =
  | { kind: "fiat"; currency: string }
  | { kind: "crypto"; asset: string; chain: string };

function unitLabel(unit: SendUnit): string {
  return unit.kind === "fiat" ? unit.currency : `${unit.asset} · ${unit.chain}`;
}

interface StagedPlatformTransfer {
  entry: DirectoryEntry;
  amount: number;
  unit: SendUnit;
  merchantReference?: string;
  description?: string;
}

function PlatformAmountStep({
  accountId,
  entry,
  onStaged,
  onBack,
}: {
  accountId?: string;
  entry: DirectoryEntry;
  onStaged: (staged: StagedPlatformTransfer) => void;
  onBack: () => void;
}): ReactElement {
  const { data: wallets } = useWallets(accountId);
  const { data: assets } = useAccountSupportedAssets(accountId);
  const [mode, setMode] = useState<"fiat" | "crypto">("fiat");
  const [raw, setRaw] = useState("");
  const [currency, setCurrency] = useState("EUR");
  const [assetIndex, setAssetIndex] = useState(0);
  const [reference, setReference] = useState("");
  const [description, setDescription] = useState("");

  const assetRows = assets?.items ?? [];
  const chosenAsset = assetRows[assetIndex];
  const amount = parseAmountInput(raw);

  const walletRows = wallets?.items ?? [];
  const availableFor = (asset: string): number => {
    let sum = 0;
    for (const row of walletRows) {
      if (row.asset === asset) sum += Number(row.amount?.available ?? 0);
    }
    return sum;
  };
  const maxAvailable = walletRows.reduce(
    (max, row) => Math.max(max, Number(row.amount?.available ?? 0)),
    0,
  );
  // Over-balance gate (the withdraw flow's precedent). Crypto: against the entered asset's
  // available. Fiat: the fiat side has no wallet row and no pre-create rate
  // exists, so the gate blocks only what no balance could fund - amounts
  // above every available row. The API stays the authority either way and
  // its refusal renders verbatim.
  const overBalance =
    accountId !== undefined &&
    amount !== null &&
    (mode === "crypto" && chosenAsset
      ? amount > availableFor(chosenAsset.cryptoCurrency ?? "")
      : amount > maxAvailable);

  const unit: SendUnit | null =
    mode === "fiat"
      ? currency.trim().length >= 3
        ? { kind: "fiat", currency: currency.trim().toUpperCase() }
        : null
      : chosenAsset
        ? { kind: "crypto", asset: chosenAsset.cryptoCurrency ?? "", chain: chosenAsset.chain ?? "" }
        : null;
  const ready = amount !== null && !overBalance && unit !== null;

  return (
    <form
      style={{ fontFamily: "var(--font-family)", maxWidth: "var(--form-max-width)", display: "flex", flexDirection: "column", gap: "var(--space-lg)" }}
      onSubmit={(e) => {
        e.preventDefault();
        if (!ready || !unit) return;
        onStaged({
          entry,
          amount: amount as number,
          unit,
          merchantReference: reference || undefined,
          description: description || undefined,
        });
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-md)" }}>
        <Avatar name={entry.name} />
        <span style={{ fontSize: "var(--font-size-body)", color: "var(--text-primary)", fontWeight: 500 }}>
          {entry.name}
          {entry.handle ? (
            <span style={{ color: "var(--text-secondary)", fontWeight: 400 }}> ({entry.handle})</span>
          ) : null}
        </span>
      </div>

      <div role="radiogroup" aria-label="What you send" style={{ display: "flex", gap: "var(--space-2xs)" }}>
        {(["fiat", "crypto"] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={mode === m}
            onClick={() => setMode(m)}
            style={{
              ...quietButton,
              padding: "var(--space-2xs) var(--space-md)",
              fontWeight: mode === m ? 600 : 400,
              background: mode === m ? "var(--selected-tint)" : "var(--surface-raised)",
            }}
          >
            {m === "fiat" ? "Currency" : "Crypto asset"}
          </button>
        ))}
      </div>

      <div>
        <label style={labelStyle} htmlFor="vf-send-amount">
          You send
        </label>
        <div style={{ display: "flex", border: "var(--border-w-hairline) solid var(--border-strong)", borderRadius: "var(--radius-control)", background: "var(--surface-raised)", overflow: "hidden" }}>
          <input
            id="vf-send-amount"
            inputMode="decimal"
            style={{ ...inputStyle, border: "none", flex: 1, minWidth: 0, fontVariantNumeric: "tabular-nums" }}
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
          />
          {mode === "fiat" ? (
            <input
              aria-label="Currency"
              style={{ ...inputStyle, border: "none", borderLeft: "var(--border-w-hairline) solid var(--border-hairline)", width: "5.5em", flex: "none", textTransform: "uppercase" }}
              value={currency}
              onChange={(e) => setCurrency(e.target.value.toUpperCase())}
            />
          ) : (
            <select
              aria-label="Asset and chain"
              style={{ border: "none", borderLeft: "var(--border-w-hairline) solid var(--border-hairline)", background: "var(--surface-raised)", fontFamily: "var(--font-family)", fontSize: "var(--font-size-body)", color: "var(--text-primary)", padding: "0 var(--space-md)", cursor: "pointer", maxWidth: "45%" }}
              value={assetIndex}
              onChange={(e) => setAssetIndex(Number(e.target.value))}
            >
              {assetRows.map((row, i) => (
                <option key={`${row.cryptoCurrency}-${row.chain}`} value={i}>
                  {row.cryptoCurrency} · {row.chain}
                </option>
              ))}
            </select>
          )}
        </div>
        {mode === "crypto" && chosenAsset ? (
          // A crypto leg without a visible network label is unshippable.
          <p style={{ margin: "var(--space-2xs) 0 0", fontSize: "var(--font-size-label)", color: "var(--text-secondary)" }}>
            This amount is in {chosenAsset.cryptoCurrency} on {chosenAsset.chain}.
          </p>
        ) : null}
        {accountId !== undefined ? (
          <p style={{ margin: "var(--space-2xs) 0 0", fontSize: "var(--font-size-label)", color: overBalance ? "var(--state-danger-fg)" : "var(--text-secondary)" }}>
            {mode === "crypto" && chosenAsset
              ? `Available: ${formatAmount(availableFor(chosenAsset.cryptoCurrency ?? ""))} ${chosenAsset.cryptoCurrency}`
              : walletRows.length > 0
                ? `Available: ${walletRows
                    .map((row) => `${formatAmount(Number(row.amount?.available ?? 0))} ${row.asset}`)
                    .join(" · ")}`
                : "Available: —"}
          </p>
        ) : null}
        {overBalance ? (
          <p role="alert" style={{ margin: "var(--space-2xs) 0 0", fontSize: "var(--font-size-label)", color: "var(--state-danger-fg)" }}>
            That's more than your available balance.
          </p>
        ) : null}
      </div>

      <div>
        <label style={labelStyle} htmlFor="vf-send-reference">
          Reference (visible to your team and the recipient)
        </label>
        <input
          id="vf-send-reference"
          style={inputStyle}
          value={reference}
          onChange={(e) => setReference(e.target.value)}
        />
      </div>
      <div>
        <label style={labelStyle} htmlFor="vf-send-description">
          Description (internal note)
        </label>
        <input
          id="vf-send-description"
          style={inputStyle}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-sm)" }}>
        <button type="submit" disabled={!ready} style={primaryButton}>
          Review transfer
        </button>
        <button type="button" style={quietButton} onClick={onBack}>
          Back
        </button>
      </div>
    </form>
  );
}

export interface SendReviewProps {
  staged: StagedPlatformTransfer;
  onConfirm: () => void;
  onEdit: () => void;
  submitting?: boolean;
  style?: CSSProperties;
  className?: string;
}

/**
 * Intent-1 review: the known figures and nothing else. Fee, ETA and rate
 * rows are omissions - these operations return none of them pre-create;
 * the created record's own fields render on the detail.
 */
export function SendReview({ staged, onConfirm, onEdit, submitting, style, className }: SendReviewProps): ReactElement {
  const fields: FieldRow[] = [
    {
      label: "To",
      value: staged.entry.handle ? `${staged.entry.name} (${staged.entry.handle})` : staged.entry.name,
      copyable: false,
    },
    {
      label: "You send",
      value: `${formatAmount(staged.amount)} ${unitLabel(staged.unit)}`,
      copyable: false,
      mono: true,
    },
  ];
  if (staged.merchantReference) {
    fields.push({ label: "Reference (visible to your team and the recipient)", value: staged.merchantReference, copyable: false });
  }
  if (staged.description) {
    fields.push({ label: "Description (internal note)", value: staged.description, copyable: false });
  }
  return (
    <section className={className} style={{ fontFamily: "var(--font-family)", maxWidth: "var(--form-max-width)", display: "flex", flexDirection: "column", gap: "var(--space-lg)", ...style }}>
      <h2 style={sectionHeading}>Review</h2>
      <div>
        <FieldList fields={fields} />
        <p style={{ margin: "var(--space-sm) 0 0", fontSize: "var(--font-size-label)", color: "var(--text-secondary)" }}>
          On-platform transfer
        </p>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-sm)" }}>
        <button type="button" disabled={submitting} style={primaryButton} onClick={onConfirm}>
          {`Send ${formatAmount(staged.amount)} ${unitLabel(staged.unit)}`}
        </button>
        <button type="button" disabled={submitting} style={quietButton} onClick={onEdit}>
          Edit
        </button>
      </div>
    </section>
  );
}

export interface PlatformTransferFlowProps {
  /** Sender account: balances, directory exclusion and the create call. */
  senderAccountId?: string;
  platformName: string;
  /** Your auth adapter; every money confirm passes the step-up ceremony. */
  verifier: StepUpVerifier;
  /** Preselects a directory entry (e.g. picked on the door). */
  initialReceiverAccountId?: string;
  /** Fires with the created transfer id - route to the detail page. */
  onCreated?: (transferId: string) => void;
  onInvite?: () => void;
  style?: CSSProperties;
  className?: string;
}

type PlatformStep =
  | { step: "pick" }
  | { step: "amount"; entry: DirectoryEntry }
  | { step: "review"; staged: StagedPlatformTransfer }
  | { step: "step-up"; staged: StagedPlatformTransfer };

/** Directory pick → amount → review → step-up → create → detail. */
export function PlatformTransferFlow({
  senderAccountId,
  platformName,
  verifier,
  initialReceiverAccountId,
  onCreated,
  onInvite,
  style,
  className,
}: PlatformTransferFlowProps): ReactElement {
  const directory = useDirectoryEntries(senderAccountId);
  const fiat = useCreateFiatTransfer();
  const cryptoFlow = useCreateCryptoTransfer();
  const [flow, setFlow] = useState<PlatformStep>({ step: "pick" });
  const [reportedId, setReportedId] = useState<string | null>(null);

  // A door row can preselect the person; the flow then opens on the amount.
  const preselected =
    flow.step === "pick" && initialReceiverAccountId
      ? directory.entries.find(
          (e) => e.receiverAccountId === initialReceiverAccountId && e.verification === "verified",
        )
      : undefined;
  if (preselected) {
    setFlow({ step: "amount", entry: preselected });
  }

  const active = flow.step === "step-up" && flow.staged.unit.kind === "crypto" ? cryptoFlow : fiat;
  const transfer =
    active.state.phase === "pending" || active.state.phase === "completed" || active.state.phase === "failed"
      ? active.state.transfer
      : undefined;
  // Notify AFTER commit: `onCreated` belongs to the parent (typically a
  // router navigation), and calling it during render updates another
  // component mid-render.
  const transferId = transfer?.id;
  useEffect(() => {
    if (transferId && onCreated && reportedId !== transferId) {
      setReportedId(transferId);
      onCreated(transferId);
    }
  }, [transferId, onCreated, reportedId]);

  if (transfer && !onCreated) {
    return (
      <ConnectedTransferDetail
        accountId={senderAccountId}
        transferId={transfer.id}
        className={className}
        style={style}
      />
    );
  }

  if (flow.step === "step-up") {
    const { staged } = flow;
    const failed = active.state.phase === "failed" ? active.state : undefined;
    return (
      <div className={className} style={{ display: "flex", flexDirection: "column", gap: "var(--space-lg)", ...style }}>
        <StepUpConfirm
          kind="transfer"
          commitLabel={`Send ${formatAmount(staged.amount)} ${unitLabel(staged.unit)}`}
          verifier={verifier}
          submitting={active.state.phase === "submitting"}
          onCancel={() => setFlow({ step: "review", staged })}
          onConfirmed={() => {
            // The commit fires only after the code verified. Staging pins
            // the idempotency key; retrying this confirm replays the record.
            if (staged.unit.kind === "fiat") {
              if (fiat.state.phase === "draft") {
                fiat.stage({
                  senderAccountId: senderAccountId ?? "",
                  body: {
                    receiverAccountId: staged.entry.receiverAccountId,
                    currency: staged.unit.currency,
                    amount: staged.amount,
                    merchantReference: staged.merchantReference,
                    description: staged.description,
                  },
                });
              }
              void fiat.confirm();
            } else {
              if (cryptoFlow.state.phase === "draft") {
                cryptoFlow.stage({
                  senderAccountId: senderAccountId ?? "",
                  body: {
                    receiverAccountId: staged.entry.receiverAccountId,
                    asset: staged.unit.asset,
                    chain: staged.unit.chain as CryptoTransferDraft["body"]["chain"],
                    amount: staged.amount,
                    merchantReference: staged.merchantReference,
                    description: staged.description,
                  },
                });
              }
              void cryptoFlow.confirm();
            }
          }}
        />
        {failed && failed.reason === "submit-error" ? (
          <div role="alert" style={{ ...cardStyle, fontFamily: "var(--font-family)", maxWidth: "var(--form-max-width)" }}>
            <p style={{ margin: 0, fontSize: "var(--font-size-body)", color: "var(--state-danger-fg)" }}>
              {failed.error instanceof Error ? failed.error.message : "The request was refused."}
            </p>
            <button
              type="button"
              style={{ ...quietButton, marginTop: "var(--space-md)" }}
              onClick={() => {
                fiat.reset();
                cryptoFlow.reset();
                setFlow({ step: "amount", entry: staged.entry });
              }}
            >
              Back to amount
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  if (flow.step === "review") {
    return (
      <SendReview
        className={className}
        style={style}
        staged={flow.staged}
        onEdit={() => setFlow({ step: "amount", entry: flow.staged.entry })}
        onConfirm={() => setFlow({ step: "step-up", staged: flow.staged })}
      />
    );
  }

  if (flow.step === "amount") {
    return (
      <div className={className} style={style}>
        <PlatformAmountStep
          accountId={senderAccountId}
          entry={flow.entry}
          onBack={() => setFlow({ step: "pick" })}
          onStaged={(staged) => setFlow({ step: "review", staged })}
        />
      </div>
    );
  }

  if (directory.isError) {
    return (
      <section className={className} style={{ fontFamily: "var(--font-family)", ...style }}>
        <ListLoadError what="the people you can pay" onRetry={directory.refetch} />
      </section>
    );
  }
  if (directory.isPending) {
    return (
      <p className={className} style={{ margin: 0, color: "var(--text-tertiary)", fontFamily: "var(--font-family)", fontSize: "var(--font-size-body)", ...style }}>
        Loading people…
      </p>
    );
  }
  return (
    <DirectoryPick
      className={className}
      style={style}
      entries={directory.entries}
      platformName={platformName}
      onInvite={onInvite}
      onSelect={(entry) => setFlow({ step: "amount", entry })}
    />
  );
}

// ── Transfer detail (3 states, verbatim) ───────────────────────────────

function CopyValueRow({
  label,
  value,
  display,
}: {
  label: string;
  value: string;
  display: string;
}): ReactElement {
  const [copied, setCopied] = useState(false);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-md)", padding: "var(--space-sm) 0" }}>
      <span style={{ fontSize: "var(--font-size-label)", color: "var(--text-secondary)", flex: "none" }}>{label}</span>
      <span style={{ fontFamily: "var(--font-family-mono, monospace)", fontSize: "var(--font-size-body)", color: "var(--text-primary)", overflowWrap: "anywhere" }}>
        {display}
      </span>
      <button
        type="button"
        aria-label={`Copy ${label}`}
        style={{ ...quietButton, marginLeft: "auto", padding: "var(--space-3xs) var(--space-sm)", fontSize: "var(--font-size-label)" }}
        onClick={() => {
          void navigator.clipboard?.writeText(value).then(() => setCopied(true));
        }}
      >
        Copy
      </button>
      {copied ? (
        <span role="status" style={{ fontSize: "var(--font-size-micro)", color: "var(--text-tertiary)" }}>
          {label} copied
        </span>
      ) : null}
    </div>
  );
}

function middleEllipsis(value: string): string {
  return value.length > 22 ? `${value.slice(0, 12)}…${value.slice(-8)}` : value;
}

/**
 * "What we've seen" - the app-side observation log. The transfer read
 * carries no stage list and no event log, so the UI states only what it
 * observed itself: when the record says it was created, when this surface
 * last checked, and the status it saw. Timestamps are absolute, always.
 */
function ObservationLog({
  createdAt,
  lastCheckedAt,
  statusLabel,
}: {
  createdAt?: string;
  lastCheckedAt?: number;
  statusLabel: string;
}): ReactElement {
  return (
    <div style={cardStyle}>
      <h3 style={{ ...sectionHeading, marginBottom: "var(--space-sm)" }}>What we've seen</h3>
      <ul style={{ margin: 0, paddingLeft: "var(--space-lg)", fontSize: "var(--font-size-label)", color: "var(--text-secondary)", display: "flex", flexDirection: "column", gap: "var(--space-2xs)" }}>
        <li>Created {createdAt ? formatStamp(createdAt) : "—"}</li>
        <li>Last checked {lastCheckedAt ? formatStamp(new Date(lastCheckedAt)) : "—"}</li>
        <li>Current status: {statusLabel}</li>
      </ul>
    </div>
  );
}

export interface TransferDetailProps {
  transfer: Transfer;
  /** When this surface last read the record (query dataUpdatedAt). */
  observedAt?: number;
  style?: CSSProperties;
  className?: string;
}

export function TransferDetail({ transfer, observedAt, style, className }: TransferDetailProps): ReactElement {
  const pill = TRANSFER_STATUS_PILL[transfer.status ?? ""] ?? { label: transfer.status ?? "—", intent: "neutral" as StatusIntent };
  const unit = transfer.asset ? `${transfer.asset}${transfer.chain ? ` · ${transfer.chain}` : ""}` : (transfer.fiatOrigin?.currency ?? "");
  const fields: FieldRow[] = [
    {
      label: "You send",
      value: transfer.amount !== undefined ? `${formatAmount(transfer.amount)} ${unit}` : null,
      copyable: false,
      mono: true,
    },
  ];
  if (transfer.fiatOrigin?.amount !== undefined && transfer.fiatOrigin.currency) {
    fields.push({
      label: "Fiat origin",
      value: `${formatAmount(transfer.fiatOrigin.amount)} ${transfer.fiatOrigin.currency}`,
      copyable: false,
      mono: true,
    });
  }
  if (transfer.merchantReference) {
    fields.push({ label: "Reference (visible to your team and the recipient)", value: transfer.merchantReference, copyable: false });
  }
  if (transfer.description) {
    fields.push({ label: "Description (internal note)", value: transfer.description, copyable: false });
  }
  fields.push({ label: "Transfer id", value: transfer.id ?? null, mono: true });
  fields.push({ label: "Created", value: transfer.createdAt ? formatStamp(transfer.createdAt) : null, copyable: false });
  if (transfer.updatedAt) {
    fields.push({ label: "Updated", value: formatStamp(transfer.updatedAt), copyable: false });
  }

  return (
    <section className={className} style={{ fontFamily: "var(--font-family)", maxWidth: "var(--form-max-width)", display: "flex", flexDirection: "column", gap: "var(--space-lg)", ...style }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "var(--space-lg)", flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, fontSize: "var(--font-size-value)", fontWeight: 600, color: "var(--text-primary)" }}>
          Transfer
        </h2>
        <StatusPill {...pill} />
      </div>

      {transfer.status === "FAILED" ? (
        <div role="alert" style={cardStyle}>
          <p style={{ margin: 0, fontSize: "var(--font-size-body)", fontWeight: 500, color: "var(--state-danger-fg)" }}>
            This transfer didn't complete.
          </p>
          {transfer.errorMessage ? (
            <p style={{ margin: "var(--space-sm) 0 0", fontSize: "var(--font-size-body)", color: "var(--text-primary)" }}>
              {transfer.errorMessage}
            </p>
          ) : null}
          <p style={{ margin: "var(--space-sm) 0 0", fontSize: "var(--font-size-label)", color: "var(--text-secondary)" }}>
            Contact support with the reference below.
          </p>
        </div>
      ) : null}

      <FieldList fields={fields} />
      {transfer.fiatOrigin?.exchangeRate !== undefined ? (
        // Rendered beside the figures, from the created record's own field.
        <p style={{ margin: 0, fontSize: "var(--font-size-label)", color: "var(--text-secondary)" }}>
          Exchange rate ({transfer.fiatOrigin.currency ?? ""} → {transfer.asset ?? ""}): {transfer.fiatOrigin.exchangeRate}
        </p>
      ) : null}
      {transfer.transactionHash ? (
        <div style={cardStyle}>
          <CopyValueRow
            label="Transaction hash"
            value={transfer.transactionHash}
            display={middleEllipsis(transfer.transactionHash)}
          />
        </div>
      ) : null}

      <ObservationLog
        createdAt={transfer.createdAt}
        lastCheckedAt={observedAt}
        statusLabel={pill.label}
      />
    </section>
  );
}

/** Detail bound to the read; a load failure renders an explicit error + retry, never an empty detail. */
export function ConnectedTransferDetail({
  accountId,
  transferId,
  style,
  className,
}: {
  accountId?: string;
  transferId?: string;
  style?: CSSProperties;
  className?: string;
}): ReactElement {
  const query = useTransfer(accountId, transferId);
  if (query.isError) {
    return (
      <section role="alert" className={className} style={{ fontFamily: "var(--font-family)", ...style }}>
        <ListLoadError what="this transfer" onRetry={() => void query.refetch()} />
      </section>
    );
  }
  if (query.isPending || !query.data) {
    return (
      <p className={className} style={{ margin: 0, fontFamily: "var(--font-family)", color: "var(--text-tertiary)", fontSize: "var(--font-size-body)", ...style }}>
        Loading transfer…
      </p>
    );
  }
  return (
    <TransferDetail transfer={query.data} observedAt={query.dataUpdatedAt} style={style} className={className} />
  );
}

// ── Intent 3: verified third-party payout flow ─────────────────────────

interface StagedPayout {
  recipient: SavedRecipientRow;
  route: NonNullable<SavedRecipientRow["route"]>;
  cryptoAmount: number;
  /** Minted ONCE when the draft stages; stable across every retry. */
  idempotencyKey: string;
}

function PayoutAmountStep({
  accountId,
  recipient,
  onStaged,
  onBack,
}: {
  accountId?: string;
  recipient: SavedRecipientRow;
  onStaged: (staged: StagedPayout) => void;
  onBack: () => void;
}): ReactElement {
  const route = recipient.route as NonNullable<SavedRecipientRow["route"]>;
  const { data: wallets } = useWallets(accountId);
  const [raw, setRaw] = useState("");
  const amount = parseAmountInput(raw);
  const asset = route.depositAssetName ?? "";
  const available = (wallets?.items ?? []).reduce(
    (sum, row) => (row.asset === asset ? sum + Number(row.amount?.available ?? 0) : sum),
    0,
  );
  const overBalance = accountId !== undefined && amount !== null && amount > available;
  const ready = amount !== null && !overBalance;
  return (
    <form
      style={{ fontFamily: "var(--font-family)", maxWidth: "var(--form-max-width)", display: "flex", flexDirection: "column", gap: "var(--space-lg)" }}
      onSubmit={(e) => {
        e.preventDefault();
        if (!ready) return;
        onStaged({
          recipient,
          route,
          cryptoAmount: amount as number,
          idempotencyKey: crypto.randomUUID(),
        });
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-md)" }}>
        <RecipientRowBody row={recipient} />
      </div>
      <div>
        <label style={labelStyle} htmlFor="vf-payout-amount">
          You send
        </label>
        <div style={{ display: "flex", border: "var(--border-w-hairline) solid var(--border-strong)", borderRadius: "var(--radius-control)", background: "var(--surface-raised)", overflow: "hidden" }}>
          <input
            id="vf-payout-amount"
            inputMode="decimal"
            style={{ ...inputStyle, border: "none", flex: 1, minWidth: 0, fontVariantNumeric: "tabular-nums" }}
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
          />
          <span style={{ display: "inline-flex", alignItems: "center", padding: "0 var(--space-md)", fontSize: "var(--font-size-body)", color: "var(--text-secondary)", borderLeft: "var(--border-w-hairline) solid var(--border-hairline)", whiteSpace: "nowrap" }}>
            {asset} · {route.depositAssetChain}
          </span>
        </div>
        <p style={{ margin: "var(--space-2xs) 0 0", fontSize: "var(--font-size-label)", color: "var(--text-secondary)" }}>
          This amount is in {asset} on {route.depositAssetChain}.
        </p>
        {accountId !== undefined ? (
          <p style={{ margin: "var(--space-2xs) 0 0", fontSize: "var(--font-size-label)", color: overBalance ? "var(--state-danger-fg)" : "var(--text-secondary)" }}>
            Available: {formatAmount(available)} {asset}
          </p>
        ) : null}
        {overBalance ? (
          <p role="alert" style={{ margin: "var(--space-2xs) 0 0", fontSize: "var(--font-size-label)", color: "var(--state-danger-fg)" }}>
            That's more than your available balance.
          </p>
        ) : null}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-sm)" }}>
        <button type="submit" disabled={!ready} style={primaryButton}>
          Review payout
        </button>
        <button type="button" style={quietButton} onClick={onBack}>
          Back
        </button>
      </div>
    </form>
  );
}

/**
 * Intent-3 review: the two-sided sentence names both sides' UNITS and the
 * parties, and deliberately carries no fiat figure - no quote exists before
 * the payout, and the settled amount is a field on the COMPLETED record.
 * The line below states that absence in words.
 */
export function PayoutReview({
  staged,
  onConfirm,
  onEdit,
  submitting,
  style,
  className,
}: {
  staged: StagedPayout;
  onConfirm: () => void;
  onEdit: () => void;
  submitting?: boolean;
  style?: CSSProperties;
  className?: string;
}): ReactElement {
  const { recipient, route } = staged;
  const fields: FieldRow[] = [
    {
      label: "To",
      value: [recipient.accountHolderName, recipient.bankName, recipient.last4 ? `••${recipient.last4}` : undefined]
        .filter(Boolean)
        .join(" · "),
      copyable: false,
    },
    {
      label: "You send",
      value: `${formatAmount(staged.cryptoAmount)} ${route.depositAssetName} · ${route.depositAssetChain}`,
      copyable: false,
      mono: true,
    },
  ];
  return (
    <section className={className} style={{ fontFamily: "var(--font-family)", maxWidth: "var(--form-max-width)", display: "flex", flexDirection: "column", gap: "var(--space-lg)", ...style }}>
      <h2 style={sectionHeading}>Review</h2>
      <FieldList fields={fields} />
      <div>
        <p style={{ margin: 0, fontSize: "var(--font-size-body)", color: "var(--text-primary)" }}>
          You send {formatAmount(staged.cryptoAmount)} {route.depositAssetName} on {route.depositAssetChain}.{" "}
          {recipient.accountHolderName} receives {route.fiatCurrency ?? recipient.fiatCurrency}{" "}
          via {recipient.rail}.
        </p>
        <p style={{ margin: "var(--space-sm) 0 0", fontSize: "var(--font-size-label)", color: "var(--text-secondary)" }}>
          Fee and delivery time aren't shown before you send – you'll see the exact amounts once the payout completes.
        </p>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-sm)" }}>
        <button type="button" disabled={submitting} style={primaryButton} onClick={onConfirm}>
          {`Request payout of ${formatAmount(staged.cryptoAmount)} ${route.depositAssetName}`}
        </button>
        <button type="button" disabled={submitting} style={quietButton} onClick={onEdit}>
          Edit
        </button>
      </div>
    </section>
  );
}

export interface PayoutSendFlowProps {
  accountId?: string;
  /** Saved recipients with their route join (see SavedRecipientRow). */
  recipients: { rows: SavedRecipientRow[]; isPending?: boolean; isError?: boolean; refetch?: () => void };
  verifier: StepUpVerifier;
  /** Preselects a recipient row (picked on the door) by its key. */
  initialRecipientKey?: string;
  onCreated?: (payoutId: string) => void;
  onGoToRecipients?: () => void;
  style?: CSSProperties;
  className?: string;
}

type PayoutStep =
  | { step: "pick" }
  | { step: "amount"; recipient: SavedRecipientRow }
  | { step: "review"; staged: StagedPayout }
  | { step: "step-up"; staged: StagedPayout };

/** ACTIVE-route pick → crypto amount → review → step-up → requestPayout. */
export function PayoutSendFlow({
  accountId,
  recipients,
  verifier,
  initialRecipientKey,
  onCreated,
  onGoToRecipients,
  style,
  className,
}: PayoutSendFlowProps): ReactElement {
  const request = useRequestPayout();
  const [flow, setFlow] = useState<PayoutStep>({ step: "pick" });
  const [reportedId, setReportedId] = useState<string | null>(null);

  const preselected =
    flow.step === "pick" && initialRecipientKey
      ? recipients.rows.find((r) => r.key === initialRecipientKey && r.route?.status === "ACTIVE")
      : undefined;
  if (preselected) {
    setFlow({ step: "amount", recipient: preselected });
  }

  const created = request.data;
  // Notify AFTER commit, same rule as PlatformTransferFlow: the parent's
  // callback navigates, and navigating during render updates the router
  // while this component renders.
  const createdId = created?.id;
  useEffect(() => {
    if (createdId && onCreated && reportedId !== createdId) {
      setReportedId(createdId);
      onCreated(createdId);
    }
  }, [createdId, onCreated, reportedId]);
  if (created?.id && !onCreated) {
    return (
      <ConnectedPayoutDetail accountId={accountId} payoutId={created.id} style={style} className={className} />
    );
  }

  if (flow.step === "step-up") {
    const { staged } = flow;
    return (
      <div className={className} style={{ display: "flex", flexDirection: "column", gap: "var(--space-lg)", ...style }}>
        <StepUpConfirm
          kind="payout"
          commitLabel={`Request payout of ${formatAmount(staged.cryptoAmount)} ${staged.route.depositAssetName}`}
          verifier={verifier}
          submitting={request.isPending}
          onCancel={() => setFlow({ step: "review", staged })}
          onConfirmed={() => {
            // One key per staged draft: a retry of this confirm carries the
            // SAME key and the API replays the original payout.
            request.mutate({
              accountId: accountId ?? "",
              body: {
                payoutRouteId: staged.route.id,
                cryptoAmount: staged.cryptoAmount,
                idempotencyKey: staged.idempotencyKey,
              },
            });
          }}
        />
        {request.isError ? (
          <div role="alert" style={{ ...cardStyle, fontFamily: "var(--font-family)", maxWidth: "var(--form-max-width)" }}>
            <p style={{ margin: 0, fontSize: "var(--font-size-body)", color: "var(--state-danger-fg)" }}>
              {request.error instanceof Error ? request.error.message : "The request was refused."}
            </p>
            <button
              type="button"
              style={{ ...quietButton, marginTop: "var(--space-md)" }}
              onClick={() => {
                request.reset();
                setFlow({ step: "amount", recipient: staged.recipient });
              }}
            >
              Back to amount
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  if (flow.step === "review") {
    return (
      <PayoutReview
        className={className}
        style={style}
        staged={flow.staged}
        submitting={request.isPending}
        onEdit={() => setFlow({ step: "amount", recipient: flow.staged.recipient })}
        onConfirm={() => setFlow({ step: "step-up", staged: flow.staged })}
      />
    );
  }

  if (flow.step === "amount") {
    return (
      <div className={className} style={style}>
        <PayoutAmountStep
          accountId={accountId}
          recipient={flow.recipient}
          onBack={() => setFlow({ step: "pick" })}
          onStaged={(staged) => setFlow({ step: "review", staged })}
        />
      </div>
    );
  }

  if (recipients.isError) {
    return (
      <section className={className} style={{ fontFamily: "var(--font-family)", ...style }}>
        <ListLoadError what="your saved recipients" onRetry={recipients.refetch} />
      </section>
    );
  }
  if (recipients.isPending) {
    return (
      <p className={className} style={{ margin: 0, color: "var(--text-tertiary)", fontFamily: "var(--font-family)", fontSize: "var(--font-size-body)", ...style }}>
        Loading recipients…
      </p>
    );
  }

  const anyUsable = recipients.rows.some((r) => r.route?.status === "ACTIVE");
  if (!anyUsable) {
    return (
      <section className={className} style={{ ...cardStyle, fontFamily: "var(--font-family)", maxWidth: "var(--form-max-width)", ...style }}>
        <p style={{ margin: 0, fontSize: "var(--font-size-body)", color: "var(--text-primary)" }}>
          {recipients.rows.length === 0
            ? "No saved recipients. Add a recipient to pay a bank account."
            : "None of your recipients has an active route yet. Finish setup in Recipients."}
        </p>
        {onGoToRecipients ? (
          <button type="button" style={{ ...primaryButton, marginTop: "var(--space-lg)" }} onClick={onGoToRecipients}>
            {recipients.rows.length === 0 ? "Add a recipient" : "Go to recipients"}
          </button>
        ) : null}
      </section>
    );
  }

  return (
    <div className={className} style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)", maxWidth: "var(--form-max-width)", ...style }}>
      <h2 style={sectionHeading}>Pay a saved recipient</h2>
      {recipients.rows.map((row) => {
        const usable = row.route?.status === "ACTIVE";
        return (
          <button
            key={row.key}
            type="button"
            disabled={!usable}
            aria-disabled={!usable}
            onClick={() => usable && setFlow({ step: "amount", recipient: row })}
            style={{ ...rowButton, cursor: usable ? "pointer" : "not-allowed", opacity: usable ? 1 : 0.75 }}
          >
            <RecipientRowBody row={row} />
            {(() => {
              const pill = row.route?.status ? PAYOUT_ROUTE_STATUS_PILL[row.route.status] : undefined;
              return pill ? <StatusPill {...pill} /> : null;
            })()}
          </button>
        );
      })}
    </div>
  );
}

// ── Payout detail (all 7 statuses, verbatim) ───────────────────────────

/** P7: waiting states say who acts next. Only states that ARE waits carry copy. */
export function payoutWaitingCopy(status: string | undefined): string | null {
  switch (status) {
    case "REQUESTED":
      return "Requested – waiting for the platform to send the funds; no action needed from you.";
    case "SENDING":
      return "Sending – the platform is sending the funds to the payout provider; no action needed from you.";
    case "PROVIDER_PROCESSING":
      return "Provider processing – the payout provider is executing; no action needed from you.";
    default:
      return null;
  }
}

export interface PayoutDetailProps {
  payout: Payout;
  observedAt?: number;
  style?: CSSProperties;
  className?: string;
}

export function PayoutDetail({ payout, observedAt, style, className }: PayoutDetailProps): ReactElement {
  const pill = PAYOUT_STATUS_PILL[payout.status ?? ""] ?? { label: payout.status ?? "—", intent: "neutral" as StatusIntent };
  const asset = payout.payoutRoute?.depositAsset?.name ?? "";
  const chain = payout.payoutRoute?.depositAsset?.chain ?? "";
  const beneficiary = payout.payoutRoute?.beneficiary;
  const waiting = payoutWaitingCopy(payout.status);

  const fields: FieldRow[] = [
    {
      label: "You send",
      value:
        payout.cryptoAmount !== undefined
          ? `${formatAmount(payout.cryptoAmount)} ${asset}${chain ? ` · ${chain}` : ""}`
          : null,
      copyable: false,
      mono: true,
    },
    {
      label: "Settled amount",
      // P8 explicit null: the field exists post-create; its value arrives
      // on completion. Never a guessed figure.
      value:
        payout.settledFiatAmount !== undefined
          ? `${formatAmount(payout.settledFiatAmount)} ${payout.payoutRoute?.fiatCurrency ?? ""}`
          : "– confirmed on completion",
      copyable: false,
      mono: payout.settledFiatAmount !== undefined,
    },
  ];
  if (beneficiary) {
    fields.push({
      label: "To",
      value: [
        beneficiary.accountHolderName,
        beneficiary.bankName,
        beneficiary.details?.ibanLast4
          ? `••${beneficiary.details.ibanLast4}`
          : beneficiary.details?.accountNumberLast4
            ? `••${beneficiary.details.accountNumberLast4}`
            : undefined,
      ]
        .filter(Boolean)
        .join(" · "),
      copyable: false,
    });
  }
  if (payout.rail) fields.push({ label: "Rail", value: payout.rail, copyable: false });
  if (payout.fundingMode) fields.push({ label: "Funding mode", value: payout.fundingMode, copyable: false });
  fields.push({ label: "Payout id", value: payout.id ?? null, mono: true });
  fields.push({ label: "Requested", value: payout.requestedAt ? formatStamp(payout.requestedAt) : null, copyable: false });
  if (payout.completedAt) {
    fields.push({ label: "Completed", value: formatStamp(payout.completedAt), copyable: false });
  }

  return (
    <section className={className} style={{ fontFamily: "var(--font-family)", maxWidth: "var(--form-max-width)", display: "flex", flexDirection: "column", gap: "var(--space-lg)", ...style }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "var(--space-lg)", flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, fontSize: "var(--font-size-value)", fontWeight: 600, color: "var(--text-primary)" }}>
          Payout
        </h2>
        <StatusPill {...pill} />
      </div>

      {waiting ? (
        <p style={{ margin: 0, fontSize: "var(--font-size-body)", color: "var(--text-secondary)" }}>{waiting}</p>
      ) : null}

      {payout.status === "RETURNED" ? (
        <div style={cardStyle}>
          <p style={{ margin: 0, fontSize: "var(--font-size-body)", color: "var(--text-primary)" }}>
            Returned – the receiving bank sent this payout back. The funds are back in your account.
          </p>
          {payout.failureReason ? (
            <p style={{ margin: "var(--space-sm) 0 0", fontSize: "var(--font-size-label)", color: "var(--text-secondary)" }}>
              {payout.failureReason}
            </p>
          ) : null}
        </div>
      ) : null}

      {(payout.status === "FAILED" || payout.status === "REJECTED") && payout.failureReason ? (
        <div role="alert" style={cardStyle}>
          <p style={{ margin: 0, fontSize: "var(--font-size-body)", color: "var(--state-danger-fg)" }}>
            {payout.failureReason}
          </p>
        </div>
      ) : null}

      <FieldList fields={fields} />

      {payout.sendTxHash ? (
        <div style={cardStyle}>
          <CopyValueRow label="Transaction hash" value={payout.sendTxHash} display={middleEllipsis(payout.sendTxHash)} />
        </div>
      ) : null}

      <ObservationLog createdAt={payout.requestedAt} lastCheckedAt={observedAt} statusLabel={pill.label} />
    </section>
  );
}

/** Detail bound to the read; a load failure renders an explicit error + retry, never an empty detail. */
export function ConnectedPayoutDetail({
  accountId,
  payoutId,
  style,
  className,
}: {
  accountId?: string;
  payoutId?: string;
  style?: CSSProperties;
  className?: string;
}): ReactElement {
  const query = usePayout(accountId, payoutId);
  if (query.isError) {
    return (
      <section role="alert" className={className} style={{ fontFamily: "var(--font-family)", ...style }}>
        <ListLoadError what="this payout" onRetry={() => void query.refetch()} />
      </section>
    );
  }
  if (query.isPending || !query.data) {
    return (
      <p className={className} style={{ margin: 0, fontFamily: "var(--font-family)", color: "var(--text-tertiary)", fontSize: "var(--font-size-body)", ...style }}>
        Loading payout…
      </p>
    );
  }
  return <PayoutDetail payout={query.data} observedAt={query.dataUpdatedAt} style={style} className={className} />;
}
