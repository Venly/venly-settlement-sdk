import { useQuery } from "@tanstack/react-query";
import type { RampRequest } from "@venlyfinance/sdk";
import { useVenly } from "../provider.js";
import { venlyQueries } from "../query-options.js";

export type RampStatus = NonNullable<RampRequest["status"]>;

/**
 * A waiting state must answer four questions or it is an anxiety generator:
 * how long, on which channel, must I act, and what still works. This
 * descriptor encodes the answers per status so every surface renders the
 * same truth. The status field is the explanation field.
 */
export interface RampStatusDescriptor {
  status: RampStatus | "UNKNOWN";
  /** Coarse phase for layout decisions (queue grouping, timeline register). */
  phase: "action-required" | "waiting" | "in-flight" | "terminal";
  /** Who the request is waiting on; null when nobody (terminal states). */
  waitingOn: "approver" | "counterparty-funds" | "venly" | null;
  /** Terminal outcome, only when phase is "terminal". */
  outcome?: "succeeded" | "failed" | "declined" | "cancelled";
  /** Semantic intent for status pills. Rendered with a glyph AND a colour —
   * state is never carried by colour alone. */
  intent: "positive" | "negative" | "pending" | "neutral";
  canApprove: boolean;
  canCancel: boolean;
  canEditAmount: boolean;
  isTerminal: boolean;
  /** Short human label, sentence case. */
  label: string;
  /** One sentence: what is happening and whether the reader must act. */
  explanation: string;
}

const DESCRIPTORS: Record<RampStatus, Omit<RampStatusDescriptor, "status">> = {
  AWAITING_APPROVAL: {
    phase: "action-required",
    waitingOn: "approver",
    intent: "pending",
    canApprove: true,
    canCancel: true,
    canEditAmount: true,
    isTerminal: false,
    label: "Awaiting approval",
    explanation:
      "A second person must approve before anything moves; the creator cannot approve their own request.",
  },
  AWAITING_FUNDS: {
    phase: "waiting",
    waitingOn: "counterparty-funds",
    intent: "pending",
    canApprove: false,
    canCancel: true,
    canEditAmount: false,
    isTerminal: false,
    label: "Awaiting funds",
    explanation:
      "Approved and waiting for the incoming payment to arrive; nothing is blocked on you, and the request can still be cancelled.",
  },
  PROCESSING: {
    phase: "in-flight",
    waitingOn: "venly",
    intent: "pending",
    canApprove: false,
    canCancel: false,
    canEditAmount: false,
    isTerminal: false,
    label: "Processing",
    explanation: "Funds are moving; no action is available until this settles.",
  },
  SUCCEEDED: {
    phase: "terminal",
    waitingOn: null,
    outcome: "succeeded",
    intent: "positive",
    canApprove: false,
    canCancel: false,
    canEditAmount: false,
    isTerminal: true,
    label: "Succeeded",
    explanation: "Settled; the transaction detail carries the final amounts and references.",
  },
  FAILED: {
    phase: "terminal",
    waitingOn: null,
    outcome: "failed",
    intent: "negative",
    canApprove: false,
    canCancel: false,
    canEditAmount: false,
    isTerminal: true,
    label: "Failed",
    explanation: "The movement failed; the request record carries the reason.",
  },
  BLOCKED: {
    phase: "waiting",
    waitingOn: "venly",
    intent: "pending",
    canApprove: false,
    canCancel: false,
    canEditAmount: false,
    isTerminal: false,
    label: "Blocked",
    explanation:
      "Held for review on the Venly side; no action is available to you while the hold stands.",
  },
  DENIED: {
    phase: "terminal",
    waitingOn: null,
    outcome: "declined",
    intent: "negative",
    canApprove: false,
    canCancel: false,
    canEditAmount: false,
    isTerminal: true,
    label: "Denied",
    explanation: "Declined during review; create a new request if circumstances change.",
  },
  REJECTED: {
    phase: "terminal",
    waitingOn: null,
    outcome: "declined",
    intent: "negative",
    canApprove: false,
    canCancel: false,
    canEditAmount: false,
    isTerminal: true,
    label: "Rejected",
    explanation: "Rejected at the approval step; the reviewer's decision is final for this request.",
  },
  CANCELLED: {
    phase: "terminal",
    waitingOn: null,
    outcome: "cancelled",
    intent: "neutral",
    canApprove: false,
    canCancel: false,
    canEditAmount: false,
    isTerminal: true,
    label: "Cancelled",
    explanation: "Withdrawn before completion; no funds moved.",
  },
};

export function describeRampStatus(status: RampStatus | undefined): RampStatusDescriptor {
  if (!status || !(status in DESCRIPTORS)) {
    return {
      status: "UNKNOWN",
      phase: "waiting",
      waitingOn: null,
      intent: "neutral",
      canApprove: false,
      canCancel: false,
      canEditAmount: false,
      isTerminal: false,
      label: "Unknown status",
      explanation: "The request carries a status this version does not recognise; refetch or upgrade.",
    };
  }
  return { status, ...DESCRIPTORS[status] };
}

export interface RampLifecycleOptions {
  /** Poll interval while the request is non-terminal. Default 4000ms. */
  pollIntervalMs?: number;
}

/**
 * One ramp request, polled until terminal, with its status descriptor.
 * Polling stops by itself the moment the status is terminal.
 */
export function useRampLifecycle(id: string | undefined, options?: RampLifecycleOptions) {
  const clients = useVenly();
  const query = useQuery({
    ...venlyQueries.rampRequest(clients, id ?? ""),
    enabled: Boolean(id),
    refetchInterval: (q) => {
      const status = q.state.data?.status;
      if (status && describeRampStatus(status).isTerminal) return false;
      return options?.pollIntervalMs ?? 4_000;
    },
  });

  return {
    request: query.data,
    descriptor: describeRampStatus(query.data?.status),
    query,
  };
}
