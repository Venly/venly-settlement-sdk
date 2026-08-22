import test from "node:test";
import assert from "node:assert/strict";
import { FundflowClient, VenlyApiError } from "../dist/esm/index.js";

const mockFundflow = () => new FundflowClient({ environment: "mock" });

const AWAITING_APPROVAL = "123e4567-e89b-12d3-a456-426614174000";
const AWAITING_FUNDS = "123e4567-e89b-12d3-a456-426614174001";
const SUCCEEDED = "123e4567-e89b-12d3-a456-426614174002";
const VERIFIED_BANK = "ba000001-0000-4000-8000-000000000001";
const VERIFIED_WALLET = "cw000001-0000-4000-8000-000000000001";
const PENDING_WALLET = "cw000001-0000-4000-8000-000000000002";
const EUR = "fc000001-0000-4000-8000-000000000001";
const USDC = "cc000001-0000-4000-8000-000000000001";

const rejects = (fn, status, codeOrMatch) =>
  assert.rejects(fn, (err) => {
    assert.ok(err instanceof VenlyApiError, `expected VenlyApiError, got ${err}`);
    assert.equal(err.status, status);
    if (codeOrMatch instanceof RegExp) assert.match(err.errors[0].message, codeOrMatch);
    else assert.equal(err.errors[0].code, codeOrMatch);
    return true;
  });

test("ramp lifecycle: stale version is a 409 OPTIMISTIC_LOCK_EXCEPTION, fresh version proceeds", async () => {
  const ff = mockFundflow();
  const before = await ff.rampRequests.get(AWAITING_APPROVAL);
  await rejects(
    () => ff.rampRequests.approve(AWAITING_APPROVAL, { version: before.version + 7 }),
    409,
    "OPTIMISTIC_LOCK_EXCEPTION",
  );
  const approved = await ff.rampRequests.approve(AWAITING_APPROVAL, { version: before.version });
  assert.equal(approved.status, "AWAITING_FUNDS");
  assert.equal(approved.version, before.version + 1);
  assert.ok(
    approved.events.some((e) => e.eventType === "APPROVED"),
    "the decision lands in the event history",
  );
});

test("ramp lifecycle: decisions are legal only from AWAITING_APPROVAL", async () => {
  const ff = mockFundflow();
  // Approving twice: the second attempt is an illegal transition, not an echo.
  const first = await ff.rampRequests.get(AWAITING_APPROVAL);
  const approved = await ff.rampRequests.approve(AWAITING_APPROVAL, { version: first.version });
  await rejects(
    () => ff.rampRequests.approve(AWAITING_APPROVAL, { version: approved.version }),
    400,
    /Only AWAITING_APPROVAL/,
  );
  // Cancelling after approval is equally illegal.
  await rejects(
    () => ff.rampRequests.cancel(AWAITING_APPROVAL, { version: approved.version }),
    400,
    /Only AWAITING_APPROVAL/,
  );
  // A terminal request cannot be decided at all.
  const done = await ff.rampRequests.get(SUCCEEDED);
  await rejects(
    () => ff.rampRequests.reject(SUCCEEDED, { version: done.version }),
    400,
    /Only AWAITING_APPROVAL/,
  );
});

test("ramp lifecycle: amount edits only while awaiting approval, and the other side recomputes", async () => {
  const ff = mockFundflow();
  const before = await ff.rampRequests.get(AWAITING_APPROVAL);
  const edited = await ff.rampRequests.setAmount(AWAITING_APPROVAL, {
    version: before.version,
    amount: 2000,
  });
  assert.equal(edited.fiatAmount, 2000);
  assert.equal(edited.fiatFeeAmount, 20, "fee recomputes from the tier percentage");
  // ON_RAMP recomputes the crypto side from the NET fiat at the captured
  // rate (0.92 EUR per USDC): 1,980 / 0.92 - never a parity echo.
  assert.equal(edited.cryptoAmount, 2152.173913, "outgoing side recomputes at the pair rate");
  const amountEvent = edited.events.find((e) => e.eventType === "AMOUNT_CHANGED");
  assert.ok(amountEvent, "AMOUNT_CHANGED event recorded");
  assert.equal(amountEvent.metadata.previousAmount, 920);
  assert.equal(amountEvent.metadata.newAmount, 2000);
  // Not editable once approved.
  const approved = await ff.rampRequests.approve(AWAITING_APPROVAL, { version: edited.version });
  await rejects(
    () => ff.rampRequests.setAmount(AWAITING_APPROVAL, { version: approved.version, amount: 5 }),
    400,
    /AWAITING_APPROVAL/,
  );
});

test("off-ramp: full walk create → approve → tx-hash leg → PROCESSING → SUCCEEDED", async () => {
  const ff = mockFundflow();
  const created = await ff.rampRequests.create({
    rampType: "OFF_RAMP",
    amount: 300,
    fiatCurrencyId: EUR,
    cryptoCurrencyId: USDC,
    companyBankAccountId: VERIFIED_BANK,
  });
  assert.equal(created.status, "AWAITING_APPROVAL");
  assert.equal(created.version, 0);
  assert.ok(created.paymentReference, "payment reference minted");
  assert.ok(created.depositWallet?.address, "off-ramp carries the deposit-wallet instructions");
  assert.ok(created.companyBankAccount, "destination bank account attached");

  const approved = await ff.rampRequests.approve(created.id, { version: 0 });
  assert.equal(approved.status, "AWAITING_FUNDS");

  const initiated = await ff.rampRequests.initiate(created.id, {
    version: approved.version,
    blockchainTransactionHash: "0x" + "ab".repeat(32),
  });
  assert.equal(initiated.status, "PROCESSING", "initiate reports the crypto leg and advances");
  assert.ok(initiated.events.some((e) => e.eventType === "TX_HASH_ADDED"));

  ff.mock.advanceRamp(created.id, "SUCCEEDED");
  const done = await ff.rampRequests.get(created.id);
  assert.equal(done.status, "SUCCEEDED");
  assert.ok(done.events.some((e) => e.eventType === "COMPLETED"));
});

test("off-ramp: creation refuses an unverified or unknown destination", async () => {
  const ff = mockFundflow();
  // Whitelist a new bank account: it starts PENDING and cannot be a destination.
  const pending = await ff.bankAccounts.create({
    name: "New EUR",
    bankName: "Mock Bank AG",
    companyName: "Acme Corporation B.V.",
    bankCountry: "DE",
    beneficiaryAddressLine1: "Keizersgracht 1",
    beneficiaryCity: "Amsterdam",
    beneficiaryPostalCode: "1015 CC",
    beneficiaryCountry: "NL",
    supportedRampType: "OFF_RAMP",
    bankAccountType: "EUR_SEPA",
    iban: "NL91ABNA0417164300",
  });
  assert.equal(pending.verificationStatus, "PENDING");
  const offRamp = (id) =>
    ff.rampRequests.create({
      rampType: "OFF_RAMP",
      amount: 100,
      fiatCurrencyId: EUR,
      cryptoCurrencyId: USDC,
      companyBankAccountId: id,
    });
  await rejects(() => offRamp(pending.id), 400, /not VERIFIED/);
  // The whitelisting review completes (driver) and the same account works.
  ff.mock.advanceBankAccountVerification(pending.id);
  const created = await offRamp(pending.id);
  assert.equal(created.status, "AWAITING_APPROVAL");
});

test("on-ramp: PAYMENT_RECEIVED driver moves AWAITING_FUNDS → PROCESSING", async () => {
  const ff = mockFundflow();
  ff.mock.advanceRamp(AWAITING_FUNDS, "PAYMENT_RECEIVED");
  const processing = await ff.rampRequests.get(AWAITING_FUNDS);
  assert.equal(processing.status, "PROCESSING");
  assert.equal(processing.paymentReceived, true);
  assert.ok(processing.events.some((e) => e.eventType === "PAYMENT_RECEIVED"));
  // The driver enforces its own preconditions too.
  assert.throws(() => ff.mock.advanceRamp(AWAITING_FUNDS, "PAYMENT_RECEIVED"), /AWAITING_FUNDS/);
});

test("bank accounts: whitelisting lifecycle persists across list/get, update carries the lock", async () => {
  const ff = mockFundflow();
  const page = await ff.bankAccounts.list();
  assert.equal(page.items.length, 2, "seeded accounts");
  const pendingOnly = await ff.bankAccounts.list({ verificationStatus: "PENDING" });
  assert.equal(pendingOnly.items.length, 1);

  const account = await ff.bankAccounts.get(VERIFIED_BANK);
  await rejects(
    () => ff.bankAccounts.update(VERIFIED_BANK, { version: account.version + 5, name: "X" }),
    409,
    "OPTIMISTIC_LOCK_EXCEPTION",
  );
  const renamed = await ff.bankAccounts.update(VERIFIED_BANK, {
    version: account.version,
    name: "Treasury EUR",
  });
  assert.equal(renamed.name, "Treasury EUR");
  assert.equal(renamed.version, account.version + 1);
});

test("company wallets: create starts PENDING; ownership-proof driver verifies; on-ramp gates on it", async () => {
  const ff = mockFundflow();
  const onRamp = (walletId) =>
    ff.rampRequests.create({
      rampType: "ON_RAMP",
      amount: 100,
      fiatCurrencyId: EUR,
      cryptoCurrencyId: USDC,
      companyWalletId: walletId,
    });
  await rejects(() => onRamp(PENDING_WALLET), 400, /not VERIFIED/);
  ff.mock.advanceCompanyWalletVerification(PENDING_WALLET);
  const created = await onRamp(PENDING_WALLET);
  assert.equal(created.status, "AWAITING_APPROVAL");
  assert.ok(created.depositBankAccount, "on-ramp carries the wire-in instructions");
  assert.equal(created.fiatFeeAmount, 1, "1% tier fee on 100");
  // Verified treasury wallet works out of the box.
  const treasury = await onRamp(VERIFIED_WALLET);
  assert.ok(treasury.id !== created.id);
});

test("reference data: deposit wallets, config, and by-id currency lookups answer in mock mode", async () => {
  const ff = mockFundflow();
  const wallets = await ff.referenceData.depositWallets();
  assert.ok(wallets.length > 0 && wallets[0].address.startsWith("0x"));
  const config = await ff.referenceData.bankAccountConfig();
  assert.ok(config.enabledAccountTypes.some((t) => t.type === "EUR_SEPA"));
  const eur = await ff.referenceData.fiatCurrency(EUR);
  assert.equal(eur.currency, "EUR");
  const usdc = await ff.referenceData.cryptoCurrency(USDC);
  assert.equal(usdc.currency, "USDC");
});

test("exchange rates: never parity, and every seed reconciles against its pair rate", async () => {
  const ff = mockFundflow();
  const page = await ff.rampRequests.list();
  for (const item of page.items) {
    const detail = await ff.rampRequests.get(item.id);
    assert.notEqual(detail.exchangeRate, 1, `${item.paymentReference}: a parity rate hides the crypto-vs-fiat unit distinction`);
    // Gross fiat relates to crypto through the rate, per ramp direction.
    const gross =
      detail.rampType === "OFF_RAMP"
        ? detail.cryptoAmount * detail.exchangeRate
        : detail.fiatAmount;
    assert.ok(Math.abs(detail.fiatAmount - gross) < 0.005, `${item.paymentReference}: fiat = crypto x rate`);
    if (detail.rampType === "ON_RAMP") {
      assert.ok(
        Math.abs(detail.cryptoAmount - detail.fiatNetAmount / detail.exchangeRate) < 0.000005,
        `${item.paymentReference}: crypto = net fiat / rate`,
      );
    }
    // The fiat ladder itemises: gross - fee = net.
    assert.ok(
      Math.abs(detail.fiatAmount - detail.fiatFeeAmount - detail.fiatNetAmount) < 0.005,
      `${item.paymentReference}: fiat - fee = net`,
    );
  }
});

test("exchange rates: created ramps convert at the pair rate, both directions", async () => {
  const ff = mockFundflow();
  const EUR_ID = "fc000001-0000-4000-8000-000000000001";
  const USDC_ID = "cc000001-0000-4000-8000-000000000001";
  // OFF_RAMP: amount is the crypto side; the fiat side converts at 0.92.
  const off = await ff.rampRequests.create({
    rampType: "OFF_RAMP",
    amount: 1000,
    fiatCurrencyId: EUR_ID,
    cryptoCurrencyId: USDC_ID,
    companyBankAccountId: "ba000001-0000-4000-8000-000000000001",
  });
  assert.equal(off.cryptoAmount, 1000);
  assert.equal(off.exchangeRate, 0.92);
  assert.equal(off.fiatAmount, 920, "1,000 USDC is NOT €1,000");
  assert.equal(off.fiatFeeAmount, 9.2);
  assert.equal(off.fiatNetAmount, 910.8);
  // ON_RAMP: amount is the fiat side; net fiat buys crypto at the rate.
  const on = await ff.rampRequests.create({
    rampType: "ON_RAMP",
    amount: 920,
    fiatCurrencyId: EUR_ID,
    cryptoCurrencyId: USDC_ID,
    companyWalletId: "cw000001-0000-4000-8000-000000000001",
  });
  assert.equal(on.fiatAmount, 920);
  assert.equal(on.fiatFeeAmount, 9.2);
  assert.equal(on.fiatNetAmount, 910.8);
  assert.equal(on.cryptoAmount, 990, "910.80 EUR net buys 990 USDC at 0.92");
});

test("reset restores the seeds after mutations", async () => {
  const ff = mockFundflow();
  await ff.rampRequests.approve(AWAITING_APPROVAL, { version: 0 });
  ff.mock.reset();
  const back = await ff.rampRequests.get(AWAITING_APPROVAL);
  assert.equal(back.status, "AWAITING_APPROVAL");
  assert.equal(back.version, 0);
  assert.equal(ff.mock.calls.length, 1, "call log cleared too");
});

test("setActor: events and createdBy stamp the session identity; reset keeps the actor", async () => {
  const ff = mockFundflow();
  ff.mock.setActor({ username: "treasury", email: "treasury@acme.eu", role: "COMPANY_MANAGER" });

  const created = await ff.rampRequests.create({
    rampType: "OFF_RAMP",
    amount: 120,
    fiatCurrencyId: EUR,
    cryptoCurrencyId: USDC,
    companyBankAccountId: VERIFIED_BANK,
  });
  const createdEvent = created.events.find((e) => e.eventType === "CREATED");
  assert.equal(createdEvent?.username, "treasury");
  assert.equal(createdEvent?.email, "treasury@acme.eu");
  assert.equal(createdEvent?.role, "COMPANY_MANAGER");

  const rows = await ff.rampRequests.list();
  const row = rows.items.find((r) => r.id === created.id);
  assert.equal(row?.createdBy, "treasury@acme.eu", "the own-request join sees the session user");

  // Session identity, not world state: reseeding does not sign anyone out.
  ff.mock.reset();
  const afterReset = await ff.rampRequests.create({
    rampType: "OFF_RAMP",
    amount: 55,
    fiatCurrencyId: EUR,
    cryptoCurrencyId: USDC,
    companyBankAccountId: VERIFIED_BANK,
  });
  assert.equal(
    afterReset.events.find((e) => e.eventType === "CREATED")?.email,
    "treasury@acme.eu",
  );

  // Omitted fields fall back to the defaults; seeds keep their own stamps.
  ff.mock.setActor({ email: "ops@acme.eu" });
  const partial = await ff.rampRequests.create({
    rampType: "OFF_RAMP",
    amount: 10,
    fiatCurrencyId: EUR,
    cryptoCurrencyId: USDC,
    companyBankAccountId: VERIFIED_BANK,
  });
  const partialEvent = partial.events.find((e) => e.eventType === "CREATED");
  assert.equal(partialEvent?.email, "ops@acme.eu");
  assert.equal(partialEvent?.username, "mock-user");
});
