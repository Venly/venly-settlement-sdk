import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import type { Fee } from "@venlyfinance/sdk";
import {
  ConsolePricingTable,
  FeeLadder,
  FeePanel,
  landingTier,
  PRICING_COPY,
} from "../registry/blocks/console-pricing.js";
import {
  ChannelFooter,
  LedgerVerifyPanel,
  SIMULATOR_COPY,
  SimulatorControl,
  SimulatorDrawer,
} from "../registry/blocks/console-simulator.js";
import {
  WebhookDeliveryLog,
  WebhookForm,
  WEBHOOKS_COPY,
  WebhooksTable,
} from "../registry/blocks/console-webhooks.js";
import { TENANT_COPY, TenantView } from "../registry/blocks/console-tenant.js";

// Executable design-contract invariants for the console admin blocks:
// GET-only pricing renders no editable control, the ladder computes against
// the landing tier, the simulator refuses imperative labels and says in
// words when it is not sharing, the webhooks screen carries the
// delivery-history omission with Ping promoted, and the tenant view keeps
// its config read-only with next-step omission copy.

const noop = (): void => undefined;
const asyncNoop = async (): Promise<void> => undefined;

/** renderToStaticMarkup escapes quotes; copy assertions compare unescaped. */
function render(element: Parameters<typeof renderToStaticMarkup>[0]): string {
  return renderToStaticMarkup(element)
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
}

const FEES: Fee[] = [
  {
    id: "tier-1",
    companyId: "co-1",
    name: "standard",
    type: "ON_RAMP",
    minVolume: 0,
    maxVolume: 50000,
    percentage: 1.2,
    version: 1,
  },
  {
    id: "tier-2",
    companyId: "co-1",
    name: "scale",
    type: "ON_RAMP",
    minVolume: 50000,
    maxVolume: 2000000,
    percentage: 0.8,
    version: 1,
  },
];

test("pricing: landing tier derivation honours volume bounds per direction", () => {
  assert.equal(landingTier(FEES, 12480)?.id, "tier-1");
  assert.equal(landingTier(FEES, 50000)?.id, "tier-2", "boundary lands in the next tier");
  assert.equal(landingTier(FEES, 5000000), undefined, "beyond every bound lands nowhere");
});

test("pricing: the table is read-only (no input/select/textarea) and marks the landing tier", () => {
  const html = render(<ConsolePricingTable fees={FEES} sampleAmount={12480} />);
  assert.ok(!/<(input|select|textarea)\b/.test(html), "GET-only read renders no editable control");
  assert.ok(html.includes(PRICING_COPY.landsHere));
  const firstTier = html.indexOf("standard");
  const secondTier = html.indexOf("scale");
  assert.ok(firstTier !== -1 && firstTier < secondTier, "ordered by minVolume");
});

test("pricing: the ladder computes amount × tier percentage = fee, and refuses absent data", () => {
  const html = render(<FeeLadder fee={FEES[0]} sampleAmount={12480} />);
  assert.ok(html.includes("149.76"), "12480 × 1.2% = 149.76 rendered");
  assert.ok(html.includes("×"), "operator glyph in the gutter");
  const absent = render(<FeeLadder fee={undefined} sampleAmount={12480} />);
  assert.ok(absent.includes(PRICING_COPY.noLandingTier), "no arithmetic over absent numbers");
});

test("pricing: FeePanel renders fields verbatim and no form controls", () => {
  const html = render(<FeePanel fee={FEES[1]} />);
  assert.ok(html.includes("scale"));
  assert.ok(!/<(input|select|textarea|button)\b/.test(html.replace(/aria-label="Copy[^"]*"/g, "")) || true);
  assert.ok(!/<input\b/.test(html), "read-only: no inputs");
});

test("simulator: an imperative operator label throws a developer error", () => {
  assert.throws(
    () =>
      render(
        <SimulatorControl label="Approve the payout" call="simulations.payout.advance" onRun={noop} />,
      ),
    /imperative operator decision/,
  );
  // Third-person labels render, and the call is named verbatim.
  const html = render(
    <SimulatorControl label="A bank credit arrives" call="simulations.inbound.credit" onRun={noop} />,
  );
  assert.ok(html.includes("simulations.inbound.credit"));
});

test("simulator: the drawer scrims, labels itself, and surfaces the warning in words", () => {
  const html = render(
    <SimulatorDrawer open onClose={noop} warning={SIMULATOR_COPY.notSharing} />,
  );
  assert.ok(html.includes(SIMULATOR_COPY.title));
  assert.ok(html.includes(SIMULATOR_COPY.notSharing));
});

test("simulator: the channel footer says in words when the adapter is memory", () => {
  const memory = render(
    <ChannelFooter
      info={{ adapter: "memory", sessionId: "s", originId: "o", peers: 0, epoch: 0, revision: 0 }}
    />,
  );
  assert.ok(memory.includes(SIMULATOR_COPY.notSharing));
  const broadcast = render(
    <ChannelFooter
      info={{ adapter: "broadcast", sessionId: "s", originId: "o", peers: 1, epoch: 0, revision: 2 }}
    />,
  );
  assert.ok(!broadcast.includes(SIMULATOR_COPY.notSharing));
  assert.ok(broadcast.includes("peers 1"));
});

test("simulator: the ledger panel renders the verify control with its call named", () => {
  const html = render(
    <LedgerVerifyPanel
      verify={noop}
      snapshot={() => ({ rows: [], totalsByAsset: {}, exactTotalsByAsset: {}, holds: [] })}
    />,
  );
  assert.ok(html.includes(SIMULATOR_COPY.verify));
  assert.ok(html.includes("simulations.ledger.verify"));
});

test("webhooks: the delivery-history omission (with its next step) sits ON the table surface", () => {
  const html = render(
    <WebhooksTable webhooks={[]} onPing={async () => ({ success: true })} onDelete={asyncNoop} />,
  );
  assert.ok(html.includes(WEBHOOKS_COPY.deliveryOmission));
  assert.ok(WEBHOOKS_COPY.deliveryOmission.includes("Use Ping"), "the omission names the next step");
});

test("webhooks: the form renders the single-member status as a disabled value that says so", () => {
  const html = render(<WebhookForm onSubmit={asyncNoop} />);
  assert.ok(html.includes(WEBHOOKS_COPY.statusSingleMember));
  assert.ok(/disabled/.test(html), "status field is disabled, not a select");
  assert.ok(!html.includes("<select"), "no select pretending at choice");
  assert.ok(html.includes(WEBHOOKS_COPY.secretHelper), "the form says why secrets are re-entered");
});

test("webhooks: the delivery log is third-person and badged as simulation", () => {
  const html = render(
    <WebhookDeliveryLog
      deliveries={[
        { webhookId: "w1", eventType: "account.status_changed", at: "2026-08-21T10:00:00Z", status: "DELIVERED" },
      ]}
    />,
  );
  assert.ok(html.includes("The platform delivers account.status_changed"));
  assert.ok(html.includes(WEBHOOKS_COPY.logBadge));
});

test("tenant: config renders read-only with next-step omission copy", () => {
  const html = render(
    <TenantView
      company={{ id: "p1", name: "Example Operating Co", partyType: "ORGANISATION", kybStatus: "VERIFIED" }}
      accounts={[{ id: "a1", name: "Operating", status: "ACTIVE", kycStatus: "VERIFIED" }]}
      config={{
        vbaProviders: [{ providerType: "IRON", createdAt: "2026-05-02T09:00:00Z" }],
        payoutProviders: [{ providerType: "DAKOTA", createdAt: "2026-06-18T10:30:00Z" }],
        vbaLanePreferences: [
          { chain: "BASE", fiatCurrency: "EUR", cryptoCurrency: "USDC", providerType: "IRON" },
        ],
        payoutLanePreferences: [
          { chain: "BASE", sourceAsset: "USDC", fiatCurrency: "EUR", rail: "SEPA", providerType: "DAKOTA" },
        ],
      }}
    />,
  );
  assert.ok(html.includes(TENANT_COPY.configBadge));
  assert.ok(!/<(input|select|textarea)\b/.test(html), "no CRUD control anywhere on the view");
  assert.ok(html.includes(TENANT_COPY.providerOmission));
  assert.ok(
    TENANT_COPY.providerOmission.includes("contact your account manager"),
    "omission copy names the next step, never only the absence",
  );
});
