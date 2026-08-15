import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import type { Party, Account } from "@venlyfinance/sdk";
import {
  RestrictedBanner,
  VerificationStatusView,
  verificationOutcome,
} from "../registry/blocks/onboarding.js";
import { BalancesView, arithmeticMismatches, type AssetBalanceRow } from "../registry/blocks/balances.js";

// The onboarding surface's one law: the status on screen is the API's
// status, mapped once, never invented. These tests pin that plus the
// waiting state's four answers and the humane decline.

const orgPending = {
  id: "p-1",
  partyType: "ORGANISATION",
  status: "ACTIVE",
  name: "NewCo B.V.",
  kybStatus: "PENDING",
} as Party;

const acctPending = { id: "a-1", kycStatus: "VERIFICATION_PENDING", status: "ACTIVE" } as Account;

test("outcome gate: verified requires BOTH records; a decline on either wins", () => {
  assert.equal(verificationOutcome(orgPending, acctPending), "in-review");
  assert.equal(
    verificationOutcome({ ...orgPending, kybStatus: "VERIFIED" } as Party, acctPending),
    "in-review",
  );
  assert.equal(
    verificationOutcome(
      { ...orgPending, kybStatus: "VERIFIED" } as Party,
      { ...acctPending, kycStatus: "VERIFIED" } as Account,
    ),
    "verified",
  );
  assert.equal(
    verificationOutcome({ ...orgPending, kybStatus: "DENIED" } as Party, acctPending),
    "declined",
  );
  assert.equal(
    verificationOutcome(orgPending, { ...acctPending, kycStatus: "REJECTED" } as Account),
    "declined",
  );
});

test("waiting state: answers the four questions without inventing an SLA", () => {
  const html = renderToStaticMarkup(
    <VerificationStatusView party={orgPending} account={acctPending} email="ops@newco.example" />,
  );
  assert.match(html, /Your application is in review\./);
  assert.match(html, /Nothing is needed from you right now\./, "must-I-act answered");
  assert.match(
    html,
    /We don(?:'|&#x27;)t have a fixed review window to share yet – we(?:'|&#x27;)ll email ops@newco\.example the moment your status changes\./,
    "how-long is an honest unknown + channel named",
  );
  assert.match(html, /While you wait: explore the app/, "what-still-works listed");
  assert.doesNotMatch(html, /business days|within \d+/i, "no invented review window");
  assert.match(html, /In review/, "literal PENDING maps to the label, once");
  assert.doesNotMatch(html, /Verified ✓?<\//, "no false verified badge while pending");
});

test("statuses render from the API fields verbatim - a VERIFIED pair unlocks, and only then", () => {
  const html = renderToStaticMarkup(
    <VerificationStatusView
      party={{ ...orgPending, kybStatus: "VERIFIED" } as Party}
      account={{ ...acctPending, kycStatus: "VERIFIED" } as Account}
      email="ops@newco.example"
      onContinue={() => undefined}
    />,
  );
  assert.match(html, /NewCo B\.V\. is verified\./);
  assert.match(html, /Go to your account/);
});

test("decline is humane: names the company, appeal is the primary, no invented reasons", () => {
  const html = renderToStaticMarkup(
    <VerificationStatusView
      party={{ ...orgPending, kybStatus: "DENIED" } as Party}
      account={acctPending}
      email="ops@newco.example"
      onAskForReview={() => undefined}
    />,
  );
  assert.match(html, /We couldn(?:'|&#x27;)t verify NewCo B\.V\. based on the information provided\./);
  assert.match(html, /Ask for a review/);
  assert.match(html, /Declined/);
  assert.doesNotMatch(html, /fraud|suspicious|risk/i, "no invented decline reasons");
  const failedNode = html.slice(html.indexOf('data-state="failed"'));
  assert.ok(failedNode.length > 1, "timeline ends in a failed node");
  assert.doesNotMatch(failedNode.slice(0, 200), /state-success/, "terminal failure is never green");
});

test("restricted banner: re-verification names the consequence and what keeps working", () => {
  const html = renderToStaticMarkup(
    <RestrictedBanner companyName="NewCo B.V." variant="reverification" onViewStatus={() => undefined} />,
  );
  assert.match(
    html,
    /We need updated details for NewCo B\.V\.\. Money movement pauses until this is done – everything else keeps working\./,
  );
  assert.match(html, /View status/);
});

test("restricted banner: unverified variant states the gates, not a lockout", () => {
  const html = renderToStaticMarkup(<RestrictedBanner companyName="NewCo B.V." variant="unverified" />);
  assert.match(html, /Money movement and your account details for receiving unlock once you(?:'|&#x27;)re verified/);
  assert.match(html, /everything else keeps working/);
});

// ── Balances retro fixes ───────────────────────────────────────────────

const rows: AssetBalanceRow[] = [
  { asset: "USDC", chains: ["BASE"], total: 15230.5, available: 15100.5, reserved: 130, decimals: 6, decimalsSource: "supported-assets" },
];

test("reserved ownership copy renders with a reservation, and only then", () => {
  const withReserve = renderToStaticMarkup(<BalancesView rows={rows} />);
  assert.match(withReserve, /Reserved funds are still yours/);
  const noReserve = renderToStaticMarkup(
    <BalancesView rows={[{ asset: "EURC", chains: ["BASE"], total: 100, available: 100, reserved: 0, decimals: 6, decimalsSource: "supported-assets" }]} />,
  );
  assert.doesNotMatch(noReserve, /Reserved funds are still yours/);
});

test("arithmetic mismatch is surfaced, not corrected", () => {
  const bad: AssetBalanceRow[] = [
    { asset: "USDT", chains: ["BASE"], total: 1000, available: 400, reserved: 100, decimals: 6, decimalsSource: "supported-assets" },
  ];
  assert.deepEqual(arithmeticMismatches(bad), ["USDT"]);
  assert.deepEqual(arithmeticMismatches(rows), []);
  const html = renderToStaticMarkup(<BalancesView rows={bad} />);
  assert.match(html, /don(?:'|&#x27;)t add up/);
  assert.match(html, /Showing the numbers as reported, unchanged\./);
  assert.match(html, /1,000\.00/, "the API's total still renders untouched");
});

test("entirely-reserved composition renders available 0 honestly", () => {
  const escrow: AssetBalanceRow[] = [
    { asset: "USDC", chains: ["BASE"], total: 4200, available: 0, reserved: 4200, decimals: 6, decimalsSource: "supported-assets" },
  ];
  const html = renderToStaticMarkup(<BalancesView rows={escrow} />);
  assert.match(html, /0\.00/, "available renders as zero, not blank");
  assert.match(html, /4,200\.00/);
  assert.match(html, /Reserved funds are still yours/);
});
