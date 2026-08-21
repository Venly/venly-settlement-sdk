import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import type { Party } from "@venlyfinance/sdk";
import {
  DirectoryPick,
  PAYOUT_STATUS_PILL,
  PAYOUT_ROUTE_STATUS_PILL,
  PayoutDetail,
  PayoutReview,
  RecipientPicker,
  SendReview,
  StepUpConfirm,
  TRANSFER_STATUS_PILL,
  TransferDetail,
  directoryVerification,
  parseAmountInput,
  partyDisplayName,
  payoutWaitingCopy,
  recipientUnusableReason,
  type DirectoryEntry,
  type SavedRecipientRow,
  type SendReviewProps,
} from "../registry/blocks/send.js";

// These tests pin the door's laws: the fork is the recipient's object type,
// directory rows never leak ids, unusable rows explain themselves, reviews
// render only produced figures, the step-up ceremony guards every commit,
// and terminal states carry the record's own words.

const RECEIVER_UUID = "a10c2d31-2222-4b20-8c63-000000000009";

const verifiedEntry: DirectoryEntry = {
  key: RECEIVER_UUID,
  name: "Nova Retail",
  handle: "cast-transacting",
  verification: "verified",
  receiverAccountId: RECEIVER_UUID,
};
const pendingEntry: DirectoryEntry = {
  ...verifiedEntry,
  key: "e2",
  name: "Atlas Imports",
  handle: "cast-iv-submitted",
  verification: "pending",
};
const rejectedEntry: DirectoryEntry = {
  ...verifiedEntry,
  key: "e3",
  name: "Delta Holdings",
  handle: "cast-denied",
  verification: "rejected",
};

const activeRecipient: SavedRecipientRow = {
  key: "ba-1",
  label: "Cygnus EUR settlement",
  accountHolderName: "Cygnus Freight N.V.",
  bankName: "Example Bank N.V.",
  rail: "SEPA",
  fiatCurrency: "EUR",
  last4: "6769",
  accountStatus: "ACTIVE",
  route: { id: "route-1", status: "ACTIVE", depositAssetName: "USDC", depositAssetChain: "BASE", fiatCurrency: "EUR" },
};
const proofRecipient: SavedRecipientRow = {
  ...activeRecipient,
  key: "ba-2",
  label: "Borea ops account",
  route: { ...activeRecipient.route!, id: "route-2", status: "AWAITING_OWNERSHIP_PROOF" },
};
const routelessRecipient: SavedRecipientRow = { ...activeRecipient, key: "ba-3", route: undefined };

test("directory verification reads kycStatus on individuals and kybStatus on organisations", () => {
  const individual = (kycStatus?: Party["kycStatus"]): Party => ({ partyType: "INDIVIDUAL", kycStatus });
  const organisation = (kybStatus?: Party["kybStatus"]): Party => ({ partyType: "ORGANISATION", kybStatus });
  assert.equal(directoryVerification(individual("VERIFIED")), "verified");
  assert.equal(directoryVerification(individual("VERIFICATION_PENDING")), "pending");
  assert.equal(directoryVerification(individual("REJECTED")), "rejected");
  assert.equal(directoryVerification(individual(undefined)), "pending", "no decision reads as pending");
  assert.equal(directoryVerification(organisation("VERIFIED")), "verified");
  assert.equal(directoryVerification(organisation("PENDING")), "pending");
  assert.equal(directoryVerification(organisation("DENIED")), "rejected");
});

test("party display name is the name, never an id", () => {
  assert.equal(partyDisplayName({ id: "0b54e9f1-0", partyType: "ORGANISATION", name: "Nova Retail" }), "Nova Retail");
  assert.equal(
    partyDisplayName({ id: "0b54e9f1-0", partyType: "INDIVIDUAL", firstName: "Ada", lastName: "Lovelace" }),
    "Ada Lovelace",
  );
});

test("directory rows: name + handle render, UUIDs do not; unusable rows carry the reason", () => {
  const html = renderToStaticMarkup(
    <DirectoryPick
      entries={[verifiedEntry, pendingEntry, rejectedEntry]}
      platformName="Acme Pay"
      onSelect={() => undefined}
    />,
  );
  assert.match(html, /Nova Retail/);
  assert.match(html, /cast-transacting/);
  assert.ok(!html.includes(RECEIVER_UUID), "the resolution id stays request-side");
  assert.match(html, /Can(?:'|&#x27;)t receive yet – identity verification pending\./);
  assert.match(html, /Can(?:'|&#x27;)t receive – verification declined\./);
  const disabled = (html.match(/aria-disabled="true"/g) ?? []).length;
  assert.equal(disabled, 2, "pending + rejected disabled, verified enabled");
});

test("directory empty state explains and offers the display-only invite", () => {
  const html = renderToStaticMarkup(
    <DirectoryPick entries={[]} platformName="Acme Pay" onSelect={() => undefined} />,
  );
  assert.match(html, /No one to pay yet\. People you can pay appear here once they join Acme Pay\./);
  assert.match(html, /Invite someone/);
});

test("the door: three recipient classes, the own-bank link row, and NO external-wallet surface", () => {
  const html = renderToStaticMarkup(
    <RecipientPicker
      platformName="Acme Pay"
      directory={{ entries: [verifiedEntry] }}
      savedRecipients={{ rows: [activeRecipient, proofRecipient, routelessRecipient] }}
      onPickPerson={() => undefined}
      onPickRecipient={() => undefined}
      onGoToWithdraw={() => undefined}
      onAddRecipient={() => undefined}
    />,
  );
  assert.match(html, /People on Acme Pay/);
  assert.match(html, /Saved recipients/);
  assert.match(html, /Your own bank account/);
  assert.match(html, /Withdraw to your bank/);
  assert.match(html, /Move money between accounts you already control\./);
  // Send-to-external-wallet is an honest omission - no teaser, no row.
  assert.doesNotMatch(html, /external wallet|wallet address|crypto address/i);
  // Masked details render from the response; the row never re-asks.
  assert.match(html, /••6769/);
});

test("saved-recipient rows without an ACTIVE route are disabled WITH the reason", () => {
  assert.equal(recipientUnusableReason(activeRecipient), null);
  assert.match(recipientUnusableReason(routelessRecipient) ?? "", /No active route yet/);
  assert.match(recipientUnusableReason(proofRecipient) ?? "", /Waiting on wallet proof/);
  assert.match(
    recipientUnusableReason({ ...activeRecipient, route: { ...activeRecipient.route!, status: "REJECTED" } }) ?? "",
    /Declined – this route can(?:'|&#x27;)?t be used/,
  );
});

test("amount guard rejects empty, zero, negative and Infinity inputs", () => {
  assert.equal(parseAmountInput("1240"), 1240);
  assert.equal(parseAmountInput(" 12.5 "), 12.5);
  for (const bad of ["", "   ", "0", "-100", "Infinity", "abc", "NaN"]) {
    assert.equal(parseAmountInput(bad), null, `"${bad}" must not stage`);
  }
});

test("intent-1 review: known figures only - no fee, no ETA, no rate; CTA restates", () => {
  const staged: SendReviewProps["staged"] = {
    entry: verifiedEntry,
    amount: 1240,
    unit: { kind: "fiat", currency: "EUR" },
    merchantReference: "INV-88",
    description: "supplier run",
  };
  const html = renderToStaticMarkup(
    <SendReview staged={staged} onConfirm={() => undefined} onEdit={() => undefined} />,
  );
  assert.match(html, /Nova Retail \(cast-transacting\)/);
  assert.match(html, /1,240\.00 EUR/);
  assert.match(html, /On-platform transfer/);
  assert.match(html, /Reference \(visible to your team and the recipient\)/);
  assert.match(html, /Description \(internal note\)/);
  assert.match(html, /Send 1,240\.00 EUR/, "commit CTA restates the amount");
  assert.doesNotMatch(html, /fee/i, "fee is an omission, never a row and never a 'No fee' claim");
  assert.doesNotMatch(html, /estimated|arriv|deliver|business day/i, "no timing claim exists to make");
  assert.doesNotMatch(html, /rate/i, "no pre-create rate exists");
});

test("intent-1 review, crypto: the compound asset · chain badge renders", () => {
  const staged: SendReviewProps["staged"] = {
    entry: verifiedEntry,
    amount: 250,
    unit: { kind: "crypto", asset: "USDC", chain: "BASE" },
  };
  const html = renderToStaticMarkup(
    <SendReview staged={staged} onConfirm={() => undefined} onEdit={() => undefined} />,
  );
  assert.match(html, /USDC · BASE/);
  assert.match(html, /Send 250\.00 USDC · BASE/);
});

test("intent-3 review: the two-sided sentence names units and parties, never a fiat figure", () => {
  const html = renderToStaticMarkup(
    <PayoutReview
      staged={{ recipient: activeRecipient, route: activeRecipient.route!, cryptoAmount: 850.5, idempotencyKey: "k" }}
      onConfirm={() => undefined}
      onEdit={() => undefined}
    />,
  );
  assert.match(
    html,
    /You send 850\.50 USDC on BASE\.\s*Cygnus Freight N\.V\. receives EUR\s*via SEPA\./,
    "the sentence composes from the route and beneficiary fields",
  );
  assert.match(
    html,
    /Fee and delivery time aren(?:'|&#x27;)t shown before you send – you(?:'|&#x27;)ll see the exact amounts once the payout completes\./,
  );
  assert.doesNotMatch(html, /850\.50 EUR/, "no invented fiat figure pre-create");
  assert.match(html, /Request payout of 850\.50 USDC/, "commit CTA restates");
});

test("step-up ceremony: copy, code slots, and a commit CTA that restates", () => {
  const html = renderToStaticMarkup(
    <StepUpConfirm
      kind="payout"
      commitLabel="Request payout of 850.50 USDC"
      verifier={{ verifyTotp: async () => ({ status: "ok" as const }) }}
      onConfirmed={() => undefined}
      onCancel={() => undefined}
    />,
  );
  assert.match(html, /Confirm it(?:'|&#x27;)s you/);
  assert.match(html, /Enter your 6-digit code to authorize this payout\./);
  assert.match(html, /Request payout of 850\.50 USDC/);
});

test("transfer vocabulary: three states, verbatim-derived", () => {
  assert.deepEqual(TRANSFER_STATUS_PILL.PENDING, { label: "Pending", intent: "pending" });
  assert.deepEqual(TRANSFER_STATUS_PILL.COMPLETED, { label: "Completed", intent: "positive" });
  assert.deepEqual(TRANSFER_STATUS_PILL.FAILED, { label: "Failed", intent: "negative" });
});

test("transfer detail, FAILED: the record's own error verbatim plus the support line", () => {
  const html = renderToStaticMarkup(
    <TransferDetail
      transfer={{
        id: "tr5e8c66-7777-4a70-9bb8-000000000042",
        status: "FAILED",
        asset: "USDC",
        chain: "BASE",
        amount: 55.25,
        errorMessage: "Receiver identity verification incomplete",
        createdAt: "2026-08-20T10:00:00Z",
      }}
      observedAt={Date.parse("2026-08-21T09:00:00Z")}
    />,
  );
  assert.match(html, /This transfer didn(?:'|&#x27;)t complete\./);
  assert.match(html, /Receiver identity verification incomplete/, "errorMessage verbatim");
  assert.match(html, /Contact support with the reference below\./);
  assert.match(html, /tr5e8c66-7777-4a70-9bb8-000000000042/, "the reference the support line points at");
  assert.match(html, /What we(?:'|&#x27;)ve seen/, "the observation log replaces invented stages");
});

test("transfer detail, COMPLETED: hash renders middle-ellipsized, compound badge intact", () => {
  const hash = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
  const html = renderToStaticMarkup(
    <TransferDetail
      transfer={{ id: "t1", status: "COMPLETED", asset: "USDC", chain: "BASE", amount: 1000.5, transactionHash: hash, createdAt: "2026-08-20T10:00:00Z" }}
    />,
  );
  assert.match(html, /USDC · BASE/);
  assert.ok(!html.includes(hash), "the full hash is copy-only, not the display");
  assert.match(html, /0x1234567890…90abcdef/);
  assert.match(html, /Copy Transaction hash/);
});

test("payout vocabulary: all 7 statuses; RETURNED is neutral, never a plain failure", () => {
  for (const status of ["REQUESTED", "SENDING", "PROVIDER_PROCESSING", "COMPLETED", "REJECTED", "FAILED", "RETURNED"]) {
    assert.ok(PAYOUT_STATUS_PILL[status], `${status} has a pill`);
  }
  assert.equal(PAYOUT_STATUS_PILL.RETURNED!.intent, "neutral");
  assert.equal(PAYOUT_STATUS_PILL.RETURNED!.label, "Returned");
  assert.equal(PAYOUT_STATUS_PILL.REJECTED!.intent, "negative");
});

test("payout waiting copy names who acts next", () => {
  assert.match(payoutWaitingCopy("REQUESTED") ?? "", /no action needed from you/);
  assert.match(payoutWaitingCopy("SENDING") ?? "", /no action needed from you/);
  assert.equal(
    payoutWaitingCopy("PROVIDER_PROCESSING"),
    "Provider processing – the payout provider is executing; no action needed from you.",
  );
  assert.equal(payoutWaitingCopy("COMPLETED"), null);
});

const payoutBase = {
  id: "c0a1e007-0000-4a00-9000-000000000042",
  accountId: "a1",
  rail: "SEPA" as const,
  cryptoAmount: 1800,
  fundingMode: "PULL" as const,
  requestedAt: "2026-08-12T14:20:00Z",
  payoutRoute: {
    id: "r1",
    depositAsset: { chain: "BASE" as const, name: "USDC" },
    fiatCurrency: "EUR",
    beneficiary: {
      accountHolderName: "Cygnus Freight N.V.",
      bankName: "Example Bank N.V.",
      details: { ibanLast4: "6769" },
    },
  },
};

test("payout detail, in flight: settled amount is an explicit null, never a guess", () => {
  const html = renderToStaticMarkup(
    <PayoutDetail payout={{ ...payoutBase, status: "PROVIDER_PROCESSING" }} />,
  );
  assert.match(html, /Provider processing – the payout provider is executing; no action needed from you\./);
  assert.match(html, /– confirmed on completion/);
  assert.doesNotMatch(html, /1,800\.00 EUR/, "no stablecoin-parity fiat figure is invented");
});

test("payout detail, COMPLETED: the settled figure and stamp render from the record", () => {
  const html = renderToStaticMarkup(
    <PayoutDetail
      payout={{ ...payoutBase, status: "COMPLETED", settledFiatAmount: 1793.42, completedAt: "2026-08-13T09:00:00Z", sendTxHash: "0xc0a1e0070000000000000000000000000000000000000000000000000000beef" }}
    />,
  );
  assert.match(html, /1,793\.42 EUR/);
  assert.match(html, /Completed/);
  assert.match(html, /Copy Transaction hash/);
});

test("payout detail, RETURNED: money-came-back framing plus the record's reason", () => {
  const html = renderToStaticMarkup(
    <PayoutDetail
      payout={{ ...payoutBase, status: "RETURNED", failureReason: "Returned by the receiving bank: beneficiary name mismatch" }}
    />,
  );
  assert.match(
    html,
    /Returned – the receiving bank sent this payout back\. The funds are back in your account\./,
  );
  assert.match(html, /beneficiary name mismatch/, "failureReason verbatim");
});

test("payout detail, FAILED: failureReason renders verbatim as the alert", () => {
  const html = renderToStaticMarkup(
    <PayoutDetail payout={{ ...payoutBase, status: "FAILED", failureReason: "Provider rejected the transaction" }} />,
  );
  assert.match(html, /Provider rejected the transaction/);
});

test("route-state vocabulary on the send side matches the ceremony's states verbatim", () => {
  for (const status of ["PENDING", "REGISTERING", "AWAITING_OWNERSHIP_PROOF", "ACTIVE", "REJECTED"]) {
    assert.ok(PAYOUT_ROUTE_STATUS_PILL[status], `${status} has a pill`);
  }
  assert.equal(PAYOUT_ROUTE_STATUS_PILL.REJECTED!.intent, "negative");
});
