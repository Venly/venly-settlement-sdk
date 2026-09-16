#!/usr/bin/env node
/**
 * Staging smoke test: four checks that validate the SDK against the real
 * staging environment. Read-only; creates nothing, mutates nothing.
 *
 *   VENLY_CLIENT_ID=... VENLY_CLIENT_SECRET=... node scripts/staging-smoke.mjs
 *
 * Pass criteria: all four checks print OK. A missing fixture is SKIP and
 * exits 2 (incomplete), never a successful validation. Any failure prints the status,
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
    if (detail && typeof detail === "object" && detail.skipped) {
      results.push([name, "SKIP", detail.reason]);
    } else {
      results.push([name, "OK", detail]);
    }
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
  if (!accounts.items.length) return { skipped: true, reason: "no account fixture to probe payouts; provide a documented test account and rerun" };
  const payouts = await finance.payouts.list(accounts.items[0].id, { size: 1 });
  return `payout surface answered; ${payouts.pagination?.numberOfElements ?? payouts.items.length} payout(s)`;
});

let failed = 0;
let skipped = 0;
for (const [name, verdict, detail] of results) {
  if (verdict === "FAIL") failed += 1;
  if (verdict === "SKIP") skipped += 1;
  console.log(`${verdict.padEnd(4)} ${name} - ${detail}`);
}
console.log(failed > 0 ? `\n${failed} check(s) failed; ${skipped} skipped.` : skipped > 0 ? `\nSMOKE TEST INCOMPLETE: ${skipped} check(s) skipped; SDK not fully validated against ${environment}.` : `\nSMOKE TEST PASSED: SDK validated against ${environment}.`);
process.exit(failed > 0 ? 1 : skipped > 0 ? 2 : 0);
