import { test } from "node:test";
import assert from "node:assert/strict";
import { describeRampStatus, type RampStatus } from "../src/flows/ramp-lifecycle.js";

const ALL: RampStatus[] = [
  "AWAITING_APPROVAL",
  "AWAITING_FUNDS",
  "PROCESSING",
  "SUCCEEDED",
  "FAILED",
  "BLOCKED",
  "DENIED",
  "REJECTED",
  "CANCELLED",
];

test("every API status has a descriptor with label and explanation", () => {
  for (const status of ALL) {
    const d = describeRampStatus(status);
    assert.equal(d.status, status);
    assert.ok(d.label.length > 0, `${status} label`);
    assert.ok(d.explanation.length > 10, `${status} explanation`);
  }
});

test("terminal states are exactly the settled ones and carry an outcome", () => {
  const terminal = ALL.filter((s) => describeRampStatus(s).isTerminal);
  assert.deepEqual(terminal.sort(), ["CANCELLED", "DENIED", "FAILED", "REJECTED", "SUCCEEDED"]);
  for (const status of terminal) {
    const d = describeRampStatus(status);
    assert.equal(d.phase, "terminal");
    assert.ok(d.outcome, `${status} outcome`);
    assert.equal(d.waitingOn, null);
    assert.equal(d.canApprove, false);
    assert.equal(d.canCancel, false);
  }
});

test("only AWAITING_APPROVAL allows approval, and it names the approver as blocker", () => {
  for (const status of ALL) {
    const d = describeRampStatus(status);
    assert.equal(d.canApprove, status === "AWAITING_APPROVAL", status);
  }
  assert.equal(describeRampStatus("AWAITING_APPROVAL").waitingOn, "approver");
  assert.equal(describeRampStatus("AWAITING_APPROVAL").phase, "action-required");
});

test("waiting-for-funds is cancellable and explicitly not blocked on the reader", () => {
  const d = describeRampStatus("AWAITING_FUNDS");
  assert.equal(d.canCancel, true);
  assert.equal(d.waitingOn, "counterparty-funds");
  assert.match(d.explanation, /nothing is blocked on you/i);
});

test("in-flight processing offers no actions", () => {
  const d = describeRampStatus("PROCESSING");
  assert.equal(d.canCancel, false);
  assert.equal(d.canApprove, false);
  assert.equal(d.phase, "in-flight");
});

test("intent is never positive for non-succeeded states", () => {
  for (const status of ALL) {
    const d = describeRampStatus(status);
    if (status !== "SUCCEEDED") assert.notEqual(d.intent, "positive", status);
  }
});

test("unknown or missing status degrades to a safe descriptor", () => {
  const d = describeRampStatus(undefined);
  assert.equal(d.status, "UNKNOWN");
  assert.equal(d.canApprove, false);
  assert.equal(d.canCancel, false);
  assert.equal(d.isTerminal, false);
});
