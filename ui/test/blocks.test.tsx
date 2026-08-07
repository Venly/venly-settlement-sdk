import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { VenlyProvider } from "@venlyfinance/react";
import { ReceiveBlock, ConnectedReceiveBlock } from "../registry/blocks/receive.js";
import { SendReview, parseAmountInput, transferProgressSteps } from "../registry/blocks/send.js";
import {
  ActivityTable,
  TransferDetailPanel,
  transferStatusIntent,
} from "../registry/blocks/activity.js";

const viba = {
  name: "Main EUR",
  iban: "DE89370400440532013000",
  bic: "DEUTDEDB",
  bankName: "Deutsche Bank",
  beneficiaryName: "Acme GmbH",
  referenceCode: "VF-REF-12345",
  currency: "EUR" as const,
};

test("receive: the reference row is enforced, the warning sits above the fields", () => {
  const html = renderToStaticMarkup(<ReceiveBlock virtualBankAccount={viba} />);
  const warning = html.indexOf("must be included word for word");
  const reference = html.indexOf("VF-REF-12345");
  assert.ok(warning > 0, "mandatory-reference warning rendered");
  assert.ok(reference > warning, "warning callout sits above the field list");
  assert.match(html, /Required/, "reference row carries the Required pill");
  assert.match(html, /Copy all/, "set-level action above the card");
  assert.match(html, /aria-label="Copy Payment reference"/, "per-field copy names the field");
});

test("receive: a missing field renders the (not required) variant, never disappears", () => {
  const html = renderToStaticMarkup(
    <ReceiveBlock virtualBankAccount={{ ...viba, bic: undefined }} />,
  );
  assert.match(html, /BIC/, "the row is still present");
  assert.match(html, /\(not required\)/);
});

test("receive: a MISSING required reference never reads '(not required)'", () => {
  const html = renderToStaticMarkup(
    <ReceiveBlock virtualBankAccount={{ ...viba, referenceCode: undefined }} />,
  );
  const refRow = html.slice(html.indexOf("Payment reference"));
  assert.match(refRow, /Not assigned yet/);
  assert.match(refRow, /Required/, "the Required pill stays");
  assert.doesNotMatch(
    refRow.slice(0, refRow.indexOf("</dd>")),
    /\(not required\)/,
    "a required row must never claim to be optional",
  );
});

test("send: the amount guard rejects empty, zero, negative and Infinity inputs", () => {
  assert.equal(parseAmountInput("1240"), 1240);
  assert.equal(parseAmountInput(" 12.5 "), 12.5);
  for (const bad of ["", "   ", "0", "-100", "Infinity", "abc", "NaN"]) {
    assert.equal(parseAmountInput(bad), null, `"${bad}" must not stage`);
  }
});

test("send review: components before the total, and the button restates the amount", () => {
  const html = renderToStaticMarkup(
    <SendReview
      draft={{
        kind: "fiat",
        senderAccountId: "acc-1",
        body: { receiverAccountId: "acc-2", currency: "EUR", amount: 1240 },
      }}
      fee={4.5}
      onConfirm={() => {}}
      onEdit={() => {}}
    />,
  );
  assert.match(html, /Pay 1,240\.00 EUR/, "commit button restates the amount");
  const fee = html.indexOf("Transfer fee");
  const total = html.indexOf("Recipient receives");
  assert.ok(fee > 0 && fee < total, "the working comes before the answer");
  assert.match(html, /−/, "operator is literal in the gutter");
  assert.match(html, /aria-label="estimate"/, "uncertainty attaches to the number");
});

test("send progress: failure is terminal and carries the reason", () => {
  const steps = transferProgressSteps({
    phase: "failed",
    reason: "transfer-failed",
    transfer: { id: "t1", status: "FAILED", errorMessage: "Insufficient funds" },
  });
  const terminal = steps[steps.length - 1]!;
  assert.equal(terminal.state, "failed");
  assert.equal(terminal.label, "Insufficient funds");

  const done = transferProgressSteps({
    phase: "completed",
    staged: {
      draft: { kind: "fiat", senderAccountId: "a", body: { currency: "EUR", amount: 1 } },
      idempotencyKey: "k",
      stagedAt: "now",
    },
    transfer: { id: "t2", status: "COMPLETED" },
  });
  assert.equal(done[done.length - 1]!.state, "completed");
});

test("activity: colour is a budget - settled rows stay quiet, pending and failed speak", () => {
  assert.equal(transferStatusIntent("COMPLETED"), null);
  assert.equal(transferStatusIntent("PENDING")?.intent, "pending");
  assert.equal(transferStatusIntent("FAILED")?.intent, "negative");

  const html = renderToStaticMarkup(
    <ActivityTable
      transfers={[
        { id: "1", description: "Settled one", status: "COMPLETED", amount: 10, asset: "USDC" },
        { id: "2", description: "Pending one", status: "PENDING", amount: 20, asset: "USDC" },
      ]}
    />,
  );
  const settledRow = html.slice(html.indexOf("Settled one"), html.indexOf("Pending one"));
  assert.doesNotMatch(settledRow, /data-intent/, "completed row carries no pill");
  assert.match(html.slice(html.indexOf("Pending one")), /data-intent="pending"/);
});

test("activity detail: the panel timeline's terminal node carries the failure reason", () => {
  const html = renderToStaticMarkup(
    <TransferDetailPanel
      transfer={{
        id: "t9",
        amount: 55,
        asset: "USDC",
        status: "FAILED",
        errorMessage: "Recipient account closed",
        createdAt: "2026-08-07T09:00:00Z",
      }}
      onClose={() => {}}
    />,
  );
  assert.match(html, /Recipient account closed/);
  assert.match(html, /✕/, "failed node glyph");
  assert.doesNotMatch(
    html.slice(html.indexOf('data-state="failed"')),
    /state-success/,
    "no success styling on the failed terminal",
  );
});

test("connected receive block renders its loading state under the mock provider (SSR-safe)", () => {
  const html = renderToStaticMarkup(
    <VenlyProvider environment="mock">
      <ConnectedReceiveBlock accountId="acc-1" />
    </VenlyProvider>,
  );
  assert.match(html, /Loading account details/);
});
