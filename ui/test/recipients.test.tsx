import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { VenlyProvider } from "@venlyfinance/react";
import {
  AddRecipientForm,
  BENEFICIARY_ACCOUNT_STATUS_PILL,
  RECIPIENT_ROLE_STATUS_PILL,
  ROUTE_STATUS_PILL,
  maskedDetailLine,
  payoutRouteLinks,
} from "../registry/blocks/recipients.js";

// The recipients surface's laws: verbatim state vocabulary, masked details
// rendered (never re-asked), and the session route-link registry that
// stands in for the join the wire does not carry.

test("role vocabulary: ACTIVE and INACTIVE render word + intent, verbatim-derived", () => {
  assert.deepEqual(RECIPIENT_ROLE_STATUS_PILL.ACTIVE, { label: "Active", intent: "positive" });
  assert.deepEqual(RECIPIENT_ROLE_STATUS_PILL.INACTIVE, { label: "Inactive", intent: "neutral" });
});

test("beneficiary-account vocabulary: PENDING is a wait, DISABLED is neutral", () => {
  assert.deepEqual(BENEFICIARY_ACCOUNT_STATUS_PILL.PENDING, { label: "In review", intent: "pending" });
  assert.deepEqual(BENEFICIARY_ACCOUNT_STATUS_PILL.ACTIVE, { label: "Active", intent: "positive" });
  assert.deepEqual(BENEFICIARY_ACCOUNT_STATUS_PILL.DISABLED, { label: "Disabled", intent: "neutral" });
});

test("route vocabulary covers every documented state; REJECTED is terminal-negative", () => {
  for (const status of ["PENDING", "REGISTERING", "AWAITING_OWNERSHIP_PROOF", "ACTIVE", "REJECTED"]) {
    assert.ok(ROUTE_STATUS_PILL[status], `${status} has a pill`);
  }
  assert.equal(ROUTE_STATUS_PILL.AWAITING_OWNERSHIP_PROOF!.label, "Waiting on wallet proof");
  assert.equal(ROUTE_STATUS_PILL.REJECTED!.intent, "negative");
});

test("masked detail line renders the server's mask - ••last4 - and never a full number", () => {
  const line = maskedDetailLine({
    accountHolderName: "Cygnus Freight N.V.",
    bankName: "Example Bank N.V.",
    rail: "SEPA",
    details: { ibanLast4: "6769" },
  });
  assert.equal(line, "Cygnus Freight N.V. · Example Bank N.V. · ••6769 · SEPA");
  const ach = maskedDetailLine({
    accountHolderName: "Acme Corporation B.V.",
    bankName: "US Bank",
    rail: "US_ACH",
    details: { accountNumberLast4: "6789", abaRoutingNumber: "021000021" },
  });
  assert.match(ach, /••6789/);
});

test("route links: the create-time pairing is recorded, readable and observable", () => {
  const before = payoutRouteLinks.version();
  let notified = 0;
  const unsubscribe = payoutRouteLinks.subscribe(() => {
    notified++;
  });
  payoutRouteLinks.record("route-test-1", "ba-test-1");
  assert.equal(payoutRouteLinks.bankAccountFor("route-test-1"), "ba-test-1");
  assert.equal(payoutRouteLinks.bankAccountFor("route-unknown"), undefined, "nothing is guessed");
  assert.ok(payoutRouteLinks.version() > before);
  assert.equal(notified, 1);
  unsubscribe();
});

test("add-recipient form: business and person shapes, no invented required fields beyond the create call", () => {
  const html = renderToStaticMarkup(
    <VenlyProvider environment="mock">
      <AddRecipientForm accountId="a1" onAdded={() => undefined} />
    </VenlyProvider>,
  );
  assert.match(html, /Add a recipient/);
  assert.match(html, /Business/);
  assert.match(html, /Person/);
  assert.match(html, /Business name/);
});
