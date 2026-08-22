import { useState, type CSSProperties, type ReactElement } from "react";
import type {
  CreateWebhookRequest,
  MockWebhookDelivery,
  Webhook,
} from "@venlyfinance/sdk";
import {
  DataTable,
  RowText,
  TableSkeleton,
  type DataTableColumn,
} from "../components/data-table.js";
import { ListLoadError } from "../components/list-error.js";
import { StatusPill } from "../components/status-pill.js";
import { formatStamp } from "../lib/money.js";

/**
 * Console webhooks – registration lifecycle over the public plane.
 *
 * Design contract encoded by this block:
 * - This one IS a form: the contract carries the full lifecycle (list,
 *   create, read, replace, delete, ping).
 * - PING IS THE PROMOTED AFFORDANCE on every row: it is the one real
 *   signal the API offers about an endpoint, and the ping result renders
 *   verbatim.
 * - THE DELIVERY-HISTORY OMISSION LIVES HERE, on the screen where the need
 *   surfaces – not only in the simulator. The copy names the next step.
 * - SECRETS: the authenticationMethod secret fields are write-only on the
 *   contract; the platform never returns a stored secret, so the form
 *   never displays one. Secret inputs mask on blur, and editing a webhook
 *   means re-entering the credential (a PUT replaces the whole method).
 * - The status enum has a single member; the form renders it as a disabled
 *   single-value field that says so, never a select pretending at choice.
 * - Delete is confirm-and-explain: the confirmation names the consequence.
 * - `WebhookDeliveryLog` is a SIMULATION surface: it renders the sandbox
 *   event runtime's simulated deliveries, third-person, and belongs inside
 *   simulator chrome – never presented as an API-served history.
 */

// ─── User-facing copy ────────────────────────────────────────────────────────

export const WEBHOOKS_COPY = {
  emptyHeadline: "No webhooks registered",
  emptyBody:
    "Register an endpoint below and the platform delivers account, transfer and payout events to it.",
  ping: "Ping",
  edit: "Edit",
  remove: "Delete",
  deliveryOmission:
    "Delivery history isn't available from the API in this release. Use Ping to verify the endpoint now.",
  deleteExplain: (url: string) =>
    `Deleting this webhook stops all event deliveries to ${url}. Registrations are not recoverable - to resume deliveries you would register the endpoint again.`,
  deleteConfirm: "Delete webhook",
  deleteCancel: "Keep it",
  statusSingleMember: "The API defines a single status value in this release.",
  secretHelper:
    "Stored secrets are never returned by the API. Saving replaces the whole authentication method, so enter the credential again.",
  urlHelper: "Must be an https:// URL the platform can reach.",
  logBadge: "Simulated deliveries – recorded by the sandbox event runtime, not an API operation",
  logEmpty: "No simulated deliveries yet. Drive an event and it lands here.",
  logLine: (eventType: string) => `The platform delivers ${eventType}`,
} as const;

// ─── The table, with Ping promoted ───────────────────────────────────────────

export interface WebhooksTableProps {
  webhooks: Webhook[];
  loading?: boolean;
  /** `resultPresent === false` on the list read. */
  loadFailed?: boolean;
  onRetry?: () => void;
  /** Fires the ping op; the resolved envelope renders verbatim. */
  onPing: (webhookId: string) => Promise<{ success?: boolean }>;
  onEdit?: (webhook: Webhook) => void;
  /** Resolves once the delete op completes. */
  onDelete: (webhookId: string) => Promise<void>;
  style?: CSSProperties;
  className?: string;
}

type PingState =
  | { kind: "result"; success: boolean | undefined }
  | { kind: "error"; message: string };

export function WebhooksTable({
  webhooks,
  loading,
  loadFailed,
  onRetry,
  onPing,
  onEdit,
  onDelete,
  style,
  className,
}: WebhooksTableProps): ReactElement {
  const [pings, setPings] = useState<Record<string, PingState>>({});
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const ping = async (id: string) => {
    try {
      const envelope = await onPing(id);
      setPings((p) => ({ ...p, [id]: { kind: "result", success: envelope.success } }));
    } catch (error) {
      setPings((p) => ({
        ...p,
        [id]: { kind: "error", message: error instanceof Error ? error.message : String(error) },
      }));
    }
  };

  const actionButton: CSSProperties = {
    border: "var(--border-w-hairline) solid var(--border-strong)",
    borderRadius: "var(--radius-control)",
    background: "var(--surface-raised)",
    color: "var(--text-primary)",
    fontSize: "var(--font-size-micro)",
    padding: "var(--space-3xs) var(--space-sm)",
    cursor: "pointer",
  };

  const columns: DataTableColumn<Webhook>[] = [
    {
      key: "name",
      header: "Name",
      cell: (w) => <RowText primary={w.name ?? undefined} />,
    },
    {
      key: "url",
      header: "Endpoint",
      cell: (w) => (
        <span
          style={{
            fontFamily: "monospace",
            fontSize: "var(--font-size-label)",
            display: "inline-block",
            maxWidth: 260,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            verticalAlign: "bottom",
          }}
          title={w.url}
        >
          {w.url}
        </span>
      ),
    },
    {
      key: "auth",
      header: "Authentication",
      cell: (w) =>
        w.authenticationMethod?.type === "BasicAuthenticationMethod" ? "Basic" : "API key",
    },
    {
      key: "status",
      header: "Status",
      // Single-member-aware, like the form: the row's own value renders
      // (humanised for the one member the contract defines today), and an
      // unrecognised future member renders verbatim rather than being
      // silently relabelled Active.
      cell: (w) =>
        w.status === "ACTIVE" ? (
          <StatusPill label="Active" intent="positive" glyph="✓" />
        ) : (
          <StatusPill label={w.status ?? "—"} intent="neutral" />
        ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      cell: (w) => {
        const id = w.id ?? "";
        const pingState = pings[id];
        return (
          <span
            onClick={(e) => e.stopPropagation()}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "var(--space-xs)",
              flexWrap: "wrap",
              justifyContent: "flex-end",
            }}
          >
            {pingState && (
              <span
                role="status"
                style={{
                  fontSize: "var(--font-size-micro)",
                  fontFamily: "monospace",
                  color:
                    pingState.kind === "error"
                      ? "var(--state-danger-fg)"
                      : "var(--state-success-fg)",
                }}
              >
                {pingState.kind === "error"
                  ? `✕ ${pingState.message}`
                  : `✓ success: ${String(pingState.success)}`}
              </span>
            )}
            {/* Ping first and filled: the promoted, real-signal affordance. */}
            <button
              type="button"
              onClick={() => void ping(id)}
              style={{
                ...actionButton,
                background: "var(--accent)",
                color: "var(--accent-fg)",
                fontWeight: 600,
              }}
            >
              {WEBHOOKS_COPY.ping}
            </button>
            {onEdit && (
              <button type="button" onClick={() => onEdit(w)} style={actionButton}>
                {WEBHOOKS_COPY.edit}
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setDeleteError(null);
                setConfirmingDelete(id);
              }}
              style={{ ...actionButton, color: "var(--state-danger-fg)" }}
            >
              {WEBHOOKS_COPY.remove}
            </button>
          </span>
        );
      },
    },
  ];

  if (loading) {
    return <TableSkeleton columns={columns} label="Loading webhooks" style={style} />;
  }
  if (loadFailed) {
    return <ListLoadError what="your webhooks" onRetry={onRetry} />;
  }

  const confirming = webhooks.find((w) => w.id === confirmingDelete);

  return (
    <div className={className} style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)", ...style }}>
      <div style={{ overflowX: "auto" }}>
        <DataTable
          columns={columns}
          rows={webhooks}
          rowKey={(w) => w.id ?? w.url ?? ""}
          emptyMessage={WEBHOOKS_COPY.emptyHeadline}
          style={{ minWidth: 640 }}
        />
      </div>
      {confirming && (
        <div
          role="alertdialog"
          aria-label={WEBHOOKS_COPY.deleteConfirm}
          style={{
            border: "var(--border-w-hairline) solid var(--border-strong)",
            borderRadius: "var(--radius-card)",
            background: "var(--surface-raised)",
            padding: "var(--space-md)",
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-sm)",
          }}
        >
          <p style={{ margin: 0, fontSize: "var(--font-size-body)" }}>
            {WEBHOOKS_COPY.deleteExplain(confirming.url ?? "")}
          </p>
          {deleteError && (
            <p role="alert" style={{ margin: 0, fontSize: "var(--font-size-micro)", color: "var(--state-danger-fg)" }}>
              ✕ {deleteError}
            </p>
          )}
          <div style={{ display: "flex", gap: "var(--space-sm)" }}>
            <button
              type="button"
              onClick={() => {
                void onDelete(confirming.id ?? "")
                  .then(() => setConfirmingDelete(null))
                  .catch((error: unknown) =>
                    setDeleteError(error instanceof Error ? error.message : String(error)),
                  );
              }}
              style={{
                ...actionButton,
                background: "var(--state-danger-bg)",
                color: "var(--state-danger-fg)",
                fontWeight: 600,
              }}
            >
              {WEBHOOKS_COPY.deleteConfirm}
            </button>
            <button type="button" onClick={() => setConfirmingDelete(null)} style={actionButton}>
              {WEBHOOKS_COPY.deleteCancel}
            </button>
          </div>
        </div>
      )}
      {/* The honesty card lives where the need surfaces, with the next step. */}
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
        {WEBHOOKS_COPY.deliveryOmission}
      </p>
    </div>
  );
}

// ─── The form (create + replace) ─────────────────────────────────────────────

export interface WebhookFormProps {
  /** Editing an existing registration: url/name prefill; secrets never do. */
  initial?: Webhook;
  onSubmit: (body: CreateWebhookRequest) => Promise<unknown>;
  onCancel?: () => void;
  submitLabel?: string;
  style?: CSSProperties;
}

type AuthChoice = "apiKey" | "basic";

/** Text input that shows while typing and masks once focus leaves. */
function SecretInput({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (next: string) => void;
}): ReactElement {
  const [masked, setMasked] = useState(true);
  return (
    <input
      id={id}
      type={masked ? "password" : "text"}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onFocus={() => setMasked(false)}
      onBlur={() => setMasked(true)}
      autoComplete="off"
      style={fieldInput}
    />
  );
}

const fieldLabel: CSSProperties = {
  fontSize: "var(--font-size-label)",
  fontWeight: 500,
  color: "var(--text-primary)",
};

const fieldHelper: CSSProperties = {
  margin: 0,
  fontSize: "var(--font-size-micro)",
  color: "var(--text-secondary)",
};

const fieldInput: CSSProperties = {
  boxSizing: "border-box",
  width: "100%",
  maxWidth: 320,
  minWidth: 0,
  padding: "var(--space-xs) var(--space-sm)",
  fontSize: "var(--font-size-body)",
  fontFamily: "var(--font-family)",
  color: "var(--text-primary)",
  background: "var(--surface-raised)",
  border: "var(--border-w-hairline) solid var(--border-strong)",
  borderRadius: "var(--radius-control)",
};

export function WebhookForm({
  initial,
  onSubmit,
  onCancel,
  submitLabel = initial ? "Save changes" : "Register webhook",
  style,
}: WebhookFormProps): ReactElement {
  const [url, setUrl] = useState(initial?.url ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  const [auth, setAuth] = useState<AuthChoice>(
    initial?.authenticationMethod?.type === "BasicAuthenticationMethod" ? "basic" : "apiKey",
  );
  const [headerName, setHeaderName] = useState(
    initial?.authenticationMethod?.type === "ApiKeyAuthenticationMethod"
      ? (initial.authenticationMethod.headerName ?? "")
      : "",
  );
  const [apiKey, setApiKey] = useState("");
  const [username, setUsername] = useState(
    initial?.authenticationMethod?.type === "BasicAuthenticationMethod"
      ? (initial.authenticationMethod.username ?? "")
      : "",
  );
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    setError(null);
    if (!/^https:\/\/.+/.test(url)) {
      setError(WEBHOOKS_COPY.urlHelper);
      return;
    }
    const authenticationMethod =
      auth === "apiKey"
        ? ({ type: "ApiKeyAuthenticationMethod", headerName, apiKey } as const)
        : ({ type: "BasicAuthenticationMethod", username, password } as const);
    if (auth === "apiKey" && (!headerName || !apiKey)) {
      setError("API-key authentication needs a header name and a key.");
      return;
    }
    if (auth === "basic" && (!username || !password)) {
      setError("Basic authentication needs a username and a password.");
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit({ url, name: name || undefined, authenticationMethod });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  const segment = (choice: AuthChoice, label: string): ReactElement => (
    <button
      key={choice}
      type="button"
      aria-pressed={auth === choice}
      onClick={() => setAuth(choice)}
      style={{
        border: "var(--border-w-hairline) solid var(--border-strong)",
        borderRadius: "var(--radius-control)",
        padding: "var(--space-2xs) var(--space-md)",
        fontSize: "var(--font-size-label)",
        fontWeight: auth === choice ? 600 : 400,
        background: auth === choice ? "var(--selected-tint)" : "var(--surface-raised)",
        color: "var(--text-primary)",
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-md)",
        fontFamily: "var(--font-family)",
        maxWidth: 360,
        ...style,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2xs)" }}>
        <label htmlFor="vf-webhook-url" style={fieldLabel}>
          Endpoint URL
        </label>
        <p style={fieldHelper}>{WEBHOOKS_COPY.urlHelper}</p>
        <input
          id="vf-webhook-url"
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          style={fieldInput}
        />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2xs)" }}>
        <label htmlFor="vf-webhook-name" style={fieldLabel}>
          Name
        </label>
        <input
          id="vf-webhook-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={fieldInput}
        />
      </div>

      {/* Single-member enum: a disabled single value that says so. */}
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2xs)" }}>
        <label htmlFor="vf-webhook-status" style={fieldLabel}>
          Status
        </label>
        <input id="vf-webhook-status" type="text" value="ACTIVE" disabled style={{ ...fieldInput, color: "var(--text-tertiary)" }} />
        <p style={fieldHelper}>{WEBHOOKS_COPY.statusSingleMember}</p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2xs)" }}>
        <span style={fieldLabel}>Authentication</span>
        <p style={fieldHelper}>{WEBHOOKS_COPY.secretHelper}</p>
        <div style={{ display: "flex", gap: "var(--space-xs)" }}>
          {segment("apiKey", "API key")}
          {segment("basic", "Basic auth")}
        </div>
      </div>

      {auth === "apiKey" ? (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2xs)" }}>
            <label htmlFor="vf-webhook-header" style={fieldLabel}>
              Header name
            </label>
            <input
              id="vf-webhook-header"
              type="text"
              value={headerName}
              onChange={(e) => setHeaderName(e.target.value)}
              style={fieldInput}
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2xs)" }}>
            <label htmlFor="vf-webhook-key" style={fieldLabel}>
              API key
            </label>
            <SecretInput id="vf-webhook-key" value={apiKey} onChange={setApiKey} />
          </div>
        </>
      ) : (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2xs)" }}>
            <label htmlFor="vf-webhook-user" style={fieldLabel}>
              Username
            </label>
            <input
              id="vf-webhook-user"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              style={fieldInput}
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2xs)" }}>
            <label htmlFor="vf-webhook-pass" style={fieldLabel}>
              Password
            </label>
            <SecretInput id="vf-webhook-pass" value={password} onChange={setPassword} />
          </div>
        </>
      )}

      {error && (
        <p role="alert" style={{ margin: 0, fontSize: "var(--font-size-micro)", color: "var(--state-danger-fg)" }}>
          ✕ {error}
        </p>
      )}

      <div style={{ display: "flex", gap: "var(--space-sm)" }}>
        <button
          type="submit"
          disabled={submitting}
          style={{
            border: "none",
            borderRadius: "var(--radius-control)",
            background: "var(--accent)",
            color: "var(--accent-fg)",
            fontSize: "var(--font-size-label)",
            fontWeight: 600,
            padding: "var(--space-xs) var(--space-lg)",
            cursor: submitting ? "wait" : "pointer",
          }}
        >
          {submitLabel}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            style={{
              border: "var(--border-w-hairline) solid var(--border-strong)",
              borderRadius: "var(--radius-control)",
              background: "var(--surface-raised)",
              color: "var(--text-primary)",
              fontSize: "var(--font-size-label)",
              padding: "var(--space-xs) var(--space-lg)",
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

// ─── The simulated delivery log (simulator register only) ────────────────────

export interface WebhookDeliveryLogProps {
  /** `simulations.webhookDeliveries.list(webhookId?)`, newest first. */
  deliveries: MockWebhookDelivery[];
  style?: CSSProperties;
}

/**
 * Renders ONLY inside simulator chrome. Third-person copy: these are
 * events the platform delivers, not actions anyone here took.
 */
export function WebhookDeliveryLog({ deliveries, style }: WebhookDeliveryLogProps): ReactElement {
  return (
    <section
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-sm)",
        fontFamily: "var(--font-family)",
        ...style,
      }}
    >
      <p
        style={{
          margin: 0,
          fontSize: "var(--font-size-micro)",
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          fontWeight: 600,
          color: "var(--text-secondary)",
        }}
      >
        {WEBHOOKS_COPY.logBadge}
      </p>
      {deliveries.length === 0 ? (
        <p style={{ margin: 0, fontSize: "var(--font-size-label)", color: "var(--text-secondary)" }}>
          {WEBHOOKS_COPY.logEmpty}
        </p>
      ) : (
        <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: "var(--space-2xs)" }}>
          {deliveries.map((d, index) => (
            <li
              key={`${d.webhookId}-${d.at}-${index}`}
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: "var(--space-md)",
                fontSize: "var(--font-size-label)",
                borderBottom: "var(--border-w-hairline) solid var(--border-hairline)",
                paddingBottom: "var(--space-2xs)",
                flexWrap: "wrap",
              }}
            >
              <span>
                {WEBHOOKS_COPY.logLine(d.eventType)}{" "}
                <span style={{ color: "var(--state-success-fg)" }}>✓ {d.status}</span>
              </span>
              <span style={{ color: "var(--text-secondary)", fontVariantNumeric: "tabular-nums" }}>
                {formatStamp(d.at)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
