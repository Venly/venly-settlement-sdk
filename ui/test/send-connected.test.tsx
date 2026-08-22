import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { VenlyProvider } from "@venlyfinance/react";
import {
  ConnectedPayoutDetail,
  ConnectedTransferDetail,
  PayoutSendFlow,
  PlatformTransferFlow,
  SendDoor,
} from "../registry/blocks/send.js";
import { RecipientsView } from "../registry/blocks/recipients.js";

// First-paint smoke for the connected pieces: mounted under the provider,
// every surface renders its loading state without crashing - the joins
// (useQueries over roles/parties/bank accounts) must be mount-safe.

const ACCOUNT = "a10c2d31-2222-4b20-8c63-000000000001";
const verifier = { verifyTotp: async () => ({ status: "ok" as const }) };

function mount(children: React.ReactNode): string {
  return renderToStaticMarkup(<VenlyProvider environment="mock">{children}</VenlyProvider>);
}

test("door: first paint renders the three classes and both recents panes", () => {
  const html = mount(
    <SendDoor
      accountId={ACCOUNT}
      platformName="Acme Pay"
      directory={{ entries: [], isPending: true }}
      savedRecipients={{ rows: [], isPending: true }}
      onPickPerson={() => undefined}
      onPickRecipient={() => undefined}
      onGoToWithdraw={() => undefined}
    />,
  );
  assert.match(html, /People on Acme Pay/);
  assert.match(html, /Saved recipients/);
  assert.match(html, /Your own bank account/);
  assert.match(html, /Recent transfers/);
  assert.match(html, /Recent payouts/);
});

test("platform transfer flow mounts on the directory pick", () => {
  const html = mount(
    <PlatformTransferFlow senderAccountId={ACCOUNT} platformName="Acme Pay" verifier={verifier} />,
  );
  assert.match(html, /Loading people…/);
});

test("payout send flow mounts; no usable recipient blocks the start with the CTA", () => {
  const html = mount(
    <PayoutSendFlow
      accountId={ACCOUNT}
      recipients={{ rows: [] }}
      verifier={verifier}
      onGoToRecipients={() => undefined}
    />,
  );
  assert.match(html, /No saved recipients\. Add a recipient to pay a bank account\./);
  assert.match(html, /Add a recipient/);
});

test("connected details mount on their loading states, never an empty detail", () => {
  assert.match(mount(<ConnectedTransferDetail accountId={ACCOUNT} transferId="t-1" />), /Loading transfer…/);
  assert.match(mount(<ConnectedPayoutDetail accountId={ACCOUNT} payoutId="p-1" />), /Loading payout…/);
});

test("recipients view mounts on its loading state", () => {
  assert.match(mount(<RecipientsView accountId={ACCOUNT} />), /Loading recipients…/);
});
