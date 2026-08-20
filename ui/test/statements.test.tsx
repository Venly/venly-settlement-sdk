import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient } from "@tanstack/react-query";
import { VenlyProvider, venlyKeys } from "@venlyfinance/react";
import type { Transfer } from "@venlyfinance/sdk";
import {
  StatementsBlock,
  StatementsView,
  customPeriod,
  deriveOpeningClosing,
  lastCompleteMonth,
  monthPeriod,
  runningBalances,
  statementIdentity,
  statementLines,
  type StatementLine,
} from "../registry/blocks/statements.js";
import { unifyActivity } from "../registry/blocks/activity.js";

const ACCT = "acct-1";
const OTHER = "acct-2";

const transfer = (over: Partial<Transfer>): Transfer =>
  ({
    id: "t1",
    senderAccountId: ACCT,
    receiverAccountId: OTHER,
    asset: "USDC",
    amount: 100,
    status: "COMPLETED",
    createdAt: "2026-07-10T10:00:00Z",
    ...over,
  }) as Transfer;

test("last complete month is the prior UTC calendar month", () => {
  assert.deepEqual(lastCompleteMonth(new Date("2026-08-20T09:00:00Z")), { year: 2026, month: 7 });
  assert.deepEqual(lastCompleteMonth(new Date("2026-01-05T00:00:00Z")), { year: 2025, month: 12 });
  const july = monthPeriod(2026, 7);
  assert.equal(july.start, "2026-07-01T00:00:00.000Z");
  assert.equal(july.end, "2026-07-31T23:59:59.999Z");
  assert.match(july.label, /July 2026/);
});

test("custom range rejects inverted dates and accepts an inclusive ISO window", () => {
  assert.equal(customPeriod("2026-07-10", "2026-07-01"), null);
  const range = customPeriod("2026-07-01", "2026-07-18")!;
  assert.equal(range.start, "2026-07-01T00:00:00.000Z");
  assert.equal(range.end, "2026-07-18T23:59:59.999Z");
});

test("opening + in-range completed transfers = closing, walked from the current wallet total", () => {
  const period = monthPeriod(2026, 7);
  const transfers = [
    transfer({ id: "in-range-out", amount: 100, createdAt: "2026-07-10T10:00:00Z" }),
    transfer({
      id: "in-range-in",
      amount: 50,
      senderAccountId: OTHER,
      receiverAccountId: ACCT,
      createdAt: "2026-07-18T08:00:00Z",
    }),
    transfer({ id: "after", amount: 200, createdAt: "2026-08-02T10:00:00Z" }),
    transfer({ id: "pending", amount: 10, status: "PENDING", createdAt: "2026-07-24T10:00:00Z" }),
  ];
  const derived = deriveOpeningClosing({
    currentTotal: 1000,
    transfers,
    accountId: ACCT,
    asset: "USDC",
    periodStart: period.start,
    periodEnd: period.end,
  });
  assert.equal(derived.opening, 1250);
  assert.equal(derived.closing, 1200);
  assert.equal(derived.opening! + -100 + 50, derived.closing);
});

test("missing wallet total omits opening and closing rather than inventing them", () => {
  const period = monthPeriod(2026, 7);
  const derived = deriveOpeningClosing({
    transfers: [transfer({})],
    accountId: ACCT,
    asset: "USDC",
    periodStart: period.start,
    periodEnd: period.end,
  });
  assert.equal(derived.opening, undefined);
  assert.equal(derived.closing, undefined);
  assert.match(derived.omitted ?? "", /not shown/);
});

test("running balance skips company-wide ramps and pending transfers", () => {
  const lines: StatementLine[] = [
    { key: "t1", kind: "transfer", label: "Transfer sent", signedAmount: -100, countsTowardBalance: true },
    { key: "r1", kind: "ramp", label: "Withdrawal", signedAmount: -40, countsTowardBalance: false },
    { key: "t2", kind: "transfer", label: "Transfer received", signedAmount: 50, countsTowardBalance: true },
  ];
  assert.deepEqual(runningBalances(1250, lines), [1150, undefined, 1200]);
});

test("identity uses real vIBAN fields and omits coordinates that are not there", () => {
  const withIban = statementIdentity(ACCT, [
    { status: "ACTIVE", iban: "DE89370400440532013000", bic: "DEUTDEDBFRA", beneficiaryName: "Acme Corporation B.V." },
  ]);
  assert.equal(withIban.partyName, "Acme Corporation B.V.");
  assert.equal(withIban.iban, "DE89370400440532013000");
  const bare = statementIdentity(ACCT, []);
  assert.equal(bare.iban, undefined);
  assert.equal(bare.partyName, undefined);
});

test("the document renders coverage, Money figures, and table containment", () => {
  const period = monthPeriod(2026, 7);
  const lines = statementLines(
    unifyActivity(
      [
        transfer({ id: "t-out", amount: 100, description: "Supplier settlement", merchantReference: "PAY-2026-001234" }),
        transfer({
          id: "t-in",
          amount: 50,
          senderAccountId: OTHER,
          receiverAccountId: ACCT,
          createdAt: "2026-07-18T08:00:00Z",
        }),
      ],
      [],
    ),
    ACCT,
    "USDC",
    period,
  );
  const html = renderToStaticMarkup(
    <StatementsView
      identity={{
        accountId: ACCT,
        partyName: "Acme Corporation B.V.",
        iban: "DE89370400440532013000",
        bic: "DEUTDEDBFRA",
      }}
      period={period}
      months={[{ year: 2026, month: 7 }]}
      customFrom=""
      customTo=""
      onSelectMonth={() => undefined}
      onCustomFrom={() => undefined}
      onCustomTo={() => undefined}
      onChooseCustom={() => undefined}
      asset="USDC"
      decimals={6}
      opening={1250}
      closing={1200}
      lines={lines}
    />,
  );
  assert.match(html, /Account statement/);
  assert.match(html, /July 2026/);
  assert.match(html, /Acme Corporation B\.V\./);
  assert.match(html, /DE89370400440532013000/);
  assert.match(html, /1,250\.00/);
  assert.match(html, /1,200\.00/);
  assert.match(html, /venly-table-scroll/);
  assert.match(html, /Pay-in sessions are not included/);
  assert.doesNotMatch(html, /toFixed/);
  assert.match(html, /aria-label="Statement period"/);
});

test("connected block: malformed envelope is an error, never an empty statement", () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  const malformed = { items: [], resultPresent: false, pagination: undefined };
  qc.setQueryData(venlyKeys.transfers(ACCT, undefined), malformed);
  qc.setQueryData(venlyKeys.rampRequests(undefined), { items: [], resultPresent: true, pagination: undefined });
  qc.setQueryData(venlyKeys.wallets(ACCT, undefined), { items: [], resultPresent: true, pagination: undefined });
  qc.setQueryData(venlyKeys.virtualBankAccounts(ACCT, undefined), {
    items: [],
    resultPresent: true,
    pagination: undefined,
  });
  qc.setQueryData(venlyKeys.supportedAssets(), { items: [], resultPresent: true, pagination: undefined });
  const html = renderToStaticMarkup(
    <VenlyProvider environment="mock" queryClient={qc}>
      <StatementsBlock accountId={ACCT} clock={new Date("2026-08-20T09:00:00Z")} />
    </VenlyProvider>,
  );
  assert.match(html, /couldn(?:'|&#x27;)t load your statement/);
  assert.doesNotMatch(html, /Account statement/);
});
