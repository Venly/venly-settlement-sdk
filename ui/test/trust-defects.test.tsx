import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient } from "@tanstack/react-query";
import { VenlyProvider, venlyKeys } from "@venlyfinance/react";
import type { SupportedAsset } from "@venlyfinance/sdk";
import { formatAmount } from "../registry/lib/money.js";
import { ListLoadError } from "../registry/components/list-error.js";
import {
  BalancesBlock,
  BalancesView,
  assetBalanceRows,
  assetDecimals,
  precisionProvenance,
  type AssetBalanceRow,
} from "../registry/blocks/balances.js";
import { ReceiveBlock } from "../registry/blocks/receive.js";
import { ActivityBlock, UnifiedActivityBlock } from "../registry/blocks/activity.js";
import { BankAccountsBlock } from "../registry/blocks/bank-accounts.js";
import { WithdrawalsBlock, WithdrawFlow } from "../registry/blocks/withdraw.js";

// These tests pin the two trust rules every list-bearing block obeys:
//
// 1. A malformed envelope (resultPresent === false) renders an explicit
//    error with a retry – NEVER an empty list. An empty list is a claim
//    ("there is nothing") a malformed envelope cannot support.
// 2. Money renders at each asset's on-chain decimals from supported-assets,
//    with the precision's provenance stated – so the total a user sums by
//    eye equals the rows on screen, sub-cent digits included.

const ACCT = "a10c2d31-2222-4b20-8c63-000000000001";

/**
 * Render a connected block against a pre-seeded query cache: the block's
 * hooks resolve synchronously from the cache, so a single static render
 * reaches the state under test with zero network and zero waiting.
 */
function renderWithCache(seed: (qc: QueryClient) => void, ui: React.ReactNode): string {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  seed(queryClient);
  return renderToStaticMarkup(
    <VenlyProvider environment="mock" queryClient={queryClient}>
      {ui}
    </VenlyProvider>,
  );
}

const MALFORMED = { items: [], resultPresent: false, pagination: undefined };
const EMPTY_OK = { items: [], resultPresent: true, pagination: undefined };

// ─── Rule 1: resultPresent === false is an error state, per block ────────────

test("balances: malformed envelope renders the error with retry, not an empty surface", () => {
  const html = renderWithCache(
    (qc) => qc.setQueryData(venlyKeys.wallets(ACCT, undefined), MALFORMED),
    <BalancesBlock accountId={ACCT} />,
  );
  assert.match(html, /Balances couldn(?:'|&#x27;)t load/);
  assert.match(html, /Try again/);
  assert.doesNotMatch(html, /No balances yet/, "the empty-state claim must not render");
});

test("balances: an empty-but-present collection is NOT an error – the two states stay distinct", () => {
  const html = renderWithCache(
    (qc) => qc.setQueryData(venlyKeys.wallets(ACCT, undefined), EMPTY_OK),
    <BalancesBlock accountId={ACCT} />,
  );
  assert.match(html, /No balances yet/);
  assert.doesNotMatch(html, /couldn(?:'|&#x27;)t load/);
});

test("receive: malformed register renders the error, never the provision form", () => {
  const html = renderWithCache(
    (qc) => {
      qc.setQueryData(venlyKeys.account(ACCT), {
        id: ACCT,
        kycStatus: "VERIFIED",
        status: "ACTIVE",
      });
      qc.setQueryData(venlyKeys.virtualBankAccounts(ACCT, undefined), MALFORMED);
    },
    <ReceiveBlock accountId={ACCT} />,
  );
  assert.match(html, /We couldn(?:'|&#x27;)t load your bank details/);
  assert.match(html, /Retry/);
  assert.doesNotMatch(
    html,
    /[Ss]et up bank details/,
    "a malformed register must not offer provisioning – details may already exist",
  );
});

test("activity (transfers ledger): malformed list renders the error, not an empty ledger", () => {
  const html = renderWithCache(
    (qc) => qc.setQueryData(venlyKeys.transfers(ACCT, undefined), MALFORMED),
    <ActivityBlock accountId={ACCT} />,
  );
  assert.match(html, /We couldn(?:'|&#x27;)t load your activity/);
  assert.match(html, /Retry/);
});

test("activity (unified feed): ONE malformed ledger fails the whole surface", () => {
  const html = renderWithCache(
    (qc) => {
      qc.setQueryData(venlyKeys.transfers(ACCT, undefined), EMPTY_OK);
      qc.setQueryData(venlyKeys.rampRequests(undefined), MALFORMED);
    },
    <UnifiedActivityBlock accountId={ACCT} />,
  );
  assert.match(html, /We couldn(?:'|&#x27;)t load your activity/);
  assert.match(html, /Retry/);
  assert.doesNotMatch(
    html,
    /In progress/,
    "the surviving ledger must not render as if it were all activity",
  );
});

test("bank-accounts: malformed whitelist renders the error, never the add-account empty state", () => {
  const html = renderWithCache(
    (qc) => qc.setQueryData(venlyKeys.companyBankAccounts(undefined), MALFORMED),
    <BankAccountsBlock />,
  );
  assert.match(html, /We couldn(?:'|&#x27;)t load your bank accounts/);
  assert.match(html, /Retry/);
  assert.doesNotMatch(html, /Add a bank account/, "the add-account empty state must not render");
});

test("withdraw (history list): malformed list renders the error, not an empty history", () => {
  const html = renderWithCache(
    (qc) => qc.setQueryData(venlyKeys.rampRequests({ rampType: "OFF_RAMP" }), MALFORMED),
    <WithdrawalsBlock />,
  );
  assert.match(html, /We couldn(?:'|&#x27;)t load your withdrawals/);
  assert.match(html, /Retry/);
});

test("withdraw (flow): malformed destination whitelist blocks the picker, not renders it empty", () => {
  const html = renderWithCache(
    (qc) => qc.setQueryData(venlyKeys.companyBankAccounts(undefined), MALFORMED),
    <WithdrawFlow />,
  );
  assert.match(html, /We couldn(?:'|&#x27;)t load your bank accounts/);
  assert.match(html, /Retry/);
  assert.doesNotMatch(
    html,
    /[Aa]dd a bank account/,
    "the empty destination state must not render over a malformed whitelist",
  );
});

test("the shared error state is an alert and carries the incompleteness admission", () => {
  const html = renderToStaticMarkup(<ListLoadError what="your things" onRetry={() => {}} />);
  assert.match(html, /role="alert"/);
  assert.match(html, /the list may be\s+incomplete/);
  assert.match(html, /Retry/);
});

// ─── Rule 2: decimals drive the render, provenance stated ────────────────────

test("formatAmount: maxFractionDigits lets sub-cent digits through without padding", () => {
  assert.equal(formatAmount(8020.000875, 2, 6), "8,020.000875");
  assert.equal(formatAmount(1.5, 2, 6), "1.50", "the minimum holds – no zero-padding to 6");
  assert.equal(formatAmount(8020.000875, 2, 2), "8,020.00", "the defect this exists to fix");
  assert.equal(formatAmount(-0.000125, 2, 6), "−0.000125", "true minus survives");
});

const SUPPORTED: SupportedAsset[] = [
  {
    chain: "BASE",
    cryptoCurrency: "EURC",
    decimals: 6,
    contractAddress: "0x60a3e35cc302bfa44cb288bc5a4f316fdb1adb42",
  },
];

test("assetDecimals: contract address wins case-insensitively, symbol is fallback, default says so", () => {
  const byAddress = assetDecimals(
    { asset: "EURC", contractAddress: "0x60A3E35CC302BFA44CB288BC5A4F316FDB1ADB42" },
    SUPPORTED,
  );
  assert.deepEqual(byAddress, { decimals: 6, source: "supported-assets" });

  const bySymbol = assetDecimals({ asset: "EURC", contractAddress: undefined }, SUPPORTED);
  assert.deepEqual(bySymbol, { decimals: 6, source: "supported-assets" });

  const unknown = assetDecimals({ asset: "XYZ", contractAddress: "0xdead" }, SUPPORTED);
  assert.deepEqual(unknown, { decimals: 2, source: "default" });

  const noAssets = assetDecimals({ asset: "EURC", contractAddress: "0x60a3..." }, undefined);
  assert.deepEqual(noAssets, { decimals: 2, source: "default" });
});

test("assetBalanceRows threads decimals and provenance onto every row", () => {
  const rows = assetBalanceRows(
    [
      {
        asset: "EURC",
        contractAddress: "0x60a3e35cc302bfa44cb288bc5a4f316fdb1adb42",
        amount: { total: 8020.000875, available: 8020.000875, reserved: 0 },
      },
      { asset: "XYZ", contractAddress: "0xdead", amount: { total: 5, available: 5, reserved: 0 } },
    ],
    SUPPORTED,
  );
  const eurc = rows.find((r) => r.asset === "EURC")!;
  assert.equal(eurc.decimals, 6);
  assert.equal(eurc.decimalsSource, "supported-assets");
  const xyz = rows.find((r) => r.asset === "XYZ")!;
  assert.equal(xyz.decimals, 2);
  assert.equal(xyz.decimalsSource, "default");
});

test("provenance line: names the source, and names the fallback assets when precision is missing", () => {
  const supported: AssetBalanceRow = {
    asset: "EURC", chains: [], total: 1, available: 1, reserved: 0,
    decimals: 6, decimalsSource: "supported-assets",
  };
  const fallback: AssetBalanceRow = { ...supported, asset: "XYZ", decimals: 2, decimalsSource: "default" };

  assert.match(precisionProvenance([supported])!, /on-chain precision \(from supported-assets\)/);
  assert.match(precisionProvenance([supported, fallback])!, /except XYZ at 2 decimals/);
  assert.match(precisionProvenance([fallback])!, /precision is unavailable right now/);
  assert.equal(precisionProvenance([]), null);

  const html = renderToStaticMarkup(<BalancesView rows={[supported, fallback]} />);
  assert.match(html, /from supported-assets/, "the provenance line reaches the surface");
});

test("the total equals the sum of the rendered rows – sub-cent digits included", () => {
  // At 2dp this exact composition LIES on screen: total rounds to 0.01 while
  // both parts show 0.00, so the user's eye-sum is off by a visible cent.
  assert.equal(formatAmount(0.008, 2, 2), "0.01");
  assert.equal(formatAmount(0.004, 2, 2), "0.00");

  const row: AssetBalanceRow = {
    asset: "EURC", chains: [], total: 0.008, available: 0.004, reserved: 0.004,
    decimals: 6, decimalsSource: "supported-assets",
  };
  const html = renderToStaticMarkup(<BalancesView rows={[row]} />);

  // Every figure renders at the asset's precision...
  assert.match(html, />0\.008</, "total renders sub-cent digits");
  assert.doesNotMatch(html, />0\.01</, "no rounded total anywhere on the surface");

  // ...and the rendered strings reconcile: what the user sums by eye equals
  // the total on screen, at the same precision.
  const renderedTotal = formatAmount(row.total, 2, row.decimals);
  const renderedSum = formatAmount(row.available + row.reserved, 2, row.decimals);
  assert.equal(renderedSum, renderedTotal);
  assert.match(html, new RegExp(renderedTotal.replace(".", "\\.")));
});

test("balances block end-to-end: mock seeds render the sub-cent EURC balance, provenance stated", () => {
  // No pre-seeded wallet cache for supported-assets here – seed both reads
  // from the SDK's own mock fixtures to prove the whole chain: mock seeds →
  // hooks → decimals lookup → rendered sub-cent digits.
  const html = renderWithCache(
    (qc) => {
      qc.setQueryData(venlyKeys.wallets(ACCT, undefined), {
        items: [
          {
            asset: "EURC",
            contractAddress: "0x60a3e35cc302bfa44cb288bc5a4f316fdb1adb42",
            amount: { total: 8020.000875, available: 8020.000875, reserved: 0 },
          },
        ],
        resultPresent: true,
        pagination: undefined,
      });
      qc.setQueryData(venlyKeys.supportedAssets(), {
        items: SUPPORTED,
        resultPresent: true,
        pagination: undefined,
      });
    },
    <BalancesBlock accountId={ACCT} />,
  );
  assert.match(html, /8,020\.000875/, "sub-cent digits render");
  assert.doesNotMatch(html, /8,020\.00\b/, "no 2dp-rounded figure of the same balance");
  assert.match(html, /from supported-assets/);
});

test("balances block: supported-assets failing degrades to 2dp WITH the admission, not silently", () => {
  const html = renderWithCache(
    (qc) => {
      qc.setQueryData(venlyKeys.wallets(ACCT, undefined), {
        items: [
          {
            asset: "EURC",
            contractAddress: "0x60a3e35cc302bfa44cb288bc5a4f316fdb1adb42",
            amount: { total: 8020.000875, available: 8020.000875, reserved: 0 },
          },
        ],
        resultPresent: true,
        pagination: undefined,
      });
      qc.setQueryData(venlyKeys.supportedAssets(), MALFORMED);
    },
    <BalancesBlock accountId={ACCT} />,
  );
  assert.match(html, /precision is unavailable right now/);
  assert.match(html, /may display as 0\.00/);
});
