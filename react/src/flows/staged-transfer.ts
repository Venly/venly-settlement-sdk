import { useEffect, useRef, useSyncExternalStore } from "react";
import type { Transfer, VenlyFinanceClient } from "@venlyfinance/sdk";
import { useVenly, type VenlyClients } from "../provider.js";

type CreateFiatBody = Parameters<VenlyFinanceClient["transfers"]["createFiat"]>[1];
type CreateCryptoBody = Parameters<VenlyFinanceClient["transfers"]["createCrypto"]>[1];

/**
 * The API contract requires an idempotencyKey on the create body; in this
 * machine the key is pinned by stage(), so drafts may omit it (a provided
 * key is honoured and pinned instead).
 */
type DraftBody<B extends { idempotencyKey: string }> = Omit<B, "idempotencyKey"> & {
  idempotencyKey?: string;
};

/** What the operator is composing. Discriminated on the money rail. */
export type TransferDraft =
  | { kind: "fiat"; senderAccountId: string; body: DraftBody<CreateFiatBody> }
  | { kind: "crypto"; senderAccountId: string; body: DraftBody<CreateCryptoBody> };

/**
 * The exact request that will be sent on confirm. The idempotency key is
 * pinned at staging time: however many times confirm() is retried (double
 * click, flaky network, impatient operator), the API can only execute the
 * movement once. This mirrors the settlement MCP's stage-then-confirm write
 * gate, where the dry-run answer IS the request that later executes.
 */
export interface StagedRequest {
  draft: TransferDraft;
  idempotencyKey: string;
  stagedAt: string;
}

export type StagedTransferState =
  | { phase: "draft"; issues: string[] }
  | { phase: "staged"; staged: StagedRequest }
  | { phase: "submitting"; staged: StagedRequest }
  | { phase: "pending"; staged: StagedRequest; transfer: Transfer }
  | { phase: "completed"; staged: StagedRequest; transfer: Transfer }
  | {
      phase: "failed";
      staged?: StagedRequest;
      transfer?: Transfer;
      error?: unknown;
      reason: "submit-error" | "transfer-failed" | "poll-timeout";
    };

/**
 * Structural validation only: presence and sign, never business rules the
 * API owns (limits, compliance, balance). A draft that passes here can still
 * be rejected server-side; that surfaces as phase "failed".
 */
export function validateDraft(draft: TransferDraft): string[] {
  const issues: string[] = [];
  if (!draft.senderAccountId) issues.push("senderAccountId is required");
  if (!draft.body) {
    issues.push("body is required");
    return issues;
  }
  const amount = (draft.body as { amount?: unknown }).amount;
  if (typeof amount === "number" && !(amount > 0)) {
    issues.push("amount must be greater than zero");
  }
  if (draft.kind === "fiat" && !draft.body.currency) {
    issues.push("currency is required for a fiat transfer");
  }
  if (draft.kind === "crypto") {
    if (!draft.body.asset) issues.push("asset is required for a crypto transfer");
    if (!draft.body.chain) issues.push("chain is required for a crypto transfer");
  }
  return issues;
}

export interface StagedTransferOptions {
  /** Poll interval for status while the transfer is PENDING. Default 1500ms. */
  pollIntervalMs?: number;
  /** Give up polling after this long and report "poll-timeout". Default 120s. */
  maxPollMs?: number;
}

const INITIAL: StagedTransferState = { phase: "draft", issues: [] };

/**
 * Framework-agnostic core of the stage-then-confirm machine, so the whole
 * lifecycle is testable without a DOM. The React hook below is a thin
 * subscription over this class.
 *
 * draft → stage() → staged → confirm() → submitting → pending → completed
 *                     │  ↑                                    ↘ failed
 *                edit()  └──────────────────────────────────────┘
 */
export class StagedTransferController {
  #state: StagedTransferState = INITIAL;
  #listeners = new Set<() => void>();
  #disposed = false;
  #pollTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly clients: VenlyClients,
    private readonly options: StagedTransferOptions = {},
  ) {}

  subscribe = (listener: () => void): (() => void) => {
    // A new subscription revives a disposed controller. React StrictMode
    // mounts, unmounts and remounts the same component instance: the
    // cleanup dispose() must not leave the controller permanently dead for
    // the remount, or confirm()'s continuation silently drops its state
    // updates and the flow sticks in "submitting".
    this.#disposed = false;
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  getSnapshot = (): StagedTransferState => this.#state;

  /** Validate and freeze the draft; pins the idempotency key. */
  stage(draft: TransferDraft): boolean {
    const issues = validateDraft(draft);
    if (issues.length > 0) {
      this.#set({ phase: "draft", issues });
      return false;
    }
    const bodyKey = (draft.body as { idempotencyKey?: string }).idempotencyKey;
    this.#set({
      phase: "staged",
      staged: {
        draft,
        idempotencyKey: bodyKey ?? crypto.randomUUID(),
        stagedAt: new Date().toISOString(),
      },
    });
    return true;
  }

  /** Back to composing; the staged request (and its key) is discarded. */
  edit(): void {
    if (this.#state.phase === "staged") this.#set(INITIAL);
  }

  reset(): void {
    this.#clearPoll();
    this.#set(INITIAL);
  }

  /** Execute the staged request, then poll until the transfer is terminal. */
  async confirm(): Promise<void> {
    if (this.#state.phase !== "staged") return;
    const staged = this.#state.staged;
    this.#set({ phase: "submitting", staged });

    let transfer: Transfer;
    try {
      const { draft, idempotencyKey } = staged;
      transfer =
        draft.kind === "fiat"
          ? await this.clients.finance.transfers.createFiat(
              draft.senderAccountId,
              { ...draft.body, idempotencyKey },
            )
          : await this.clients.finance.transfers.createCrypto(
              draft.senderAccountId,
              { ...draft.body, idempotencyKey },
            );
    } catch (error) {
      this.#set({ phase: "failed", staged, error, reason: "submit-error" });
      return;
    }
    if (this.#disposed) return;

    const next = this.#applyTransfer(staged, transfer);
    if (next.phase === "pending") {
      this.#poll(staged, transfer, Date.now());
    }
  }

  dispose(): void {
    this.#disposed = true;
    this.#clearPoll();
    this.#listeners.clear();
  }

  #applyTransfer(staged: StagedRequest, transfer: Transfer): StagedTransferState {
    const next: StagedTransferState =
      transfer.status === "COMPLETED"
        ? { phase: "completed", staged, transfer }
        : transfer.status === "FAILED"
          ? { phase: "failed", staged, transfer, reason: "transfer-failed" }
          : { phase: "pending", staged, transfer };
    this.#set(next);
    return next;
  }

  #poll(staged: StagedRequest, transfer: Transfer, startedAt: number): void {
    const interval = this.options.pollIntervalMs ?? 1_500;
    const maxPollMs = this.options.maxPollMs ?? 120_000;
    this.#pollTimer = setTimeout(async () => {
      if (this.#disposed) return;
      if (Date.now() - startedAt > maxPollMs) {
        this.#set({ phase: "failed", staged, transfer, reason: "poll-timeout" });
        return;
      }
      try {
        const fresh = await this.clients.finance.transfers.get(
          staged.draft.senderAccountId,
          transfer.id ?? "",
        );
        if (this.#disposed) return;
        const next = this.#applyTransfer(staged, fresh);
        if (next.phase === "pending") this.#poll(staged, fresh, startedAt);
      } catch {
        // Transient read failure: keep the last known state and try again.
        if (!this.#disposed) this.#poll(staged, transfer, startedAt);
      }
    }, interval);
  }

  #clearPoll(): void {
    if (this.#pollTimer !== undefined) clearTimeout(this.#pollTimer);
    this.#pollTimer = undefined;
  }

  #set(state: StagedTransferState): void {
    this.#state = state;
    for (const listener of this.#listeners) listener();
  }
}

/**
 * Stage-then-confirm transfer flow.
 *
 * ```tsx
 * const t = useStagedTransfer();
 * t.stage({ kind: "fiat", senderAccountId, body });  // review screen renders t.state.staged
 * await t.confirm();                                  // executes once, then polls to terminal
 * ```
 */
export function useStagedTransfer(options?: StagedTransferOptions) {
  const clients = useVenly();
  const ref = useRef<StagedTransferController | null>(null);
  ref.current ??= new StagedTransferController(clients, options);
  const controller = ref.current;

  useEffect(() => () => controller.dispose(), [controller]);

  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );

  return {
    state,
    stage: (draft: TransferDraft) => controller.stage(draft),
    edit: () => controller.edit(),
    confirm: () => controller.confirm(),
    reset: () => controller.reset(),
  };
}

export type FiatTransferDraft = Omit<Extract<TransferDraft, { kind: "fiat" }>, "kind">;
export type CryptoTransferDraft = Omit<Extract<TransferDraft, { kind: "crypto" }>, "kind">;

/**
 * Create a fiat transfer, wired through the staged-transfer flow: stage()
 * freezes the exact request and pins ONE idempotency key per staged draft;
 * confirm() executes once and polls to a terminal status. However often
 * confirm() is retried on the same staged draft, the API replays the same
 * record instead of moving money twice.
 */
export function useCreateFiatTransfer(options?: StagedTransferOptions) {
  const flow = useStagedTransfer(options);
  return {
    ...flow,
    stage: (draft: FiatTransferDraft) => flow.stage({ kind: "fiat", ...draft }),
  };
}

/** The crypto twin of {@link useCreateFiatTransfer}: same machine, same key rule. */
export function useCreateCryptoTransfer(options?: StagedTransferOptions) {
  const flow = useStagedTransfer(options);
  return {
    ...flow,
    stage: (draft: CryptoTransferDraft) => flow.stage({ kind: "crypto", ...draft }),
  };
}
