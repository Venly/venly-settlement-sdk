import { test } from "node:test";
import assert from "node:assert/strict";
import {
  approvalCapabilities,
  interpretApprovalError,
} from "../src/flows/four-eyes.js";
import { mockClients } from "./helpers.js";

test("capabilities: only AWAITING_APPROVAL is decidable", () => {
  const awaiting = { status: "AWAITING_APPROVAL" as const, createdBy: "maker@acme.eu" };
  const open = approvalCapabilities(awaiting, "checker@acme.eu");
  assert.deepEqual(
    { canApprove: open.canApprove, canReject: open.canReject, canCancel: open.canCancel },
    { canApprove: true, canReject: true, canCancel: true },
  );

  for (const status of ["PROCESSING", "SUCCEEDED", "REJECTED"] as const) {
    const c = approvalCapabilities({ status, createdBy: "maker@acme.eu" }, "checker@acme.eu");
    assert.equal(c.canApprove, false, status);
    assert.equal(c.reason, "not-awaiting-approval");
  }
});

test("capabilities: the creator can cancel but never approve their own request", () => {
  const c = approvalCapabilities(
    { status: "AWAITING_APPROVAL", createdBy: "maker@acme.eu" },
    "maker@acme.eu",
  );
  assert.equal(c.canApprove, false);
  assert.equal(c.canReject, false);
  assert.equal(c.canCancel, true);
  assert.equal(c.reason, "actor-is-creator");
});

test("capabilities: unknown actor stays permissive; the API is the enforcer", () => {
  const c = approvalCapabilities({ status: "AWAITING_APPROVAL", createdBy: "maker@acme.eu" });
  assert.equal(c.canApprove, true);
});

test("interpretApprovalError maps real VenlyApiErrors from the mock", async () => {
  const { fundflow } = mockClients();
  const seeded = await fundflow.rampRequests.list();
  const awaiting = seeded.items.find((r) => r.status === "AWAITING_APPROVAL");
  assert.ok(awaiting?.id, "seed data has an AWAITING_APPROVAL request");

  fundflow.mock!.failNext("CONFLICT");
  const conflict = await fundflow.rampRequests
    .approve(awaiting!.id!, { version: 0 })
    .then(() => null)
    .catch((e) => e);
  assert.ok(conflict, "409 surfaced");
  assert.equal(interpretApprovalError(conflict), "stale-version");

  fundflow.mock!.failNext("FORBIDDEN");
  const forbidden = await fundflow.rampRequests
    .approve(awaiting!.id!, { version: 0 })
    .then(() => null)
    .catch((e) => e);
  assert.equal(interpretApprovalError(forbidden), "forbidden");

  assert.equal(interpretApprovalError(new Error("plain")), "unknown");
});

test("approve carries the version and the mock bumps it with the state", async () => {
  const { fundflow } = mockClients();
  const seeded = await fundflow.rampRequests.list();
  const listItem = seeded.items.find((r) => r.status === "AWAITING_APPROVAL");
  assert.ok(listItem?.id, "seed data has an AWAITING_APPROVAL request");

  // List items carry no optimistic-locking version; the detail read does.
  // That asymmetry is exactly why the flow must refetch before acting.
  const awaiting = await fundflow.rampRequests.get(listItem!.id!);
  assert.ok(typeof awaiting.version === "number", "detail carries a version");

  const updated = await fundflow.rampRequests.approve(awaiting.id!, {
    version: awaiting.version!,
  });
  assert.equal(updated.status, "AWAITING_FUNDS");
  assert.ok((updated.version ?? 0) > (awaiting.version ?? 0), "version bumped");

  const call = fundflow.mock!.calls.find((c) => c.path.endsWith("/approve"));
  assert.equal((call!.body as { version?: number }).version, awaiting.version);
});
