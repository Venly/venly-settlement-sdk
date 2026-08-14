#!/usr/bin/env node
/**
 * Staging smoke test: the three calls that validate the SDK against the real
 * staging environment. Read-only; creates nothing, mutates nothing.
 *
 *   VENLY_CLIENT_ID=... VENLY_CLIENT_SECRET=... node scripts/staging-smoke.mjs
 *
 * Pass criteria: all three checks print OK. Any failure prints the status,
 * traceCode and body needed to diagnose whether it is auth, base-URL, or
 * schema drift.
 */
import { VenlyFinanceClient, FundflowClient, VenlyApiError } from "../dist/esm/index.js";

const clientId = process.env.VENLY_CLIENT_ID;
const clientSecret = process.env.VENLY_CLIENT_SECRET;
// qa runs the leading contract this SDK is generated from; staging is default.
const environment = process.env.VENLY_ENV === "qa" ? "qa" : "staging";
if (!clientId || !clientSecret) {
  console.error(
    "Set VENLY_CLIENT_ID and VENLY_CLIENT_SECRET (staging realm; add VENLY_ENV=qa for the qa realm) and re-run.",
  );
  process.exit(2);
}

const results = [];
async function check(name, fn) {
  try {
    const detail = await fn();
    results.push([name, "OK", detail]);
  } catch (err) {
    const detail =
      err instanceof VenlyApiError
        ? `HTTP ${err.status} traceCode=${err.traceCode ?? "-"} ${JSON.stringify(err.errors)}`
        : String(err);
    results.push([name, "FAIL", detail]);
  }
}

const finance = new VenlyFinanceClient({ clientId, clientSecret, environment });
const fundflow = new FundflowClient({ clientId, clientSecret, environment });

// 1. auth + finance base URL + envelope + pagination
await check("finance parties.list()", async () => {
  const page = await finance.parties.list({ size: 1 });
  return `auth ok, ${page.pagination?.numberOfElements ?? page.items.length} item(s) on page 1`;
});

// 2. fundflow base URL + array unwrap
await check("fundflow referenceData.chains()", async () => {
  const chains = await fundflow.referenceData.chains();
  return `${chains.length} chain(s)`;
});

// 3. finance read on a second resource shape (accounts)
await check("finance accounts.list()", async () => {
  const page = await finance.accounts.list({ size: 1 });
  return `${page.pagination?.numberOfElements ?? page.items.length} item(s) on page 1`;
});

// 4. payout surface exists on this environment's contract (read-only; qa has
// it, production may trail - a 404 here is a contract-version finding, not
// an auth failure).
await check("finance payouts route reachable", async () => {
  const accounts = await finance.accounts.list({ size: 1 });
  if (!accounts.items.length) return "no accounts to probe payouts with (skipped)";
  const payouts = await finance.payouts.list(accounts.items[0].id, { size: 1 });
  return `payout surface answered; ${payouts.pagination?.numberOfElements ?? payouts.items.length} payout(s)`;
});

let failed = 0;
for (const [name, verdict, detail] of results) {
  if (verdict === "FAIL") failed += 1;
  console.log(`${verdict.padEnd(4)} ${name} - ${detail}`);
}
console.log(failed === 0 ? `\nSMOKE TEST PASSED: SDK validated against ${environment}.` : `\n${failed} check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
