import { useState, type CSSProperties, type ReactElement } from "react";
import * as OneTimePasswordField from "@radix-ui/react-one-time-password-field";

/**
 * Auth block – sign-in, two-factor challenge and sign-up over a
 * bring-your-own-auth adapter.
 *
 * Why an adapter and not an API call: the Venly APIs authenticate machines
 * (OAuth2 client credentials), not people. There is no end-user login,
 * session, password or MFA endpoint – by design. End-user auth belongs to
 * YOUR identity layer; these forms render the front of whatever you already
 * run. Real `AuthAdapter` implementations wrap OAuth/OIDC, Better Auth,
 * Auth0, Clerk, Keycloak, or your session cookie – see "Bring your own
 * auth" in the package guide. The Venly APIs never see end-user
 * credentials; the sanctioned browser shape is a backend proxy that
 * inherits your app's session.
 *
 * Design contract encoded by this block:
 * - Credential errors never confirm which half was wrong (no user
 *   enumeration): one combined message for unknown email and bad password.
 * - The 2FA challenge is a six-digit code field (individual slots, paste
 *   distributes across them, fully keyboard-operable) with an explicit
 *   "remember this browser" opt-in.
 * - Sign-up asks for the minimum (work email + company name) and hands off
 *   to onboarding; the organisation record is created there, not here.
 * - The mock adapter never fakes an email send and labels every
 *   demo-only affordance as such.
 */

// ── Adapter contract ───────────────────────────────────────────────────

export type Role = "ADMIN" | "MANAGER" | "VIEWER";

export interface Session {
  user: { name: string; email: string };
  companyName: string;
  role: Role;
}

export interface AuthResult {
  status: "ok" | "2fa-required" | "invalid";
  /** Human-readable reason rendered under the form when status is "invalid". */
  message?: string;
  /** Machine-readable reason; "duplicate-email" makes sign-up offer sign-in. */
  code?: "duplicate-email";
}

/**
 * The auth boundary these forms render against. Implement it over your
 * identity provider; `createMockAuthAdapter` ships a zero-credential
 * implementation for demos and tests.
 *
 * Session-expiry contract: `session()` returns `null` once the session has
 * expired for any reason. The shell treats null as signed-out and redirects
 * to sign-in – no other expiry signal exists in this interface.
 */
export interface AuthAdapter {
  signIn(email: string, password: string, rememberDevice?: boolean): Promise<AuthResult>;
  verifyTotp(code: string): Promise<AuthResult>;
  signUp(input: { email: string; companyName: string }): Promise<AuthResult>;
  session(): Session | null;
  signOut(): Promise<void>;
}

// ── Mock adapter ───────────────────────────────────────────────────────

export interface MockAuthAdapter extends AuthAdapter {
  /** Demo driver: drop the current session so the shell's redirect shows. */
  expireSession(): void;
}

const DEFAULT_SEEDED_EMAILS = ["ada@acme.example", "casey@acme.example", "riley@acme.example"];

function nameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? email;
  return local.charAt(0).toUpperCase() + local.slice(1);
}

/**
 * Zero-credential mock: any email/password signs in EXCEPT password
 * "wrong" (invalid credentials path); an email ending in `@2fa.test`
 * triggers the two-factor challenge, where the deterministic code is
 * `000000`. Sign-up with an already-seeded email returns the duplicate
 * error. Nothing here talks to a network.
 */
export function createMockAuthAdapter(options?: {
  seededEmails?: string[];
  companyName?: string;
}): MockAuthAdapter {
  const seeded = options?.seededEmails ?? DEFAULT_SEEDED_EMAILS;
  const companyName = options?.companyName ?? "Acme Corporation B.V.";
  let session: Session | null = null;
  let pending: Session | null = null;

  return {
    async signIn(email, password) {
      if (!email || password === "wrong") {
        return {
          status: "invalid",
          message: "We don't recognise that email and password combination.",
        };
      }
      const next: Session = {
        user: { name: nameFromEmail(email), email },
        companyName,
        role: "ADMIN",
      };
      if (email.toLowerCase().endsWith("@2fa.test")) {
        pending = next;
        return { status: "2fa-required" };
      }
      session = next;
      return { status: "ok" };
    },
    async verifyTotp(code) {
      if (code === "000000" && pending) {
        session = pending;
        pending = null;
        return { status: "ok" };
      }
      return {
        status: "invalid",
        message: "That code doesn't match. Check your authenticator app and try again.",
      };
    },
    async signUp(input) {
      const email = input.email.trim().toLowerCase();
      if (seeded.some((s) => s.toLowerCase() === email)) {
        return {
          status: "invalid",
          code: "duplicate-email",
          message: "That email already has an account.",
        };
      }
      session = {
        user: { name: nameFromEmail(input.email), email: input.email },
        companyName: input.companyName,
        role: "ADMIN",
      };
      return { status: "ok" };
    },
    session() {
      return session;
    },
    async signOut() {
      session = null;
      pending = null;
    },
    expireSession() {
      session = null;
    },
  };
}

// ── Shared form styling (token-driven) ─────────────────────────────────

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

const linkButton: CSSProperties = {
  border: "none",
  background: "transparent",
  padding: 0,
  fontSize: "var(--font-size-label)",
  fontFamily: "var(--font-family)",
  color: "var(--text-secondary)",
  textDecoration: "underline",
  cursor: "pointer",
};

const cardStyle: CSSProperties = {
  maxWidth: "var(--auth-form-max-width)",
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-lg)",
  fontFamily: "var(--font-family)",
};

const headingStyle: CSSProperties = {
  fontSize: "var(--font-size-value)",
  fontWeight: 600,
  color: "var(--text-primary)",
  margin: 0,
};

function ErrorText({ children }: { children: string }): ReactElement {
  return (
    <p
      role="alert"
      style={{
        margin: 0,
        fontSize: "var(--font-size-label)",
        color: "var(--state-danger-fg)",
      }}
    >
      {children}
    </p>
  );
}

function DemoNote({ children }: { children: string }): ReactElement {
  return (
    <p
      style={{
        margin: 0,
        fontSize: "var(--font-size-label)",
        color: "var(--text-secondary)",
      }}
    >
      {children}
    </p>
  );
}

// ── Sign in ────────────────────────────────────────────────────────────

export interface SignInFormProps {
  adapter: AuthAdapter;
  /** Product name in the heading: "Sign in to {appName}". */
  appName: string;
  onSignedIn: () => void;
  onTwoFactorRequired: () => void;
  /** Wire to your provider's reset flow. Absent → an honest demo note. */
  onForgotPassword?: () => void;
  style?: CSSProperties;
  className?: string;
}

export function SignInForm({
  adapter,
  appName,
  onSignedIn,
  onTwoFactorRequired,
  onForgotPassword,
  style,
  className,
}: SignInFormProps): ReactElement {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [resetNote, setResetNote] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  return (
    <form
      className={className}
      style={{ ...cardStyle, ...style }}
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        setSubmitting(true);
        void adapter.signIn(email, password).then((result) => {
          setSubmitting(false);
          if (result.status === "ok") onSignedIn();
          else if (result.status === "2fa-required") onTwoFactorRequired();
          else setError(result.message ?? "We don't recognise that email and password combination.");
        });
      }}
    >
      <h1 style={headingStyle}>Sign in to {appName}</h1>
      <div>
        <label style={labelStyle} htmlFor="vf-auth-email">
          Email
        </label>
        <input
          id="vf-auth-email"
          type="email"
          autoComplete="email"
          required
          style={inputStyle}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <div>
        <label style={labelStyle} htmlFor="vf-auth-password">
          Password
        </label>
        <input
          id="vf-auth-password"
          type="password"
          autoComplete="current-password"
          required
          style={inputStyle}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>
      {error ? <ErrorText>{error}</ErrorText> : null}
      <button type="submit" disabled={submitting} style={primaryButton}>
        Sign in
      </button>
      <button
        type="button"
        style={linkButton}
        onClick={() => (onForgotPassword ? onForgotPassword() : setResetNote(true))}
      >
        Forgot your password?
      </button>
      {resetNote ? (
        <DemoNote>
          Password reset lives with your identity provider – this demo doesn't include one.
        </DemoNote>
      ) : null}
    </form>
  );
}

// ── Two-factor challenge ───────────────────────────────────────────────

export interface TwoFactorFormProps {
  adapter: AuthAdapter;
  onVerified: () => void;
  /** Wire to your provider's method picker. Absent → an honest demo note. */
  onChooseDifferentMethod?: () => void;
  style?: CSSProperties;
  className?: string;
}

const otpSlotStyle: CSSProperties = {
  width: "var(--space-2xl)",
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

export function TwoFactorForm({
  adapter,
  onVerified,
  onChooseDifferentMethod,
  style,
  className,
}: TwoFactorFormProps): ReactElement {
  const [code, setCode] = useState("");
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [methodNote, setMethodNote] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  return (
    <form
      className={className}
      style={{ ...cardStyle, ...style }}
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        setSubmitting(true);
        void adapter.verifyTotp(code).then((result) => {
          setSubmitting(false);
          if (result.status === "ok") onVerified();
          else setError(result.message ?? "That code doesn't match. Check your authenticator app and try again.");
        });
      }}
    >
      <h1 style={headingStyle}>Two-step verification</h1>
      <p style={{ margin: 0, fontSize: "var(--font-size-body)", color: "var(--text-secondary)" }}>
        Enter the 6-digit code from your authenticator app.
      </p>
      <OneTimePasswordField.Root
        value={code}
        onValueChange={setCode}
        validationType="numeric"
        aria-label="6-digit verification code"
        style={{ display: "flex", gap: "var(--space-xs)" }}
      >
        {Array.from({ length: 6 }, (_, i) => (
          <OneTimePasswordField.Input key={i} style={otpSlotStyle} />
        ))}
        <OneTimePasswordField.HiddenInput />
      </OneTimePasswordField.Root>
      <label
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-sm)",
          fontSize: "var(--font-size-label)",
          color: "var(--text-secondary)",
        }}
      >
        <input
          type="checkbox"
          checked={remember}
          onChange={(e) => setRemember(e.target.checked)}
        />
        Remember this browser for 30 days
      </label>
      {error ? <ErrorText>{error}</ErrorText> : null}
      <button type="submit" disabled={submitting || code.length < 6} style={primaryButton}>
        Verify code
      </button>
      <button
        type="button"
        style={linkButton}
        onClick={() => (onChooseDifferentMethod ? onChooseDifferentMethod() : setMethodNote(true))}
      >
        Choose a different method
      </button>
      {methodNote ? (
        <DemoNote>
          An authenticator code is the only method in this demo – real deployments list your
          provider's other methods here.
        </DemoNote>
      ) : null}
    </form>
  );
}

// ── Sign up ────────────────────────────────────────────────────────────

export interface SignUpFormProps {
  adapter: AuthAdapter;
  /** Product name in the heading: "Create your {appName} account". */
  appName: string;
  /** Fires on success; route to onboarding – the organisation is created there. */
  onComplete: () => void;
  /** The "Sign in instead" link on the duplicate-email error. */
  onSwitchToSignIn: () => void;
  style?: CSSProperties;
  className?: string;
}

export function SignUpForm({
  adapter,
  appName,
  onComplete,
  onSwitchToSignIn,
  style,
  className,
}: SignUpFormProps): ReactElement {
  const [email, setEmail] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [error, setError] = useState<AuthResult | null>(null);
  const [submitting, setSubmitting] = useState(false);

  return (
    <form
      className={className}
      style={{ ...cardStyle, ...style }}
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        setSubmitting(true);
        void adapter.signUp({ email, companyName }).then((result) => {
          setSubmitting(false);
          if (result.status === "ok") onComplete();
          else setError(result);
        });
      }}
    >
      <h1 style={headingStyle}>Create your {appName} account</h1>
      <div>
        <label style={labelStyle} htmlFor="vf-auth-signup-email">
          Work email
        </label>
        <input
          id="vf-auth-signup-email"
          type="email"
          autoComplete="email"
          required
          style={inputStyle}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <div>
        <label style={labelStyle} htmlFor="vf-auth-signup-company">
          Company name
        </label>
        <input
          id="vf-auth-signup-company"
          type="text"
          autoComplete="organization"
          required
          style={inputStyle}
          value={companyName}
          onChange={(e) => setCompanyName(e.target.value)}
        />
      </div>
      {error ? (
        error.code === "duplicate-email" ? (
          <p
            role="alert"
            style={{
              margin: 0,
              fontSize: "var(--font-size-label)",
              color: "var(--state-danger-fg)",
            }}
          >
            That email already has an account.{" "}
            <button
              type="button"
              style={{ ...linkButton, color: "var(--state-danger-fg)" }}
              onClick={onSwitchToSignIn}
            >
              Sign in instead.
            </button>
          </p>
        ) : (
          <ErrorText>{error.message ?? "Something went wrong. Try again."}</ErrorText>
        )
      ) : null}
      <button type="submit" disabled={submitting} style={primaryButton}>
        Create account
      </button>
    </form>
  );
}
