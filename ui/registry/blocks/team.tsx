import { useEffect, useState, type CSSProperties, type ReactElement } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { DataTable, RowText, type DataTableColumn } from "../components/data-table.js";
import { StatusPill, type StatusIntent } from "../components/status-pill.js";
import type { Role } from "./auth.js";

/**
 * Team block – member list, invites and role control over a
 * bring-your-own-auth adapter.
 *
 * Like the auth block, this renders YOUR identity layer: the Venly APIs
 * authenticate machines, not people, so team membership lives with your
 * auth provider. Implement `TeamAdapter` over it; the mock ships for
 * demos and tests.
 *
 * Design contract encoded by this block:
 * - Member status is word + glyph (survives greyscale): Invited is a
 *   pending intent, Disabled a neutral one – neither is red.
 * - Role and enablement controls live in the row (the last column is
 *   live controls, not chrome).
 * - You cannot change your own role or disable yourself; the control is
 *   disabled AND explains why, instead of failing on click.
 * - The mock invite never claims an email was sent: it mints a
 *   display-only link and says exactly that.
 */

// ── Adapter contract ───────────────────────────────────────────────────

export type TeamMemberStatus = "ACTIVE" | "INVITED" | "DISABLED";

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: TeamMemberStatus;
  /** Mock-only: a display-only invite link for demo hand-off. */
  inviteUrl?: string;
}

export interface TeamAdapter {
  members(): Promise<TeamMember[]>;
  invite(input: { email: string; role: Role }): Promise<TeamMember>;
  setRole(id: string, role: Role): Promise<TeamMember>;
  setEnabled(id: string, enabled: boolean): Promise<TeamMember>;
}

// ── Mock adapter ───────────────────────────────────────────────────────

/**
 * Seeded with three members – an active admin (treat as the signed-in
 * user), a pending invite, and a disabled viewer – so every status the
 * table renders exists on first paint. Invites mint a display-only URL;
 * no email is sent and the UI never claims one was.
 */
export function createMockTeamAdapter(): TeamAdapter {
  let counter = 0;
  const members: TeamMember[] = [
    {
      id: "tm-1",
      name: "Ada Lovelace",
      email: "ada@acme.example",
      role: "ADMIN",
      status: "ACTIVE",
    },
    {
      id: "tm-2",
      name: "Casey Jones",
      email: "casey@acme.example",
      role: "MANAGER",
      status: "INVITED",
      inviteUrl: "https://invite.example/team/tm-2",
    },
    {
      id: "tm-3",
      name: "Sam Altmann",
      email: "sam@acme.example",
      role: "VIEWER",
      status: "DISABLED",
    },
  ];

  const find = (id: string): TeamMember => {
    const member = members.find((m) => m.id === id);
    if (!member) throw new Error(`No team member with id ${id}.`);
    return member;
  };

  return {
    async members() {
      return members.map((m) => ({ ...m }));
    },
    async invite(input) {
      counter += 1;
      const id = `tm-invite-${counter}`;
      const member: TeamMember = {
        id,
        name: input.email.split("@")[0] ?? input.email,
        email: input.email,
        role: input.role,
        status: "INVITED",
        inviteUrl: `https://invite.example/team/${id}`,
      };
      members.push(member);
      return { ...member };
    },
    async setRole(id, role) {
      const member = find(id);
      member.role = role;
      return { ...member };
    },
    async setEnabled(id, enabled) {
      const member = find(id);
      member.status = enabled ? "ACTIVE" : "DISABLED";
      return { ...member };
    },
  };
}

// ── Role copy (rendered wherever a role is chosen) ─────────────────────

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  ADMIN: "Approves money movement and manages the team",
  MANAGER: "Creates and edits requests",
  VIEWER: "Read-only",
};

const STATUS_PILL: Record<TeamMemberStatus, { label: string; intent: StatusIntent }> = {
  ACTIVE: { label: "Active", intent: "positive" },
  INVITED: { label: "Invited", intent: "pending" },
  DISABLED: { label: "Disabled", intent: "neutral" },
};

// ── Shared styling ─────────────────────────────────────────────────────

const selectStyle: CSSProperties = {
  border: "var(--border-w-hairline) solid var(--border-strong)",
  borderRadius: "var(--radius-control)",
  padding: "var(--space-2xs) var(--space-sm)",
  fontSize: "var(--font-size-label)",
  fontFamily: "var(--font-family)",
  color: "var(--text-primary)",
  background: "var(--surface-raised)",
};

const quietButton: CSSProperties = {
  border: "var(--border-w-hairline) solid var(--border-strong)",
  background: "var(--surface-raised)",
  color: "var(--text-primary)",
  borderRadius: "var(--radius-control)",
  padding: "var(--space-2xs) var(--space-sm)",
  fontSize: "var(--font-size-label)",
  fontFamily: "var(--font-family)",
  cursor: "pointer",
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

// ── Invite dialog ──────────────────────────────────────────────────────

export interface InviteDialogProps {
  adapter: TeamAdapter;
  /** Fires with the created member so the list can refresh/announce. */
  onInvited: (member: TeamMember) => void;
  style?: CSSProperties;
  className?: string;
}

export function InviteDialog({
  adapter,
  onInvited,
  style,
  className,
}: InviteDialogProps): ReactElement {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("VIEWER");
  const [submitting, setSubmitting] = useState(false);

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setEmail("");
          setRole("VIEWER");
        }
      }}
    >
      <Dialog.Trigger asChild>
        <button type="button" className={className} style={{ ...primaryButton, ...style }}>
          Invite a team member
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay
          style={{
            position: "fixed",
            inset: 0,
            background: "var(--selected-tint)",
          }}
        />
        <Dialog.Content
          aria-describedby={undefined}
          style={{
            position: "fixed",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            width: "var(--form-max-width)",
            maxWidth: "90vw",
            boxSizing: "border-box",
            background: "var(--surface-raised)",
            border: "var(--border-w-hairline) solid var(--border-hairline)",
            borderRadius: "var(--radius-modal)",
            boxShadow: "var(--shadow-overlay)",
            padding: "var(--card-pad)",
            fontFamily: "var(--font-family)",
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-lg)",
          }}
        >
          <Dialog.Title
            style={{
              margin: 0,
              fontSize: "var(--font-size-value)",
              fontWeight: 600,
              color: "var(--text-primary)",
            }}
          >
            Invite a team member
          </Dialog.Title>
          <form
            style={{ display: "flex", flexDirection: "column", gap: "var(--space-lg)" }}
            onSubmit={(e) => {
              e.preventDefault();
              setSubmitting(true);
              void adapter.invite({ email, role }).then((member) => {
                setSubmitting(false);
                setOpen(false);
                onInvited(member);
              });
            }}
          >
            <div>
              <label
                htmlFor="vf-team-invite-email"
                style={{
                  display: "block",
                  fontSize: "var(--font-size-label)",
                  color: "var(--text-secondary)",
                  marginBottom: "var(--space-2xs)",
                }}
              >
                Email
              </label>
              <input
                id="vf-team-invite-email"
                type="email"
                required
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  border: "var(--border-w-hairline) solid var(--border-strong)",
                  borderRadius: "var(--radius-control)",
                  padding: "var(--space-sm) var(--space-md)",
                  fontSize: "var(--font-size-body)",
                  fontFamily: "var(--font-family)",
                  color: "var(--text-primary)",
                  background: "var(--surface-raised)",
                }}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <fieldset
              style={{
                border: "none",
                margin: 0,
                padding: 0,
                display: "flex",
                flexDirection: "column",
                gap: "var(--space-sm)",
              }}
            >
              <legend
                style={{
                  padding: 0,
                  fontSize: "var(--font-size-label)",
                  color: "var(--text-secondary)",
                  marginBottom: "var(--space-2xs)",
                }}
              >
                Role at invite time
              </legend>
              {(Object.keys(ROLE_DESCRIPTIONS) as Role[]).map((r) => (
                <label
                  key={r}
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    gap: "var(--space-sm)",
                    fontSize: "var(--font-size-body)",
                    color: "var(--text-primary)",
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="radio"
                    name="vf-team-invite-role"
                    checked={role === r}
                    onChange={() => setRole(r)}
                  />
                  <span>
                    <span style={{ fontWeight: 500 }}>{roleLabel(r)}</span>{" "}
                    <span style={{ color: "var(--text-secondary)", fontSize: "var(--font-size-label)" }}>
                      – {ROLE_DESCRIPTIONS[r]}
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>
            <div style={{ display: "flex", gap: "var(--space-sm)" }}>
              <button type="submit" disabled={submitting} style={primaryButton}>
                Send invite
              </button>
              <Dialog.Close asChild>
                <button type="button" style={{ ...quietButton, padding: "var(--space-sm) var(--space-lg)", fontSize: "var(--font-size-body)" }}>
                  Cancel
                </button>
              </Dialog.Close>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function roleLabel(role: Role): string {
  return role.charAt(0) + role.slice(1).toLowerCase();
}

// ── Team table ─────────────────────────────────────────────────────────

export interface TeamTableViewProps {
  members: TeamMember[] | null;
  /** The signed-in user's email; their own row's controls lock. */
  currentUserEmail: string;
  adapter: TeamAdapter;
  /** Called after any adapter mutation so the owner can refetch. */
  onChanged: () => void;
  style?: CSSProperties;
  className?: string;
}

/** Presentational half: the table over already-loaded members. */
export function TeamTableView({
  members,
  currentUserEmail,
  adapter,
  onChanged,
  style,
  className,
}: TeamTableViewProps): ReactElement {
  const [selfNote, setSelfNote] = useState(false);
  const [announce, setAnnounce] = useState<string | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);

  const refresh = onChanged;

  const isSelf = (m: TeamMember): boolean =>
    m.email.toLowerCase() === currentUserEmail.toLowerCase();

  const columns: DataTableColumn<TeamMember>[] = [
    {
      key: "member",
      header: "Member",
      cell: (m) => <RowText primary={m.name} secondary={m.email} />,
    },
    {
      key: "status",
      header: "Status",
      cell: (m) => <StatusPill {...STATUS_PILL[m.status]} />,
    },
    {
      key: "role",
      header: "Role",
      cell: (m) =>
        isSelf(m) ? (
          <span style={{ fontSize: "var(--font-size-label)", color: "var(--text-secondary)" }}>
            {roleLabel(m.role)} (you)
          </span>
        ) : (
          <select
            aria-label={`Role for ${m.name}`}
            style={selectStyle}
            value={m.role}
            onChange={(e) => {
              void adapter.setRole(m.id, e.target.value as Role).then((updated) => {
                setAnnounce(`${updated.name} is now ${roleLabel(updated.role)}.`);
                refresh();
              });
            }}
          >
            {(Object.keys(ROLE_DESCRIPTIONS) as Role[]).map((r) => (
              <option key={r} value={r}>
                {roleLabel(r)}
              </option>
            ))}
          </select>
        ),
    },
    {
      key: "controls",
      header: "",
      cell: (m) =>
        isSelf(m) ? (
          <button
            type="button"
            aria-disabled="true"
            style={{ ...quietButton, color: "var(--text-tertiary)", cursor: "not-allowed" }}
            onClick={() => setSelfNote(true)}
          >
            Disable
          </button>
        ) : (
          <button
            type="button"
            style={quietButton}
            onClick={() => {
              const enable = m.status === "DISABLED";
              void adapter.setEnabled(m.id, enable).then((updated) => {
                setAnnounce(`${updated.name} is now ${STATUS_PILL[updated.status].label.toLowerCase()}.`);
                refresh();
              });
            }}
          >
            {m.status === "DISABLED" ? "Enable" : "Disable"}
          </button>
        ),
    },
  ];

  return (
    <section className={className} style={{ fontFamily: "var(--font-family)", ...style }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "var(--space-lg)",
          gap: "var(--space-lg)",
        }}
      >
        <h2
          style={{
            margin: 0,
            fontSize: "var(--font-size-value)",
            fontWeight: 600,
            color: "var(--text-primary)",
          }}
        >
          Team
        </h2>
        <InviteDialog
          adapter={adapter}
          onInvited={(member) => {
            setAnnounce(`Invite created for ${member.email}.`);
            setInviteUrl(member.inviteUrl ?? null);
            refresh();
          }}
        />
      </div>
      {selfNote ? (
        <p
          role="status"
          style={{
            margin: "0 0 var(--space-md)",
            fontSize: "var(--font-size-label)",
            color: "var(--text-secondary)",
          }}
        >
          You can't change your own role. Ask another admin.
        </p>
      ) : null}
      {announce ? (
        <p
          role="status"
          style={{
            margin: "0 0 var(--space-md)",
            fontSize: "var(--font-size-label)",
            color: "var(--text-primary)",
          }}
        >
          {announce}
          {inviteUrl ? (
            <span style={{ color: "var(--text-secondary)" }}>
              {" "}
              Invite link created – in this demo, share it directly:{" "}
              <span style={{ fontVariantNumeric: "tabular-nums" }}>{inviteUrl}</span>
            </span>
          ) : null}
        </p>
      ) : null}
      {members === null ? (
        <p style={{ color: "var(--text-tertiary)", fontSize: "var(--font-size-body)" }}>
          Loading team…
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
          <DataTable columns={columns} rows={members} rowKey={(m) => m.id} />
        </div>
      )}
    </section>
  );
}

export interface TeamTableProps {
  adapter: TeamAdapter;
  /** The signed-in user's email; their own row's controls lock. */
  currentUserEmail: string;
  style?: CSSProperties;
  className?: string;
}

/** Connected block: loads members from the adapter and keeps them fresh. */
export function TeamTable({ adapter, currentUserEmail, style, className }: TeamTableProps): ReactElement {
  const [members, setMembers] = useState<TeamMember[] | null>(null);
  const refresh = (): void => {
    void adapter.members().then(setMembers);
  };
  useEffect(refresh, [adapter]);
  return (
    <TeamTableView
      members={members}
      currentUserEmail={currentUserEmail}
      adapter={adapter}
      onChanged={refresh}
      style={style}
      className={className}
    />
  );
}
