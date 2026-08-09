import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import type { FundflowComponents } from "@venlyfinance/sdk";
import {
  BANK_ACCOUNT_STATUS_PILL,
  BankAccountsView,
  type CompanyBankAccountListItem,
} from "../registry/blocks/bank-accounts.js";
import {
  DestinationPicker,
  WITHDRAW_STATUS_PILL,
  WithdrawReview,
  WithdrawalsTable,
  parseWithdrawAmount,
  withdrawalGroups,
} from "../registry/blocks/withdraw.js";

// These tests pin the journey's laws: verification gates the destination,
// a refusal never reads as a wait, pending never sits beside settled, the
// fee carries its unit, and the review never renders a figure the API
// hasn't produced.

type fundflow = FundflowComponents["schemas"];

const verified: CompanyBankAccountListItem = {
  id: "ba-1",
  name: "Primary EUR account",
  bankName: "Mock Bank AG",
  bankCountry: "DE",
  bankAccountType: "EUR_SEPA",
  supportedRampType: "ON_AND_OFF_RAMP",
  verificationStatus: "VERIFIED",
};
const pending: CompanyBankAccountListItem = {
  ...verified,
  id: "ba-2",
  name: "US operating account",
  verificationStatus: "PENDING",
};
const denied: CompanyBankAccountListItem = {
  ...verified,
  id: "ba-3",
  name: "Old account",
  verificationStatus: "DENIED",
};

test("bank accounts: verification status renders word + glyph from the field verbatim", () => {
  assert.deepEqual(BANK_ACCOUNT_STATUS_PILL.PENDING, { label: "In review", intent: "pending" });
  assert.deepEqual(BANK_ACCOUNT_STATUS_PILL.VERIFIED, { label: "Verified", intent: "positive" });
  assert.deepEqual(BANK_ACCOUNT_STATUS_PILL.DENIED, { label: "Declined", intent: "negative" });
  const html = renderToStaticMarkup(<BankAccountsView accounts={[verified, pending, denied]} />);
  assert.match(html, /In review/);
  assert.match(html, /Verified/);
  assert.match(html, /Declined/);
});

test("bank accounts: empty state explains and stays quiet", () => {
  const html = renderToStaticMarkup(<BankAccountsView accounts={[]} />);
  assert.match(html, /No bank accounts yet\. Add one to withdraw funds\./);
});

test("destination picker: only VERIFIED is selectable; others disabled WITH the reason", () => {
  const html = renderToStaticMarkup(
    <DestinationPicker accounts={[verified, pending, denied]} onSelect={() => undefined} />,
  );
  assert.match(html, /In review – available once verified\./);
  assert.match(
    html,
    /Declined – this account can(?:'|&#x27;)t receive withdrawals\. Add a different account or contact support for details\./,
  );
  const disabledCount = (html.match(/aria-disabled="true"/g) ?? []).length;
  assert.equal(disabledCount, 2, "pending + denied rows disabled, verified enabled");
});

test("destination picker: no verified account blocks the start with the unblocking CTA", () => {
  const html = renderToStaticMarkup(
    <DestinationPicker accounts={[pending]} onSelect={() => undefined} onGoToBankAccounts={() => undefined} />,
  );
  assert.match(html, /You need a verified bank account before you can withdraw\. Add one in Settings\./);
  assert.match(html, /Go to bank accounts/);
});

test("status vocabulary: a refusal never reads as a wait", () => {
  assert.equal(WITHDRAW_STATUS_PILL.BLOCKED.label, "On hold · contact support");
  assert.equal(WITHDRAW_STATUS_PILL.BLOCKED.intent, "neutral");
  assert.equal(WITHDRAW_STATUS_PILL.DENIED.label, "Declined · contact support");
  assert.equal(WITHDRAW_STATUS_PILL.DENIED.intent, "negative");
  assert.equal(WITHDRAW_STATUS_PILL.SUCCEEDED.label, "Paid out");
  assert.equal(WITHDRAW_STATUS_PILL.AWAITING_FUNDS.label, "Approved · awaiting funds");
  assert.equal(WITHDRAW_STATUS_PILL.CANCELLED.intent, "neutral", "cancelled is never red");
});

test("withdrawals: pending family sections above terminal, zero-counts still render", () => {
  const items = [
    { id: "r1", status: "SUCCEEDED", fiatAmount: 100, fiatCurrency: "EUR" },
    { id: "r2", status: "AWAITING_APPROVAL", fiatAmount: 50, fiatCurrency: "EUR" },
    { id: "r3", status: "PROCESSING", fiatAmount: 75, fiatCurrency: "EUR" },
  ] as fundflow["RampRequestListItem"][];
  const groups = withdrawalGroups(items);
  assert.equal(groups[0].key, "pending");
  assert.deepEqual(groups[0].rows.map((r) => r.id), ["r2", "r3"]);
  assert.deepEqual(groups[1].rows.map((r) => r.id), ["r1"]);

  const html = renderToStaticMarkup(<WithdrawalsTable items={items} />);
  const pendingIdx = html.indexOf("In progress");
  const completedIdx = html.indexOf("Completed");
  assert.ok(pendingIdx > -1 && completedIdx > pendingIdx, "pending band above completed band");

  const emptyPending = renderToStaticMarkup(
    <WithdrawalsTable items={[{ id: "r1", status: "SUCCEEDED", fiatAmount: 1, fiatCurrency: "EUR" }] as fundflow["RampRequestListItem"][]} />,
  );
  assert.match(emptyPending, /In progress/, "zero-count section still renders");
});

test("amount guard: empty, zero, negative and Infinity never stage", () => {
  assert.equal(parseWithdrawAmount(""), null);
  assert.equal(parseWithdrawAmount("  "), null);
  assert.equal(parseWithdrawAmount("0"), null);
  assert.equal(parseWithdrawAmount("-5"), null);
  assert.equal(parseWithdrawAmount("Infinity"), null);
  assert.equal(parseWithdrawAmount("123.45"), 123.45);
});

test("review: known figures only - fee carries its unit, commit restates the amount, NO bank-receives figure", () => {
  const html = renderToStaticMarkup(
    <WithdrawReview
      staged={{
        destination: verified,
        amount: 800,
        cryptoCurrency: "USDC",
        cryptoCurrencyId: "cc-1",
        fiatCurrency: "EUR",
        fiatCurrencyId: "fc-1",
        feeAmount: 8,
        feePercentage: 1,
      }}
      onConfirm={() => undefined}
      onEdit={() => undefined}
    />,
  );
  assert.match(html, /You send/);
  assert.match(html, /800\.00 USDC/);
  assert.match(html, /Fee \(1%\)/);
  assert.match(html, /8\.00 USDC/, "the fee figure carries the entered asset as its unit");
  assert.match(html, /Request withdrawal of 800\.00 USDC/, "commit button restates the amount");
  assert.doesNotMatch(html, /receives|Receives/, "no bank-receives row pre-create - a true omission");
  assert.doesNotMatch(html, /[•*]{3,}/, "values are never masked on a review screen");
});
