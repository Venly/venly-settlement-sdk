import { test } from "node:test";
import assert from "node:assert/strict";
import {
  StagedTransferController,
  validateDraft,
  type TransferDraft,
} from "../src/flows/staged-transfer.js";
import { mockClients, waitFor } from "./helpers.js";
import type { VenlyClients } from "../src/provider.js";

function fiatDraft(
  overrides?: Partial<{ senderAccountId: string; amount: number }>,
): TransferDraft {
  return {
    kind: "fiat",
    senderAccountId: overrides?.senderAccountId ?? "acc-1",
    body: {
      receiverAccountId: "acc-2",
      currency: "EUR",
      amount: overrides?.amount ?? 250,
      description: "test payout",
    },
  };
}

/** The mock store enforces referential integrity: sender must exist. */
async function seededDraft(clients: VenlyClients): Promise<TransferDraft> {
  const accounts = await clients.finance.accounts.list();
  const [sender, receiver] = accounts.items;
  return {
    kind: "fiat",
    senderAccountId: sender!.id!,
    body: {
      receiverAccountId: receiver?.id ?? sender!.id!,
      currency: "EUR",
      amount: 250,
      description: "test payout",
    },
  };
}

test("validateDraft flags missing account and non-positive amounts", () => {
  assert.deepEqual(validateDraft(fiatDraft()), []);
  assert.ok(validateDraft(fiatDraft({ senderAccountId: "" })).length > 0);
  assert.ok(validateDraft(fiatDraft({ amount: 0 })).length > 0);
  assert.ok(validateDraft(fiatDraft({ amount: -5 })).length > 0);
});

test("stage() pins one idempotency key and edit() discards it", () => {
  const c = new StagedTransferController(mockClients());
  assert.equal(c.stage(fiatDraft()), true);
  const s1 = c.getSnapshot();
  assert.equal(s1.phase, "staged");
  const key1 = s1.phase === "staged" ? s1.staged.idempotencyKey : "";
  assert.ok(key1.length > 10);

  c.edit();
  assert.equal(c.getSnapshot().phase, "draft");
  c.stage(fiatDraft());
  const s2 = c.getSnapshot();
  const key2 = s2.phase === "staged" ? s2.staged.idempotencyKey : "";
  assert.notEqual(key1, key2, "a new staging gets a new key");
  c.dispose();
});

test("invalid draft never stages", () => {
  const c = new StagedTransferController(mockClients());
  assert.equal(c.stage(fiatDraft({ amount: 0 })), false);
  const s = c.getSnapshot();
  assert.equal(s.phase, "draft");
  assert.ok(s.phase === "draft" && s.issues.length > 0);
  c.dispose();
});

test("confirm() executes with the pinned key and polls to completed", async () => {
  const clients = mockClients();
  const c = new StagedTransferController(clients, { pollIntervalMs: 5, maxPollMs: 4_000 });
  c.stage(await seededDraft(clients));
  const staged = c.getSnapshot();
  const pinned = staged.phase === "staged" ? staged.staged.idempotencyKey : "";

  await c.confirm();
  const afterSubmit = c.getSnapshot();
  assert.ok(
    afterSubmit.phase === "pending" || afterSubmit.phase === "completed",
    `unexpected phase ${afterSubmit.phase}`,
  );

  // The create call carried exactly the pinned key.
  const createCall = clients.finance.mock!.calls.find((call) =>
    call.path.endsWith("/transfers/fiat"),
  );
  assert.ok(createCall, "create call recorded");
  assert.equal((createCall!.body as { idempotencyKey?: string }).idempotencyKey, pinned);

  if (afterSubmit.phase === "pending") {
    clients.finance.mock!.advanceTransfer(afterSubmit.transfer.id!, "COMPLETED");
    await waitFor(() => c.getSnapshot().phase === "completed");
  }
  const done = c.getSnapshot();
  assert.equal(done.phase, "completed");
  assert.equal(done.phase === "completed" && done.transfer.status, "COMPLETED");
  c.dispose();
});

test("a transfer that fails downstream lands in failed/transfer-failed", async () => {
  const clients = mockClients();
  const c = new StagedTransferController(clients, { pollIntervalMs: 5, maxPollMs: 4_000 });
  c.stage(await seededDraft(clients));
  await c.confirm();
  const s = c.getSnapshot();
  if (s.phase === "pending") {
    clients.finance.mock!.advanceTransfer(s.transfer.id!, "FAILED");
    await waitFor(() => c.getSnapshot().phase === "failed");
  }
  const done = c.getSnapshot();
  assert.equal(done.phase, "failed");
  assert.equal(done.phase === "failed" && done.reason, "transfer-failed");
  c.dispose();
});

test("a rejected submit lands in failed/submit-error with the API error attached", async () => {
  const clients = mockClients();
  clients.finance.mock!.failNext("VALIDATION_ERROR");
  const c = new StagedTransferController(clients, { pollIntervalMs: 5 });
  c.stage(fiatDraft());
  await c.confirm();
  const s = c.getSnapshot();
  assert.equal(s.phase, "failed");
  assert.equal(s.phase === "failed" && s.reason, "submit-error");
  assert.ok(s.phase === "failed" && s.error, "error object kept for rendering");
  c.dispose();
});

test("confirm() is a no-op unless staged (no double execution)", async () => {
  const clients = mockClients();
  const c = new StagedTransferController(clients, { pollIntervalMs: 5, maxPollMs: 4_000 });
  c.stage(await seededDraft(clients));
  await c.confirm();
  await c.confirm(); // second call: state is no longer "staged"
  const creates = clients.finance.mock!.calls.filter((call) =>
    call.path.endsWith("/transfers/fiat"),
  );
  assert.equal(creates.length, 1);
  c.dispose();
});
