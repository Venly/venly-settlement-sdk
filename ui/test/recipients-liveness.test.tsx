import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient } from "@tanstack/react-query";
import { FundflowClient, VenlyFinanceClient } from "@venlyfinance/sdk";
import { VenlyProvider, venlyQueries, type VenlyClients } from "@venlyfinance/react";
import { RecipientsView } from "../registry/blocks/recipients.js";

// The staleness class the browser gate exists for: an operator driver flips
// a beneficiary account to ACTIVE, and the recipients surface must render
// it. That chain is event -> cache invalidation -> refetch -> fresh render;
// it breaks silently if the mock mutates without emitting. This test runs
// the whole chain at the component level: render the route section, advance
// via the driver, assert the ACTIVE state appears.

const ACCOUNT = "a10c2d31-2222-4b20-8c63-000000000001";

test("recipients surface: a driver advance reaches the rendered route section", async () => {
  const finance = new VenlyFinanceClient({ environment: "mock" });
  const fundflow = new FundflowClient({ environment: "mock" });
  const clients: VenlyClients = { environment: "mock", finance, fundflow };
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 5_000 } },
  });

  // The reference bridge, verbatim: every mock event invalidates the cache.
  const unsubscribe = finance.mock!.simulations.events.subscribe(() => {
    void queryClient.invalidateQueries();
  });

  // Build a saved recipient through the real operations.
  const party = await finance.parties.create({ partyType: "ORGANISATION", name: "Meridian Logistics" });
  await finance.accounts.addPartyRole(ACCOUNT, { partyId: party.id!, roleType: "PAYOUT_RECIPIENT" });
  const bankAccount = await finance.payoutBankAccounts.register(party.id!, {
    rail: "SEPA",
    fiatCurrency: "EUR",
    label: "Meridian EUR settlement",
    accountHolderName: "Meridian Logistics B.V.",
    bankName: "Example Bank N.V.",
    railDetails: { iban: "BE71096123456769" },
  });
  assert.equal(bankAccount.status, "PENDING");

  // Prime the cache with everything the view reads, then render.
  const prefetch = () =>
    Promise.all([
      queryClient.prefetchQuery(venlyQueries.partyRoles(clients, ACCOUNT)),
      queryClient.prefetchQuery(venlyQueries.payoutRoutes(clients, ACCOUNT)),
      queryClient.prefetchQuery(venlyQueries.party(clients, party.id!)),
      queryClient.prefetchQuery(venlyQueries.payoutBankAccounts(clients, party.id!)),
      queryClient.prefetchQuery(venlyQueries.accountSupportedAssets(clients, ACCOUNT)),
    ]);
  await prefetch();

  const render = () =>
    renderToStaticMarkup(
      <VenlyProvider finance={finance} fundflow={fundflow} queryClient={queryClient}>
        <RecipientsView accountId={ACCOUNT} />
      </VenlyProvider>,
    );

  const before = render();
  assert.match(before, /Meridian EUR settlement/);
  assert.match(before, /In review/, "a fresh beneficiary account renders its PENDING state");
  assert.match(
    before,
    /In review – routes can use this account once it(?:'|&#x27;)s active\./,
    "route creation is disabled with the reason while the account is PENDING",
  );

  // The operator driver flips it. Without the emitted event, the bridge
  // never fires and the surface below would keep rendering "In review".
  finance.mock!.simulations.payoutBankAccount.advance(bankAccount.id!, "ACTIVE");

  const state = queryClient.getQueryState(
    venlyQueries.payoutBankAccounts(clients, party.id!).queryKey,
  );
  assert.equal(state?.isInvalidated, true, "the event invalidated the bank-accounts read");

  // The refetch a mounted app performs on invalidation; static markup cannot
  // run the background loop, so it is awaited explicitly here.
  await queryClient.refetchQueries();

  const after = render();
  assert.match(after, /Active/, "the driven ACTIVE state renders");
  assert.doesNotMatch(after, /In review/, "the stale PENDING state is gone");
  assert.doesNotMatch(
    after,
    /routes can use this account once it(?:'|&#x27;)s active/,
    "route creation is no longer disabled",
  );

  unsubscribe();
});
