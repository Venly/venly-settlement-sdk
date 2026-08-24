import { useMemo, useState, type ReactElement, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQueries, useQuery } from "@tanstack/react-query";
import type { Account, Party, PartyIvVerification } from "@venlyfinance/sdk";
import {
  useAccounts,
  useParties,
  useTransfers,
  usePayouts,
  usePayoutRoutes,
  useVenly,
  useVenlyMock,
  useVirtualBankAccounts,
  useWallets,
  venlyQueries,
} from "@venlyfinance/react";
import {
  ConsoleQueue,
  deriveKycActor,
  deriveRouteActor,
  WhoseMove,
  type ConsoleQueueRow,
  type Derivation,
} from "../../components/venly/blocks/console-queue.js";
import {
  CONSOLE_DECISION_COPY,
  ConsoleDecisionPanel,
  DecisionForm,
  DualTimeline,
  EvidenceStack,
  PlatformSection,
  type DualTimelineNode,
  type EvidenceRow,
} from "../../components/venly/blocks/console-decision.js";
import { DataTable, type DataTableColumn } from "../../components/venly/components/data-table.js";
import { useNarrowViewport } from "../../console/ConsoleShell.js";
import { StatusPill, type StatusIntent } from "../../components/venly/components/status-pill.js";
import { Money, formatStamp } from "../../components/venly/lib/money.js";

/**
 * Console – Customers. The KYC review queue (class C1) and the decision
 * panel / customer 360 (class C2) over the finance-plane reads:
 * accounts × party roles × parties × party IV verification.
 *
 * The decision writes through the mock driver, standing in for the
 * management-plane kyc patch; the freeze control is a demo driver for a
 * write no contract carries, and is badged as one.
 */

// ─── Copy ────────────────────────────────────────────────────────────────────

const COPY = {
  emptyHeadline: "No customers yet",
  emptyBody: "Rows appear here when a customer starts onboarding in the consumer app.",
  screeningOmission:
    "Screening result is held on Venly's internal platform and is not exposed on this API.",
  amlOmission:
    "Wallet AML status is held on Venly's internal platform and is not exposed on this API.",
  freezeOmission:
    "Wallet-level AML controls are held on Venly's internal platform and are not exposed on this API.",
} as const;

// ─── Shared joins ────────────────────────────────────────────────────────────

const KYC_PILL: Record<string, { label: string; intent: StatusIntent }> = {
  VERIFICATION_PENDING: { label: "Verification pending", intent: "pending" },
  VERIFIED: { label: "Verified", intent: "positive" },
  REJECTED: { label: "Rejected", intent: "negative" },
  NOT_REQUIRED: { label: "Verification not required", intent: "neutral" },
};

function kycPill(status: string | undefined): { label: string; intent: StatusIntent } {
  return (status && KYC_PILL[status]) || { label: status ?? "Unknown", intent: "neutral" };
}

interface JoinedCustomerRow {
  account: Account;
  holder?: Party;
  iv?: PartyIvVerification;
  derivation: Derivation;
}

/**
 * The queue's join: every account, its holder party (via the account's
 * party-roles read), and the holder's IV state (via the contract's
 * iv-verification read). Small N in the reference data set, so the N+1 is
 * two extra reads per row against the local mock.
 */
function useCustomerRows(): { rows: JoinedCustomerRow[]; loading: boolean; error: boolean; refetch: () => void } {
  const clients = useVenly();
  const accountsQuery = useAccounts();
  const partiesQuery = useParties();
  const accounts = useMemo(
    () => (accountsQuery.data?.items ?? []).filter((a): a is Account => a != null),
    [accountsQuery.data],
  );

  const roleQueries = useQueries({
    queries: accounts.map((account) => ({
      queryKey: ["venly", "account", account.id ?? "", "party-roles"],
      queryFn: () => clients.finance.accounts.listPartyRoles(account.id ?? ""),
      enabled: Boolean(account.id),
    })),
  });

  const parties = useMemo(
    () => (partiesQuery.data?.items ?? []).filter((p): p is Party => p != null),
    [partiesQuery.data],
  );
  const holderIds = roleQueries.map((q) => q.data?.items?.[0]?.partyId);

  const ivQueries = useQueries({
    queries: holderIds.map((partyId) => ({
      ...venlyQueries.partyIvVerification(clients, partyId ?? ""),
      enabled: Boolean(partyId),
    })),
  });

  const rows = accounts.map((account, index) => {
    const holder = parties.find((p) => p.id === holderIds[index]);
    const iv = ivQueries[index]?.data;
    const derivation = deriveKycActor({
      accountKycStatus: account.kycStatus,
      ivStatus: iv?.status,
      partyKybStatus: holder?.kybStatus,
      partyKycStatus: holder?.kycStatus,
    });
    return { account, holder, iv, derivation };
  });

  return {
    rows,
    loading:
      accountsQuery.isPending ||
      partiesQuery.isPending ||
      roleQueries.some((q) => q.isPending && q.fetchStatus !== "idle") ||
      ivQueries.some((q) => q.isPending && q.fetchStatus !== "idle"),
    error: accountsQuery.isError || (accountsQuery.data ? accountsQuery.data.resultPresent === false : false),
    refetch: () => void accountsQuery.refetch(),
  };
}

function holderName(holder: Party | undefined): string {
  if (!holder) return "";
  return holder.name ?? [holder.firstName, holder.lastName].filter(Boolean).join(" ");
}

// ─── Evidence + decision + trail (shared by panel and 360) ──────────────────

function evidenceRows(row: JoinedCustomerRow): EvidenceRow[] {
  const holderIsOrg = row.holder?.partyType === "ORGANISATION";
  return [
    { kind: "value", label: "Identity verification", value: row.iv?.status },
    { kind: "value", label: "Case reference", value: row.iv?.ivCaseReference, mono: true },
    {
      kind: "value",
      label: "Linked",
      value: row.iv?.linkedAt ? formatStamp(row.iv.linkedAt) : undefined,
      copyable: false,
    },
    {
      kind: "value",
      label: holderIsOrg ? "Party verification (KYB)" : "Party verification (KYC)",
      value: holderIsOrg ? row.holder?.kybStatus : row.holder?.kycStatus,
      copyable: false,
    },
    { kind: "value", label: "Account decision", value: row.account.kycStatus, copyable: false },
    { kind: "omission", label: "Screening result", copy: COPY.screeningOmission },
    { kind: "omission", label: "Wallet AML status", copy: COPY.amlOmission },
  ];
}

const DECISION_EVENT_TYPES = new Set([
  "account.verification_changed",
  "party.verification_changed",
  "party.iv_status_changed",
  "account.status_changed",
  "party.status_changed",
]);
const MONEY_EVENT_TYPES = new Set([
  "transfer.created",
  "transfer.status_changed",
  "payout.requested",
  "payout.status_changed",
  "inbound_credit.received",
]);

/** Seat attribution by event type: who owns that move, not an invented name. */
function eventActor(type: string): { actor: string; role: string } {
  if (type === "party.iv_status_changed") return { actor: "Identity provider", role: "screening" };
  if (type.startsWith("transfer.") || type === "payout.requested") {
    return { actor: "Customer", role: "consumer app" };
  }
  if (type === "inbound_credit.received") return { actor: "Bank", role: "simulated" };
  if (type.startsWith("payout")) return { actor: "Provider", role: "simulated" };
  return { actor: "Operator", role: "console seat" };
}

function eventLabel(type: string, previous?: string, next?: string): string {
  const change = previous || next ? ` ${previous ?? "?"} → ${next ?? "?"}` : "";
  switch (type) {
    case "account.verification_changed":
      return `Account decision${change}`;
    case "party.verification_changed":
      return `Party verification${change}`;
    case "party.iv_status_changed":
      return `Screening${change}`;
    case "account.status_changed":
      return `Account status${change}`;
    case "party.status_changed":
      return `Party status${change}`;
    case "transfer.created":
      return "Transfer created";
    case "transfer.status_changed":
      return `Transfer${change}`;
    case "payout.requested":
      return "Payout requested";
    case "payout.status_changed":
      return `Payout${change}`;
    case "inbound_credit.received":
      return "Bank credit received";
    default:
      return type;
  }
}

function useCustomerTrail(row: JoinedCustomerRow | undefined): {
  decision: DualTimelineNode[];
  money: DualTimelineNode[];
} {
  const { finance } = useVenlyMock();
  const accountId = row?.account.id;
  const holderId = row?.holder?.id;
  const trailQuery = useQuery({
    queryKey: ["venly", "mock-events", accountId ?? "", holderId ?? ""],
    queryFn: () =>
      finance
        ? finance.simulations
            .events!.list()
            .filter(
              (e) =>
                e.accountId === accountId ||
                (e.resource.kind === "party" && e.resource.id === holderId) ||
                e.type === "store.resync",
            )
        : [],
    enabled: Boolean(finance && accountId),
  });
  const events = trailQuery.data ?? [];
  const toNode = (e: (typeof events)[number]): DualTimelineNode => {
    if (e.type === "store.resync") return { kind: "system", key: e.id };
    const status = (e.data as { status?: string; kycStatus?: string; kybStatus?: string } | undefined) ?? {};
    // Which field the event changed depends on its type: a verification
    // event changed kyc/kyb, a status event changed `status` - the account
    // row carries both, and reading the wrong one narrates a false change.
    const next = e.type.endsWith("verification_changed")
      ? status.kybStatus ?? status.kycStatus
      : status.status;
    const { actor, role } = eventActor(e.type);
    return {
      kind: "node",
      key: e.id,
      label: eventLabel(e.type, e.previous?.status, next),
      state:
        next === "REJECTED" || next === "DENIED" || next === "FAILED" ? "failed" : "completed",
      actor,
      role,
      at: e.occurredAt,
    };
  };
  return {
    decision: events.filter((e) => DECISION_EVENT_TYPES.has(e.type) || e.type === "store.resync").map(toNode),
    money: events.filter((e) => MONEY_EVENT_TYPES.has(e.type)).map(toNode),
  };
}

/** The decision + freeze controls. Decision through the mock driver standing
 *  in for the management kyc patch; freeze through the demo driver, badged. */
function CustomerActions({
  row,
  versionAtOpen,
  onActed,
  onRefresh,
}: {
  row: JoinedCustomerRow;
  versionAtOpen: number | undefined;
  onActed: () => void;
  onRefresh: () => void;
}): ReactElement {
  const { finance } = useVenlyMock();
  const decided = row.derivation.kind === "terminal";
  // Client-side stale detection standing in for the 409: the driver carries
  // no version, so a decision made elsewhere is caught by comparing the
  // optimistic-locking version captured when the panel opened.
  const conflict =
    versionAtOpen !== undefined && row.account.version !== undefined && row.account.version !== versionAtOpen;

  const frozen = row.account.status === "SUSPENDED";

  return (
    <>
      {decided && !conflict ? null : (
        <DecisionForm
          version={row.account.version}
          conflict={conflict}
          onRefreshAfterConflict={onRefresh}
          onDecide={({ action }) => {
            if (!finance || !row.account.id) return;
            const target = action === "approve" ? "VERIFIED" : "REJECTED";
            // One ruling, both axes: the consumer surface derives
            // sendability from the HOLDER PARTY's kyc/kyb status (the
            // directory contract), while the account decision gates the
            // account itself. Deciding only the account left the party
            // pending, so an approved customer stayed "can't receive"
            // in the send door. The consumer-side verify driver has
            // always advanced both; the console decision now matches.
            const holderStatus =
              row.holder?.partyType === "ORGANISATION" ? row.holder?.kybStatus : row.holder?.kycStatus;
            const holderDecided =
              action === "approve"
                ? holderStatus === "VERIFIED"
                : holderStatus === "REJECTED" || holderStatus === "DENIED";
            if (row.holder?.id && !holderDecided) {
              finance.simulations.verification.advance(row.holder.id, target);
            }
            finance.simulations.verification.advance(row.account.id, target);
            onActed();
          }}
        />
      )}
      <PlatformSection>
        <p style={{ margin: "0 0 var(--space-2xs)", fontSize: "var(--font-size-label)", color: "var(--text-secondary)" }}>
          Account status: {row.account.status ?? "ACTIVE"}
        </p>
        <button
          type="button"
          onClick={() => {
            if (!finance || !row.account.id) return;
            finance.simulations.account.setStatus(row.account.id, frozen ? "ACTIVE" : "SUSPENDED");
            onActed();
          }}
          style={{
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
          {frozen ? "Reactivate account" : "Suspend account"}
        </button>
        <p data-badge="driver" style={{ margin: "var(--space-2xs) 0 0", fontSize: "var(--font-size-micro)", color: "var(--text-tertiary)" }}>
          {CONSOLE_DECISION_COPY.driverBadge}
        </p>
        <p style={{ margin: "var(--space-sm) 0 0", fontSize: "var(--font-size-micro)", color: "var(--text-tertiary)" }}>
          {COPY.freezeOmission}
        </p>
      </PlatformSection>
    </>
  );
}

function BalancesHeld({ accountId }: { accountId: string }): ReactElement {
  const wallets = useWallets(accountId);
  const balances = (wallets.data?.items ?? []).filter((w) => w != null);
  return (
    <div style={{ marginTop: "var(--space-md)" }}>
      <h3 style={{ margin: "0 0 var(--space-2xs)", fontSize: "var(--font-size-micro)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-secondary)" }}>
        Balances held
      </h3>
      {balances.length === 0 ? (
        <p style={{ margin: 0, fontSize: "var(--font-size-label)", color: "var(--text-tertiary)" }}>
          No balances yet – funds appear when money arrives for this account.
        </p>
      ) : (
        balances.map((w) => (
          <p key={w.asset} style={{ margin: "var(--space-3xs) 0", fontSize: "var(--font-size-label)", color: "var(--text-secondary)", display: "flex", justifyContent: "space-between", gap: "var(--space-md)" }}>
            <span>
              {w.asset} · available {" "}
              <Money amount={w.amount?.available} currency="" />
              {" "}· reserved <Money amount={w.amount?.reserved} currency="" />
            </span>
            <Money amount={w.amount?.total} currency={w.asset} />
          </p>
        ))
      )}
    </div>
  );
}

// ─── The queue page ──────────────────────────────────────────────────────────

export function ConsoleCustomersPage(): ReactElement {
  const navigate = useNavigate();
  const { rows, loading, error, refetch } = useCustomerRows();
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [versionAtOpen, setVersionAtOpen] = useState<number | undefined>(undefined);
  const nowIso = useMemo(() => new Date().toISOString(), [rows.length, loading]);

  const queueRows: ConsoleQueueRow[] = rows.map((row) => ({
    key: row.account.id ?? "",
    subject: row.account.name ?? row.account.externalId ?? row.account.id ?? "",
    subjectSecondary: holderName(row.holder),
    state: kycPill(row.account.kycStatus),
    derivation: row.derivation,
    frozen: row.account.status === "SUSPENDED",
    ageIso: row.account.createdAt,
    reference: row.account.externalId,
  }));

  const open = rows.find((row) => row.account.id === openKey);
  const trail = useCustomerTrail(open);

  const openRow = (key: string | null) => {
    setOpenKey(key);
    const target = rows.find((row) => row.account.id === key);
    setVersionAtOpen(target?.account.version);
  };

  return (
    <div>
      <h1 style={{ margin: "0 0 var(--space-lg)", fontSize: "var(--font-size-title)", fontWeight: 600, color: "var(--text-primary)" }}>
        Customers
      </h1>
      <ConsoleQueue
        rows={queueRows}
        seat="integrator"
        loading={loading}
        error={error ? { what: "the customer queue", onRetry: refetch } : undefined}
        empty={{ headline: COPY.emptyHeadline, body: COPY.emptyBody }}
        ageHeader="Age"
        nowIso={nowIso}
        onOpen={(row) => openRow(row.key)}
        selectedKey={openKey ?? undefined}
        onExportCsv={(csv) => {
          const blob = new Blob([csv], { type: "text/csv" });
          const link = document.createElement("a");
          link.href = URL.createObjectURL(blob);
          link.download = "customers.csv";
          link.click();
          URL.revokeObjectURL(link.href);
        }}
      />
      {open ? (
        <ConsoleDecisionPanel
          context={`Customer · ${open.account.externalId ?? open.account.id}`}
          subject={open.account.name ?? open.account.externalId ?? ""}
          derivation={open.derivation}
          statusPill={kycPill(open.account.kycStatus)}
          frozen={open.account.status === "SUSPENDED"}
          onClose={() => openRow(null)}
        >
          <EvidenceStack rows={evidenceRows(open)} />
          {open.account.id ? <BalancesHeld accountId={open.account.id} /> : null}
          <CustomerActions
            row={open}
            versionAtOpen={versionAtOpen}
            onActed={() => setVersionAtOpen(undefined)}
            onRefresh={() => setVersionAtOpen(open.account.version)}
          />
          <div style={{ marginTop: "var(--space-xl)" }}>
            <DualTimeline decision={trail.decision} money={trail.money} />
          </div>
          <p style={{ marginTop: "var(--space-lg)", fontSize: "var(--font-size-label)" }}>
            <button
              type="button"
              onClick={() => navigate(`/console/customers/${open.account.id}`)}
              style={{ border: "none", background: "none", color: "var(--accent)", cursor: "pointer", padding: 0, fontFamily: "var(--font-family)", fontSize: "var(--font-size-label)" }}
            >
              Open full view
            </button>
          </p>
        </ConsoleDecisionPanel>
      ) : null}
    </div>
  );
}

// ─── The customer 360 (full page – an entity, so a route) ───────────────────

type TabKey = "transfers" | "payouts" | "vbas" | "routes";

export function ConsoleCustomerDetailPage(): ReactElement {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { rows, loading } = useCustomerRows();
  const row = rows.find((r) => r.account.id === id);
  const trail = useCustomerTrail(row);
  const [tab, setTab] = useState<TabKey>("transfers");
  const [versionAtOpen, setVersionAtOpen] = useState<number | undefined>(undefined);

  const transfers = useTransfers(id);
  const payouts = usePayouts(id);
  const routes = usePayoutRoutes(id);
  const vbas = useVirtualBankAccounts(id);
  const narrow = useNarrowViewport();

  if (loading && !row) {
    return <p style={{ color: "var(--text-tertiary)" }}>Loading…</p>;
  }
  if (!row) {
    return (
      <div>
        <p style={{ color: "var(--text-secondary)" }}>No customer with this id.</p>
        <button type="button" onClick={() => navigate("/console/customers")} style={{ border: "none", background: "none", color: "var(--accent)", cursor: "pointer", padding: 0 }}>
          Back to the queue
        </button>
      </div>
    );
  }

  const pill = kycPill(row.account.kycStatus);
  const tabs: { key: TabKey; label: string; count: number }[] = [
    { key: "transfers", label: "Transfers", count: transfers.data?.items?.length ?? 0 },
    { key: "payouts", label: "Payouts", count: payouts.data?.items?.length ?? 0 },
    { key: "vbas", label: "Virtual bank accounts", count: vbas.data?.items?.length ?? 0 },
    { key: "routes", label: "Payout routes", count: routes.data?.length ?? 0 },
  ];

  return (
    <div>
      <p style={{ margin: "0 0 var(--space-2xs)", fontSize: "var(--font-size-micro)", color: "var(--text-tertiary)" }}>
        <button type="button" onClick={() => navigate("/console/customers")} style={{ border: "none", background: "none", color: "var(--text-secondary)", cursor: "pointer", padding: 0, fontSize: "var(--font-size-micro)" }}>
          Customers
        </button>
        {" / "}
        {row.account.externalId}
      </p>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-md)", flexWrap: "wrap" }}>
        <h1 style={{ margin: 0, fontSize: "var(--font-size-title)", fontWeight: 600, color: "var(--text-primary)" }}>
          {row.account.name}
        </h1>
        <StatusPill label={pill.label} intent={pill.intent} />
        {row.account.status === "SUSPENDED" ? <StatusPill label="Frozen" intent="neutral" glyph="❄" /> : null}
        <WhoseMove derivation={row.derivation} />
        {/* Read-only view of this customer's own consumer surface. */}
        <button
          type="button"
          onClick={() => navigate(`/console/customers/${row.account.id}/as-customer`)}
          style={{
            marginLeft: "auto",
            border: "var(--border-w-hairline) solid var(--border-strong)",
            background: "var(--surface-raised)",
            color: "var(--text-primary)",
            borderRadius: "var(--radius-control)",
            padding: "var(--space-2xs) var(--space-md)",
            fontSize: "var(--font-size-label)",
            fontFamily: "var(--font-family)",
            cursor: "pointer",
          }}
        >
          View as customer (read only)
        </button>
      </div>
      <p style={{ margin: "var(--space-2xs) 0 var(--space-xl)", fontSize: "var(--font-size-label)", color: "var(--text-secondary)" }}>
        Held by {holderName(row.holder)} · created {row.account.createdAt ? formatStamp(row.account.createdAt) : ""}
      </p>

      <div style={{ display: "grid", gridTemplateColumns: narrow ? "1fr" : "minmax(280px, 5fr) minmax(260px, 4fr)", gap: "var(--space-2xl)", alignItems: "start" }}>
        {/* Judging task: evidence LEFT of the decision. */}
        <div>
          <EvidenceStack rows={evidenceRows(row)} />
          {row.account.id ? <BalancesHeld accountId={row.account.id} /> : null}
          <div style={{ marginTop: "var(--space-xl)" }}>
            <DualTimeline decision={trail.decision} money={trail.money} />
          </div>
        </div>
        <div>
          <CustomerActions
            row={row}
            versionAtOpen={versionAtOpen}
            onActed={() => setVersionAtOpen(undefined)}
            onRefresh={() => setVersionAtOpen(row.account.version)}
          />
        </div>
      </div>

      {/* 360 tabs – the customer's own money reads, scoped to the account. */}
      <div style={{ marginTop: "var(--space-2xl)" }}>
        <div style={{ display: "flex", gap: "var(--space-sm)", borderBottom: "var(--border-w-hairline) solid var(--border-hairline)", overflowX: "auto" }}>
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              aria-selected={tab === t.key}
              style={{
                border: "none",
                background: "none",
                padding: "var(--space-sm) var(--space-md)",
                fontFamily: "var(--font-family)",
                fontSize: "var(--font-size-label)",
                fontWeight: tab === t.key ? 600 : 400,
                color: tab === t.key ? "var(--text-primary)" : "var(--text-secondary)",
                borderBottom: tab === t.key ? "2px solid var(--accent)" : "2px solid transparent",
                cursor: "pointer",
              }}
            >
              {t.label} <span style={{ color: "var(--text-tertiary)" }}>{t.count}</span>
            </button>
          ))}
        </div>
        <div style={{ marginTop: "var(--space-lg)", overflowX: "auto" }}>
          {tab === "transfers" ? <TransfersTab accountId={id!} /> : null}
          {tab === "payouts" ? <PayoutsTab accountId={id!} /> : null}
          {tab === "vbas" ? <VbasTab accountId={id!} /> : null}
          {tab === "routes" ? <RoutesTab accountId={id!} /> : null}
        </div>
      </div>
    </div>
  );
}

// ─── 360 tabs ────────────────────────────────────────────────────────────────

function emptyLine(text: string): ReactNode {
  return <p style={{ margin: 0, fontSize: "var(--font-size-label)", color: "var(--text-tertiary)" }}>{text}</p>;
}

function TransfersTab({ accountId }: { accountId: string }): ReactElement {
  const transfers = useTransfers(accountId);
  const items = (transfers.data?.items ?? []).filter((t) => t != null);
  type Row = (typeof items)[number];
  const columns: DataTableColumn<Row>[] = [
    { key: "desc", header: "Description", cell: (t) => t.description ?? t.id },
    { key: "status", header: "Status", cell: (t) => t.status },
    { key: "date", header: "Created", cell: (t) => (t.createdAt ? formatStamp(t.createdAt) : null) },
    { key: "amount", header: "Amount", money: true, cell: (t) => <Money amount={t.amount} currency={t.asset} /> },
  ];
  if (items.length === 0) return <>{emptyLine("No transfers on this account yet.")}</>;
  return <DataTable columns={columns} rows={items} rowKey={(t) => t.id ?? ""} />;
}

function PayoutsTab({ accountId }: { accountId: string }): ReactElement {
  const payouts = usePayouts(accountId);
  const items = (payouts.data?.items ?? []).filter((p) => p != null);
  type Row = (typeof items)[number];
  const columns: DataTableColumn<Row>[] = [
    { key: "id", header: "Payout", cell: (p) => p.id },
    { key: "status", header: "Status", cell: (p) => p.status },
    { key: "requested", header: "Requested", cell: (p) => (p.requestedAt ? formatStamp(p.requestedAt) : null) },
    {
      key: "amount",
      header: "Amount",
      money: true,
      cell: (p) => <Money amount={p.cryptoAmount} currency={p.payoutRoute?.depositAsset?.name} />,
    },
  ];
  if (items.length === 0) return <>{emptyLine("No payouts on this account yet.")}</>;
  return <DataTable columns={columns} rows={items} rowKey={(p) => p.id ?? ""} />;
}

function VbasTab({ accountId }: { accountId: string }): ReactElement {
  const vbas = useVirtualBankAccounts(accountId);
  const items = (vbas.data?.items ?? []).filter((v) => v != null);
  type Row = (typeof items)[number];
  const columns: DataTableColumn<Row>[] = [
    { key: "name", header: "Name", cell: (v) => v.name },
    { key: "iban", header: "IBAN", cell: (v) => v.iban },
    { key: "reference", header: "Reference", cell: (v) => v.referenceCode },
    { key: "status", header: "Status", cell: (v) => v.status },
  ];
  if (items.length === 0) return <>{emptyLine("No virtual bank accounts on this account yet.")}</>;
  return <DataTable columns={columns} rows={items} rowKey={(v) => v.id ?? ""} />;
}

function RoutesTab({ accountId }: { accountId: string }): ReactElement {
  const routes = usePayoutRoutes(accountId);
  const items = routes.data ?? [];
  type Row = (typeof items)[number];
  const columns: DataTableColumn<Row>[] = [
    { key: "id", header: "Route", cell: (r) => r.id },
    {
      key: "asset",
      header: "Deposit asset",
      cell: (r) => [r.depositAsset?.name, r.depositAsset?.chain].filter(Boolean).join(" · "),
    },
    { key: "status", header: "Status", cell: (r) => r.status },
    { key: "whose", header: "Whose move", cell: (r) => <WhoseMove derivation={deriveRouteActor(r.status)} seat="platform" /> },
  ];
  if (items.length === 0) return <>{emptyLine("No payout routes on this account yet.")}</>;
  return <DataTable columns={columns} rows={items} rowKey={(r) => r.id ?? ""} />;
}
