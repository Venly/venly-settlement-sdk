import { type CSSProperties, type ReactElement, type ReactNode } from "react";
import type { Account, MockTenantConfig, Party } from "@venlyfinance/sdk";
import {
  DataTable,
  RowText,
  TableSkeleton,
  type DataTableColumn,
} from "../components/data-table.js";
import { ListLoadError } from "../components/list-error.js";
import { FieldList, type FieldRow } from "../components/field-list.js";
import { StatusPill, type StatusIntent } from "../components/status-pill.js";
import { formatStamp } from "../lib/money.js";

/**
 * Console tenant – identity, sandbox configuration, and honest boundaries.
 *
 * Design contract encoded by this block:
 * - REACHABLE identity facts render from the wrapped finance reads: the
 *   operating company party and the tenant's accounts, statuses verbatim.
 * - The STATIC MOCK TENANT CONFIG renders read-only, badged as sandbox
 *   configuration: enabled providers and lane preferences shaped against
 *   the management schemas. It is the causal half of what the consumer
 *   surfaces offer – the rails/lanes here must match what the consumer
 *   mock actually serves (a config row contradicting the consumer surface
 *   is a seeded falsehood; the SDK's tenant-config test asserts the join).
 * - NO drivers, NO CRUD: the tenant write surface lives on the management
 *   plane, which is not exposed here. Every write renders as a labelled
 *   omission whose copy names the next step, never only the absence.
 * - The whole screen sits inside a Platform-view section boundary (the
 *   host page provides it): tenant configuration is Venly's seat.
 */

// ─── User-facing copy ────────────────────────────────────────────────────────

export const TENANT_COPY = {
  identityTitle: "Company",
  accountsTitle: "Accounts under this tenant",
  accountsEmpty: "No accounts yet. Accounts appear when onboarding creates them.",
  configBadge: "Platform view · sandbox configuration",
  configBody:
    "Seeded, read-only facts about this sandbox tenant. They explain which rails, lanes and assets the consumer app offers - the same mock world serves both.",
  vbaProvidersTitle: "Virtual bank account providers",
  payoutProvidersTitle: "Payout providers",
  vbaLanesTitle: "Pay-in lanes",
  payoutLanesTitle: "Payout lanes",
  omissionsTitle: "Managed by Venly",
  providerOmission:
    "Provider enablement is configured by Venly for your tenant - contact your account manager to change it.",
  laneOmission:
    "Pay-in and payout lane preferences are configured by Venly for your tenant - contact your account manager to change them.",
  statusOmission:
    "Tenant status changes are performed by Venly - contact your account manager if this tenant should be suspended or reactivated.",
} as const;

const KYB_PILL: Record<string, { label: string; intent: StatusIntent }> = {
  PENDING: { label: "Verification pending", intent: "pending" },
  VERIFIED: { label: "Verified", intent: "positive" },
  DENIED: { label: "Denied", intent: "negative" },
};

const KYC_PILL: Record<string, { label: string; intent: StatusIntent }> = {
  VERIFICATION_PENDING: { label: "Verification pending", intent: "pending" },
  VERIFIED: { label: "Verified", intent: "positive" },
  REJECTED: { label: "Rejected", intent: "negative" },
  NOT_REQUIRED: { label: "Verification not required", intent: "neutral" },
};

const STATUS_PILL: Record<string, { label: string; intent: StatusIntent }> = {
  ACTIVE: { label: "Active", intent: "positive" },
  SUSPENDED: { label: "Suspended", intent: "pending" },
  CLOSED: { label: "Closed", intent: "neutral" },
  BLOCKED: { label: "Blocked", intent: "negative" },
};

function pill(
  map: Record<string, { label: string; intent: StatusIntent }>,
  value: string | undefined,
): ReactElement {
  const entry = (value && map[value]) || { label: value ?? "—", intent: "neutral" as const };
  return <StatusPill label={entry.label} intent={entry.intent} />;
}

function SectionTitle({ children }: { children: ReactNode }): ReactElement {
  return (
    <h3
      style={{
        margin: 0,
        fontSize: "var(--font-size-label)",
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        fontWeight: 600,
        color: "var(--text-secondary)",
      }}
    >
      {children}
    </h3>
  );
}

function OmissionCard({ copy }: { copy: string }): ReactElement {
  return (
    <p
      role="note"
      style={{
        margin: 0,
        fontSize: "var(--font-size-label)",
        color: "var(--text-secondary)",
        background: "var(--surface-sunken)",
        border: "var(--border-w-hairline) solid var(--border-hairline)",
        borderRadius: "var(--radius-control)",
        padding: "var(--space-sm) var(--space-md)",
      }}
    >
      {copy}
    </p>
  );
}

// ─── The view ────────────────────────────────────────────────────────────────

export interface TenantViewProps {
  /** The operating company party (organisation), when the world has one. */
  company?: Party;
  accounts: Account[];
  config: MockTenantConfig;
  loading?: boolean;
  /** `resultPresent === false` on the accounts read. */
  loadFailed?: boolean;
  onRetry?: () => void;
  style?: CSSProperties;
  className?: string;
}

export function TenantView({
  company,
  accounts,
  config,
  loading,
  loadFailed,
  onRetry,
  style,
  className,
}: TenantViewProps): ReactElement {
  const accountColumns: DataTableColumn<Account>[] = [
    {
      key: "name",
      header: "Account",
      cell: (a) => <RowText primary={a.name ?? undefined} secondary={a.externalId} />,
    },
    { key: "status", header: "Status", cell: (a) => pill(STATUS_PILL, a.status) },
    { key: "kycStatus", header: "Verification", cell: (a) => pill(KYC_PILL, a.kycStatus) },
    {
      key: "createdAt",
      header: "Created",
      cell: (a) => (a.createdAt ? formatStamp(a.createdAt) : undefined),
    },
  ];

  if (loading) {
    return <TableSkeleton columns={accountColumns} label="Loading tenant" style={style} />;
  }
  if (loadFailed) {
    return <ListLoadError what="your tenant's accounts" onRetry={onRetry} />;
  }

  // Rows the record does not carry are omitted rather than rendered as the
  // "(not required)" variant - identity facts are not payer instructions.
  const identity: FieldRow[] = [
    { label: "Company", value: company?.name, copyable: false },
    { label: "Type", value: company?.partyType, copyable: false },
    { label: "Party id", value: company?.id, mono: true },
    ...(company?.createdAt
      ? [{ label: "Created", value: formatStamp(company.createdAt), copyable: false }]
      : []),
  ];

  const laneColumns: DataTableColumn<MockTenantConfig["vbaLanePreferences"][number]>[] = [
    { key: "fiat", header: "Fiat", cell: (l) => l.fiatCurrency },
    { key: "crypto", header: "Asset", cell: (l) => l.cryptoCurrency },
    { key: "chain", header: "Chain", cell: (l) => l.chain },
    { key: "provider", header: "Provider", cell: (l) => l.providerType },
  ];

  const payoutLaneColumns: DataTableColumn<
    MockTenantConfig["payoutLanePreferences"][number]
  >[] = [
    { key: "asset", header: "Source asset", cell: (l) => l.sourceAsset },
    { key: "chain", header: "Chain", cell: (l) => l.chain },
    { key: "fiat", header: "Fiat", cell: (l) => l.fiatCurrency },
    { key: "rail", header: "Rail", cell: (l) => l.rail },
    { key: "provider", header: "Provider", cell: (l) => l.providerType },
  ];

  return (
    <div
      className={className}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-2xl)",
        fontFamily: "var(--font-family)",
        ...style,
      }}
    >
      {/* ── Identity (reachable, verbatim) ── */}
      <section style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
        <SectionTitle>{TENANT_COPY.identityTitle}</SectionTitle>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)", flexWrap: "wrap" }}>
          {company?.kybStatus && pill(KYB_PILL, company.kybStatus)}
          {company?.status && pill(STATUS_PILL, company.status)}
        </div>
        <FieldList fields={identity} />
      </section>

      {/* ── Accounts (reachable, verbatim) ── */}
      <section style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
        <SectionTitle>{TENANT_COPY.accountsTitle}</SectionTitle>
        <div style={{ overflowX: "auto" }}>
          <DataTable
            columns={accountColumns}
            rows={accounts}
            rowKey={(a) => a.id ?? a.externalId ?? ""}
            emptyMessage={TENANT_COPY.accountsEmpty}
            style={{ minWidth: 560 }}
          />
        </div>
      </section>

      {/* ── Sandbox configuration (static mock config, read-only) ── */}
      <section
        style={{
          borderTop: "var(--border-w-hairline) solid var(--border-strong)",
          paddingTop: "var(--space-sm)",
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-md)",
        }}
      >
        <div>
          <SectionTitle>{TENANT_COPY.configBadge}</SectionTitle>
          <p
            style={{
              margin: "var(--space-3xs) 0 0",
              fontSize: "var(--font-size-micro)",
              color: "var(--text-tertiary)",
            }}
          >
            {TENANT_COPY.configBody}
          </p>
        </div>

        <div style={{ display: "flex", gap: "var(--space-2xl)", flexWrap: "wrap" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2xs)" }}>
            <SectionTitle>{TENANT_COPY.vbaProvidersTitle}</SectionTitle>
            <div style={{ display: "flex", gap: "var(--space-xs)", flexWrap: "wrap" }}>
              {config.vbaProviders.map((p) => (
                <StatusPill key={p.providerType} label={p.providerType} intent="neutral" glyph="●" />
              ))}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2xs)" }}>
            <SectionTitle>{TENANT_COPY.payoutProvidersTitle}</SectionTitle>
            <div style={{ display: "flex", gap: "var(--space-xs)", flexWrap: "wrap" }}>
              {config.payoutProviders.map((p) => (
                <StatusPill key={p.providerType} label={p.providerType} intent="neutral" glyph="●" />
              ))}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2xs)" }}>
          <SectionTitle>{TENANT_COPY.vbaLanesTitle}</SectionTitle>
          <div style={{ overflowX: "auto" }}>
            <DataTable
              columns={laneColumns}
              rows={[...config.vbaLanePreferences]}
              rowKey={(l) => `${l.fiatCurrency}-${l.cryptoCurrency}-${l.chain}`}
              style={{ minWidth: 420 }}
            />
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2xs)" }}>
          <SectionTitle>{TENANT_COPY.payoutLanesTitle}</SectionTitle>
          <div style={{ overflowX: "auto" }}>
            <DataTable
              columns={payoutLaneColumns}
              rows={[...config.payoutLanePreferences]}
              rowKey={(l) => `${l.sourceAsset}-${l.fiatCurrency}-${l.rail}`}
              style={{ minWidth: 480 }}
            />
          </div>
        </div>
      </section>

      {/* ── The write surface, honestly: omissions that name the next step ── */}
      <section style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
        <SectionTitle>{TENANT_COPY.omissionsTitle}</SectionTitle>
        <OmissionCard copy={TENANT_COPY.providerOmission} />
        <OmissionCard copy={TENANT_COPY.laneOmission} />
        <OmissionCard copy={TENANT_COPY.statusOmission} />
      </section>
    </div>
  );
}
