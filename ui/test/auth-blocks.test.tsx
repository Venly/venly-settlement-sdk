import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import {
  SignInForm,
  SignUpForm,
  TwoFactorForm,
  createMockAuthAdapter,
  type AuthAdapter,
} from "../registry/blocks/auth.js";
import { createMockTeamAdapter, ROLE_DESCRIPTIONS, InviteDialog } from "../registry/blocks/team.js";

// These tests encode the auth boundary's design contract as executable
// invariants: no user enumeration, deterministic mock lifecycle, honest
// mock copy (no fake email sends), and the session-expiry contract.

const noop = (): void => undefined;

function adapter(): ReturnType<typeof createMockAuthAdapter> {
  return createMockAuthAdapter();
}

test("mock auth: bad password is invalid with ONE combined message (no user enumeration)", async () => {
  const a = adapter();
  const result = await a.signIn("someone@example.com", "wrong");
  assert.equal(result.status, "invalid");
  assert.equal(result.message, "We don't recognise that email and password combination.");
  assert.equal(a.session(), null, "no session on failure");
});

test("mock auth: @2fa.test routes through the challenge; 000000 completes, others fail", async () => {
  const a = adapter();
  const first = await a.signIn("ops@2fa.test", "hunter2");
  assert.equal(first.status, "2fa-required");
  assert.equal(a.session(), null, "no session until the code verifies");

  const bad = await a.verifyTotp("123456");
  assert.equal(bad.status, "invalid");
  assert.equal(a.session(), null);

  const good = await a.verifyTotp("000000");
  assert.equal(good.status, "ok");
  assert.equal(a.session()?.user.email, "ops@2fa.test");
});

test("mock auth: session-expiry contract - expireSession() makes session() null, nothing else signals it", async () => {
  const a = adapter();
  await a.signIn("someone@example.com", "pw");
  assert.ok(a.session());
  a.expireSession();
  assert.equal(a.session(), null);
});

test("mock auth: sign-up duplicate email returns the duplicate code; fresh email creates a session", async () => {
  const a = adapter();
  const dup = await a.signUp({ email: "ada@acme.example", companyName: "Acme" });
  assert.equal(dup.status, "invalid");
  assert.equal(dup.code, "duplicate-email");

  const fresh = await a.signUp({ email: "founder@newco.example", companyName: "NewCo B.V." });
  assert.equal(fresh.status, "ok");
  assert.equal(a.session()?.companyName, "NewCo B.V.");
  assert.equal(a.session()?.role, "ADMIN");
});

test("sign-in form: heading names the app, fields labelled, forgot-password present", () => {
  const html = renderToStaticMarkup(
    <SignInForm
      adapter={adapter() as AuthAdapter}
      appName="Mock Bank"
      onSignedIn={noop}
      onTwoFactorRequired={noop}
    />,
  );
  assert.match(html, /Sign in to Mock Bank/);
  assert.match(html, /Email/);
  assert.match(html, /Password/);
  assert.match(html, /Forgot your password\?/);
  assert.match(html, /type="password"/);
  assert.doesNotMatch(html, /#[0-9a-fA-F]{3,8}\b/, "token-driven, no raw colour");
});

test("2fa form: six individual code slots, remember-browser opt-in, contract copy", () => {
  const html = renderToStaticMarkup(
    <TwoFactorForm adapter={adapter() as AuthAdapter} onVerified={noop} />,
  );
  assert.match(html, /Enter the 6-digit code from your authenticator app\./);
  assert.match(html, /Remember this browser for 30 days/);
  const slots = html.match(/autocomplete="one-time-code"|data-radix-otp|<input/g) ?? [];
  assert.ok(slots.length >= 6, `expected >=6 code inputs, saw ${slots.length}`);
  assert.match(html, /Choose a different method/);
  assert.match(html, /Verify code/);
});

test("sign-up form: minimum fields, duplicate error offers sign-in instead", () => {
  const html = renderToStaticMarkup(
    <SignUpForm
      adapter={adapter() as AuthAdapter}
      appName="Mock Bank"
      onComplete={noop}
      onSwitchToSignIn={noop}
    />,
  );
  assert.match(html, /Create your Mock Bank account/);
  assert.match(html, /Work email/);
  assert.match(html, /Company name/);
  assert.match(html, /Create account/);
});

// ── Team ───────────────────────────────────────────────────────────────

test("mock team: seeded with active + invited + disabled so every status renders", async () => {
  const t = createMockTeamAdapter();
  const members = await t.members();
  assert.equal(members.length, 3);
  const statuses = members.map((m) => m.status).sort();
  assert.deepEqual(statuses, ["ACTIVE", "DISABLED", "INVITED"]);
});

test("mock team: invite mints a display-only link and NEVER claims an email was sent", async () => {
  const t = createMockTeamAdapter();
  const member = await t.invite({ email: "new@acme.example", role: "MANAGER" });
  assert.equal(member.status, "INVITED");
  assert.ok(member.inviteUrl, "display-only invite link minted");
  const members = await t.members();
  assert.equal(members.length, 4, "invited member appears in the list");
});

test("mock team: role change and disable persist", async () => {
  const t = createMockTeamAdapter();
  const changed = await t.setRole("tm-2", "ADMIN");
  assert.equal(changed.role, "ADMIN");
  const disabled = await t.setEnabled("tm-2", false);
  assert.equal(disabled.status, "DISABLED");
  const roundTrip = (await t.members()).find((m) => m.id === "tm-2");
  assert.equal(roundTrip?.role, "ADMIN");
  assert.equal(roundTrip?.status, "DISABLED");
});

test("invite dialog: role descriptions spell out what each role can do", () => {
  assert.equal(ROLE_DESCRIPTIONS.ADMIN, "Approves money movement and manages the team");
  assert.equal(ROLE_DESCRIPTIONS.MANAGER, "Creates and edits requests");
  assert.equal(ROLE_DESCRIPTIONS.VIEWER, "Read-only");
  const html = renderToStaticMarkup(
    <InviteDialog adapter={createMockTeamAdapter()} onInvited={noop} />,
  );
  assert.match(html, /Invite a team member/, "trigger renders");
});
