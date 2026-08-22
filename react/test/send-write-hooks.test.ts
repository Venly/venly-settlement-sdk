import { test } from "node:test";
import assert from "node:assert/strict";
import { StagedTransferController } from "../src/flows/staged-transfer.js";
import { mockClients, waitFor } from "./helpers.js";

// The one-key-per-staged-draft contract, proved end to end: the key is
// minted at staging time, every retry of the same staged draft carries the
// same key, and the API answers a replay with the ORIGINAL record instead
// of moving money twice.

test("fiat create: replaying the staged request returns the same record, not a second transfer", async () => {
  const clients = mockClients();
  const accounts = await clients.finance.accounts.list();
  const [sender, receiver] = accounts.items;
  assert.ok(sender?.id && receiver?.id);

  const controller = new StagedTransferController(clients, {
    pollIntervalMs: 5,
    maxPollMs: 4_000,
  });
  controller.stage({
    kind: "fiat",
    senderAccountId: sender.id,
    body: { receiverAccountId: receiver.id, currency: "EUR", amount: 321.5 },
  });
  const staged = controller.getSnapshot();
  assert.equal(staged.phase, "staged");
  const key = staged.phase === "staged" ? staged.staged.idempotencyKey : "";
  assert.ok(key.length > 10, "stage() pins a key");

  await controller.confirm();
  await waitFor(() => {
    const s = controller.getSnapshot();
    return s.phase === "completed" || s.phase === "pending" || s.phase === "failed";
  });
  const after = controller.getSnapshot();
  assert.notEqual(after.phase, "failed");
  const createdId = after.phase === "pending" || after.phase === "completed" ? after.transfer.id : "";
  assert.ok(createdId);

  // A retry of the SAME staged request (same key, same body - the network
  // flaked, the operator clicked again) must replay the original record.
  const replay = await clients.finance.transfers.createFiat(sender.id, {
    receiverAccountId: receiver.id,
    currency: "EUR",
    amount: 321.5,
    idempotencyKey: key,
  });
  assert.equal(replay.id, createdId, "replay returns the original transfer");

  const list = await clients.finance.transfers.list(sender.id, { size: 100 });
  const matches = (list.items ?? []).filter((t) => t.idempotencyKey === key);
  assert.equal(matches.length, 1, "one record under the key, never two");
  controller.dispose();
});

test("staging anew mints a new key; the same staged draft keeps its key", () => {
  const controller = new StagedTransferController(mockClients());
  const draft = {
    kind: "fiat" as const,
    senderAccountId: "a",
    body: { receiverAccountId: "b", currency: "EUR", amount: 10 },
  };
  controller.stage(draft);
  const s1 = controller.getSnapshot();
  const k1 = s1.phase === "staged" ? s1.staged.idempotencyKey : "";
  // Reading the snapshot again is the same staged draft - the key holds.
  const s2 = controller.getSnapshot();
  assert.equal(s2.phase === "staged" ? s2.staged.idempotencyKey : "", k1);
  // Editing discards the staged request; a fresh staging is a fresh draft.
  controller.edit();
  controller.stage(draft);
  const s3 = controller.getSnapshot();
  assert.notEqual(s3.phase === "staged" ? s3.staged.idempotencyKey : "", k1);
  controller.dispose();
});

test("payout request: one key per staged draft - replay returns the same payout", async () => {
  const clients = mockClients();
  const accounts = await clients.finance.accounts.list();
  // The seeded payouts account carries an ACTIVE route.
  let activeRouteId: string | undefined;
  let payoutAccountId: string | undefined;
  for (const account of accounts.items ?? []) {
    if (!account.id) continue;
    const routes = await clients.finance.payoutRoutes.list(account.id);
    const active = routes.find((r) => r.status === "ACTIVE");
    if (active?.id) {
      activeRouteId = active.id;
      payoutAccountId = account.id;
      break;
    }
  }
  assert.ok(activeRouteId && payoutAccountId, "seed data has an ACTIVE payout route");

  const key = crypto.randomUUID(); // minted once, at staging time
  const body = { payoutRouteId: activeRouteId, cryptoAmount: 41.75, idempotencyKey: key };
  const first = await clients.finance.payouts.request(payoutAccountId, body);
  const replay = await clients.finance.payouts.request(payoutAccountId, body);
  assert.ok(first.id);
  assert.equal(replay.id, first.id, "replay returns the original payout");

  const list = await clients.finance.payouts.list(payoutAccountId, { size: 100 });
  const created = (list.items ?? []).filter((p) => p.id === first.id);
  assert.equal(created.length, 1, "one payout row, never two");

  // The hold was applied once: the ledger still verifies.
  clients.finance.mock!.simulations.ledger.verify();
});
