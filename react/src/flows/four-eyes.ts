import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { VenlyApiError, type RampRequest } from "@venlyfinance/sdk";
import { useVenly } from "../provider.js";
import { venlyKeys } from "../keys.js";

/**
 * Client-side read of what the four-eyes rule allows right now. The API is
 * the enforcer (creator ≠ approver, optimistic locking); this function only
 * decides what to RENDER: an approve button that will certainly be refused
 * is worse than an explanation of who can act.
 */
export interface ApprovalCapability {
  canApprove: boolean;
  canReject: boolean;
  canCancel: boolean;
  /** Why approval is unavailable, when it is. */
  reason?: "not-awaiting-approval" | "actor-is-creator";
}

/**
 * Structural input: `createdBy` is carried by ramp-request LIST items but
 * not by the detail DTO, so it is optional here and creator detection simply
 * degrades (the API still enforces the rule) when it is absent.
 */
export interface ApprovalSubject {
  status?: RampRequest["status"];
  createdBy?: string;
}

export function approvalCapabilities(
  request: ApprovalSubject | undefined,
  actorId?: string,
): ApprovalCapability {
  if (!request || request.status !== "AWAITING_APPROVAL") {
    return {
      canApprove: false,
      canReject: false,
      canCancel: request?.status === "AWAITING_FUNDS",
      reason: "not-awaiting-approval",
    };
  }
  if (actorId && request.createdBy && actorId === request.createdBy) {
    // Four-eyes: the creator can cancel their own request but never approve
    // or reject it. Rendering the buttons anyway teaches operators that
    // errors are normal; hiding them teaches the control.
    return { canApprove: false, canReject: false, canCancel: true, reason: "actor-is-creator" };
  }
  return { canApprove: true, canReject: true, canCancel: true };
}

/**
 * Typed interpretation of an approval failure, so UI renders the correct
 * next action instead of a generic error toast.
 *
 * - "stale-version": someone else acted first (HTTP 409, optimistic lock).
 *   Correct UI: refresh the request, re-render capabilities, let the
 *   operator re-decide against the NEW state. Never auto-retry an approval.
 * - "forbidden": the API refused the actor (includes the server-enforced
 *   creator≠approver rule). Correct UI: show who can act.
 */
export type ApprovalFailureKind =
  | "stale-version"
  | "forbidden"
  | "not-found"
  | "validation"
  | "unknown";

export function interpretApprovalError(error: unknown): ApprovalFailureKind {
  if (error instanceof VenlyApiError) {
    if (error.status === 409) return "stale-version";
    if (error.status === 403) return "forbidden";
    if (error.status === 404) return "not-found";
    if (error.status === 400) return "validation";
  }
  return "unknown";
}

export type FourEyesState =
  | { phase: "idle" }
  | { phase: "submitting"; action: "approve" | "reject" | "cancel" }
  | { phase: "applied"; action: "approve" | "reject" | "cancel"; request: RampRequest }
  | {
      phase: "failed";
      action: "approve" | "reject" | "cancel";
      failure: ApprovalFailureKind;
      error: unknown;
    };

/**
 * Four-eyes decision flow for one ramp request. Carries the optimistic-
 * locking `version` through every action; a 409 comes back as
 * "stale-version" so the surface can refetch-and-re-decide.
 *
 * ```tsx
 * const approval = useFourEyesApproval(request, currentUserEmail);
 * if (approval.capability.canApprove) <Button onClick={approval.approve} />
 * ```
 */
export function useFourEyesApproval(
  request: (RampRequest & { createdBy?: string }) | undefined,
  actorId?: string,
) {
  const { fundflow } = useVenly();
  const queryClient = useQueryClient();
  const [state, setState] = useState<FourEyesState>({ phase: "idle" });

  const act = async (action: "approve" | "reject" | "cancel") => {
    if (!request?.id) return;
    if (typeof request.version !== "number") {
      setState({
        phase: "failed",
        action,
        failure: "stale-version",
        error: new Error(
          "Ramp request carries no version; refetch it before acting so optimistic locking can protect the decision.",
        ),
      });
      return;
    }
    setState({ phase: "submitting", action });
    try {
      const body = { version: request.version };
      const updated =
        action === "approve"
          ? await fundflow.rampRequests.approve(request.id, body)
          : action === "reject"
            ? await fundflow.rampRequests.reject(request.id, body)
            : await fundflow.rampRequests.cancel(request.id, body);
      if (updated.id) queryClient.setQueryData(venlyKeys.rampRequest(updated.id), updated);
      void queryClient.invalidateQueries({ queryKey: ["venly", "ramp-requests"] });
      setState({ phase: "applied", action, request: updated });
    } catch (error) {
      setState({ phase: "failed", action, failure: interpretApprovalError(error), error });
      // A stale version means the cached request lies; make every reader refetch.
      if (interpretApprovalError(error) === "stale-version" && request.id) {
        void queryClient.invalidateQueries({ queryKey: venlyKeys.rampRequest(request.id) });
      }
    }
  };

  return {
    state,
    capability: approvalCapabilities(request, actorId),
    approve: () => act("approve"),
    reject: () => act("reject"),
    cancel: () => act("cancel"),
    reset: () => setState({ phase: "idle" }),
  };
}
