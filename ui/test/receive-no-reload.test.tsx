import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient } from "@tanstack/react-query";
import { VenlyFinanceClient, type VirtualBankAccount } from "@venlyfinance/sdk";
import { VenlyProvider, venlyKeys } from "@venlyfinance/react";
import { ReceiveBlock } from "../registry/blocks/receive.js";

// Regression proof for the page-reload defect: receive.tsx used to call
// window.location.reload() on a successful bank-details create (and again on its
// "Reload bank details" button). The demo runs on an in-memory mock session, so a
// full reload signs the user out and discards the virtual bank account that was just
// created — its payment reference becomes unobservable and the reconciliation journey
// unreachable. The fix threads onCreated = vbaQuery.refetch() from ReceiveBlock into
// ProvisionForm (and onRefresh into DetailPage). A refetch reads the same store, so
// this test models exactly that: create through the SDK mock, reload from the same
// client (whose stateful fixture store retained what was stored), seed a QueryClient
// via venlyKeys — every key routes through it, exactly as onCreated's refresh lands —
// and render. Any location.reload() during the render records a call, so a regression
// fails loud instead of signing the user out.

/** Fixture account that seeds no VBA at all and is VERIFIED (confirmed against the mock store). */
const ACCOUNT_ID = "a10c2d31-2222-4b20-8c63-000000000006";

const SOURCE = readFileSync(
   new URL("../registry/blocks/receive.tsx", import.meta.url),
    "utf8",
);

test("receive: no path in the surface asks for a full page reload", () => {
  assert.doesNotMatch(
     SOURCE,
     /location\.reload/,
     "receive.tsx must never call window.location.reload()",
   );
});

// The reload button was previously unconditional, so every path that showed bank
// details showed a way to refresh them. Making the handler an optional prop moved
// that guarantee into each call site, and the multi-VBA path (PickerPage -> DetailPage)
// was left without one: a user with two accounts silently lost the control. Threading
// it through PickerPage restored it, and this asserts the guarantee at the source
// rather than trusting each future call site to remember.
/**
 * The opening tag of every `<DetailPage …>` in the source, extracted by scanning
 * rather than by one regex. A lazy `/<DetailPage[\s\S]*?\/>/` looks equivalent and
 * is not: on a paired `<DetailPage>…</DetailPage>` form it runs past the opening
 * tag hunting for the next literal `/>` and can pick up an `onRefresh=` belonging
 * to a child, or sitting in a comment — so a render site with no handler at all
 * would pass. Brace depth is tracked because prop values contain `>` (an arrow
 * function) and `/` (a closing tag inside a child), neither of which ends the tag.
 */
function detailPageOpeningTags(source: string): string[] {
  const tags: string[] = [];
  const marker = /<DetailPage\b/g;
  let hit: RegExpExecArray | null;
  while ((hit = marker.exec(source)) !== null) {
    let depth = 0;
    for (let i = hit.index; i < source.length; i += 1) {
      const ch = source[i];
      if (ch === "{") depth += 1;
      else if (ch === "}") depth -= 1;
      else if (depth === 0 && ch === ">") {
        tags.push(source.slice(hit.index, i + 1));
        break;
      }
     }
   }
  return tags;
}

test("receive: every path that renders bank details also offers a way to refresh them", () => {
  const tags = detailPageOpeningTags(SOURCE);
  // Three in ReceiveBlock's router + two in ReceiveDetailsReadOnly (the
  // support view: single-active and closed-only branches).
  assert.equal(tags.length, 5, "expected exactly the five known DetailPage render sites");
  for (const tag of tags) {
    assert.match(
       tag,
       /onRefresh=/,
       `a DetailPage render site omits onRefresh, so its bank details cannot be refreshed: ${tag}`,
     );
   }
});

test("receive: the render-site scan reads opening tags, not whatever follows them", () => {
   // Guards the guard. Each fixture is a render site with NO handler on the tag,
   // shaped the way a future edit plausibly would be, and each must be caught.
  const undetectable = [
     "<DetailPage vba={v} account={a} />",
     "<DetailPage vba={v} account={a}>\n  <Child onRefresh={r} />\n</DetailPage>",
     "<DetailPage\n  vba={v}\n  account={a}\n/>",
     "<DetailPage vba={v} account={a}>{/* onRefresh= intentionally omitted */}</DetailPage>",
   ];
  for (const fixture of undetectable) {
    const tags = detailPageOpeningTags(fixture);
    assert.equal(tags.length, 1, `one opening tag expected in: ${fixture}`);
    assert.doesNotMatch(
       tags[0],
       /onRefresh=/,
       `the scan must not credit a handler that is not on the tag: ${fixture}`,
     );
   }

   // And it must still see a handler that IS on the tag, including through an
   // arrow function, whose `>` must not be mistaken for the end of the tag.
  const withHandler = detailPageOpeningTags(
     "<DetailPage vba={v} account={a} onRefresh={() => void q.refetch()} />",
   );
  assert.equal(withHandler.length, 1);
  assert.match(withHandler[0], /onRefresh=/);
});

test("receive: a successful provision shows the new details and their payment reference in the same mounted surface", async () => {
  const client = new VenlyFinanceClient({ environment: "mock" });
  const account = await client.accounts.get(ACCOUNT_ID);
  assert.equal(
     account.kycStatus,
      "VERIFIED",
     "the fixture account is verified and creatable",
   );

    // 1. The pre-create list: what ReceiveBlock saw before rendering the provision form.
  const before = await client.virtualBankAccounts.list(ACCOUNT_ID);
  assert.equal(
     before.items.filter((i): i is VirtualBankAccount => i != null).length,
      0,
     "the fixture account starts with no bank details",
   );

    // 2. The create itself, via the same client a UI mutation would use through
   //    useCreateVirtualBankAccount. Idempotency key pinned for the test run — never
   //    derived from Date.now() (the source's current derivation is reported as an open
   //    follow-up in the PR and intentionally left out of scope here).
  const created = await client.virtualBankAccounts.create(ACCOUNT_ID, {
    name: "Reconcilable SEPA Details",
     inCurrency: "EUR",
     targetCryptocurrency: "USDC",
     idempotencyKey: "test-no-reload-0001",
   });
  assert.ok(created.id);
  assert.ok(created.referenceCode, "the created details carry a payment reference");

    // 3. The refetch onCreated performs: same client, same stateful fixture store —
   //    the store retains what step 2 stored. A full page reload is exactly what
   //    would have discarded it before this design could take over.
  const after = await client.virtualBankAccounts.list(ACCOUNT_ID);
  const items = after.items.filter((i): i is VirtualBankAccount => i != null);
  assert.equal(items.length, 1, "exactly one valid bank-details entry now exists");
   assert.ok(
     items[0]!.id === created.id,
      "the refetched page holds the newly created entry",
   );
  for (const field of [
        "referenceCode",
         "beneficiaryName",
       "iban",
        "bic",
        "bankName",
        "currency",
    ]) {
    assert.ok(
      items[0]![field as keyof VirtualBankAccount],
      `the created details carry ${field}`,
     );
   }

    // 4. A refetch writes the query cache, so seed a QueryClient with exactly that
   //    data before rendering (every key routes through venlyKeys).
  const queryClient = new QueryClient({
     defaultOptions: { queries: { retry: false } },
   });
  queryClient.setQueryData(venlyKeys.account(ACCOUNT_ID), account);
  queryClient.setQueryData(venlyKeys.virtualBankAccounts(ACCOUNT_ID), after);

    // 5. Render: the whole ReceiveBlock tree for this seeded state. Any
   //    location.reload() during that render records a call; Node has no usable
   //    window.location here, so install a sentinel that counts instead of throwing
   //    before React can emit markup at all.
  const previousWindow = (globalThis as Record<string, unknown>)["window"];
   let reloadCalls = 0;
   Object.defineProperty(globalThis, "window", {
     configurable: true,
      value: { location: { reload() { reloadCalls += 1; } } },
    });

  let html = "";
   try {
    html = renderToStaticMarkup(
       <VenlyProvider finance={client} queryClient={queryClient}>
        <ReceiveBlock accountId={ACCOUNT_ID} />
      </VenlyProvider>,
     );
   } finally {
    Object.defineProperty(globalThis, "window", {
            configurable: true,
            value: previousWindow,
         });
    }

   assert.equal(
     reloadCalls,
      0,
     "no full page reload was requested while rendering the refreshed surface",
   );
   assert.ok(html.length > 0, "the surface rendered real markup (it did not unmount)");

    // The new details — including their payment reference — are on screen:
  const refLabel = html.indexOf("Payment reference");
  assert.ok(refLabel > 0, "the payment-reference label is rendered");
   assert.ok(
    html.indexOf(created.referenceCode!) > refLabel,
      `the new reference ${created.referenceCode} renders with its details`,
   );

    // And the provision form is gone from that same surface.
  assert.doesNotMatch(html, /Set up bank details/, "the provision form yielded to the details");
});
