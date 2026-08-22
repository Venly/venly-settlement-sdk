/**
 * Deterministic seams for the mock: a clock and an id source. Both default to
 * the real thing, so nothing changes unless a caller asks for `deterministic`.
 * Without these, `reset()` restores the seeds but every entity created after it
 * carries a fresh uuid and a wall-clock stamp, so a scripted run never replays
 * equal and "deterministic reset" cannot be asserted.
 */
export interface MockClock {
  now(): string;
  /** Rewind to the start. Present only on deterministic clocks. */
  reset?(): void;
}

export interface MockIdSource {
  next(kind: "id" | "address" | "hash"): string;
  /** Rewind the counter. Present only on deterministic sources. */
  reset?(): void;
}

export const systemClock: MockClock = {
  now: () => new Date().toISOString(),
};

export const systemIds: MockIdSource = {
  next(kind) {
    if (kind === "address") return "0x" + crypto.randomUUID().replace(/-/g, "").slice(0, 40);
    if (kind === "hash") {
      return "0x" + (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, "").slice(0, 64);
    }
    return crypto.randomUUID();
  },
};

/** Fixed epoch, advancing a whole second per read so ordering stays strict. */
export function deterministicClock(startIso = "2026-01-01T00:00:00.000Z", stepMs = 1000): MockClock {
  const start = Date.parse(startIso);
  let tick = 0;
  return {
    now() {
      const at = new Date(start + tick * stepMs).toISOString();
      tick += 1;
      return at;
    },
    reset() {
      tick = 0;
    },
  };
}

/**
 * Counter-backed ids padded to each field's contract format — a uuid-shaped
 * id, a 40-hex address, a 64-hex hash — so generated values still satisfy the
 * schemas while being reproducible.
 */
export function deterministicIds(): MockIdSource {
  let n = 0;
  return {
    next(kind) {
      n += 1;
      const hex = n.toString(16);
      if (kind === "address") return "0x" + hex.padStart(40, "0");
      if (kind === "hash") return "0x" + hex.padStart(64, "0");
      const body = hex.padStart(32, "0");
      return [body.slice(0, 8), body.slice(8, 12), "4" + body.slice(13, 16), "8" + body.slice(17, 20), body.slice(20, 32)].join("-");
    },
    reset() {
      n = 0;
    },
  };
}

// ── Events ─────────────────────────────────────────────────────────────

export type MockEventType =
  | "transfer.created"
  | "transfer.status_changed"
  | "payout.requested"
  | "payout.status_changed"
  | "payout_route.created"
  | "payout_route.status_changed"
  | "payout_bank_account.created"
  | "payout_bank_account.status_changed"
  | "party.verification_changed"
  | "party.iv_status_changed"
  | "account.verification_changed"
  | "account.status_changed"
  | "party.status_changed"
  | "payment_session.status_changed"
  | "inbound_credit.received"
  | "wallet.balance_changed"
  | "store.reset"
  | "store.resync";

export type MockResourceKind =
  | "transfer" | "payout" | "party" | "account" | "wallet" | "virtualBankAccount"
  | "payoutRoute" | "payoutBankAccount" | "paymentSession" | "inboundCredit" | "store";

export interface MockEvent<T = unknown> {
  /**
   * `${originId}:${epoch}:${sequence}` — the dedupe key. `originId` is part of
   * it because epoch and sequence are per replica: without it two contexts
   * mutating in the same round both mint `0:5`, and a dedupe-by-id consumer
   * would silently drop one of two distinct events.
   */
  id: string;
  originId: string;
  epoch: number;
  sequence: number;
  type: MockEventType;
  occurredAt: string;
  resource: { kind: MockResourceKind; id: string };
  accountId?: string;
  previous?: { status?: string };
  data: T;
}

export interface EmitInput<T = unknown> {
  type: MockEventType;
  resource: { kind: MockResourceKind; id: string };
  accountId?: string;
  previous?: { status?: string };
  data: T;
}

/**
 * Total order within `(originId, epoch)`; exactly-once, in-order delivery to
 * handlers registered in this process. Cross-context delivery is best-effort
 * and is the channel's business, not this emitter's.
 */
export class EventLog {
  private readonly handlers = new Set<(e: MockEvent) => void>();
  private buffer: MockEvent[] = [];
  private sequence = 0;
  epoch = 0;

  constructor(
    readonly originId: string,
    private readonly clock: () => MockClock,
    private readonly bufferSize = 500,
    private readonly onHandlerError: (e: unknown) => void = () => {},
  ) {}

  emit(input: EmitInput): MockEvent {
    this.sequence += 1;
    // Snapshot the payload: emitters pass live store objects, and a past
    // event whose `data`/`previous` keep mutating narrates false history
    // ("ACTIVE → SUSPENDED" re-reading as "ACTIVE → ACTIVE" after a later
    // transition). Remote peers already receive serialized copies over the
    // channel; this makes the same-tab log tell the same truth.
    const event: MockEvent = {
      id: `${this.originId}:${this.epoch}:${this.sequence}`,
      originId: this.originId,
      epoch: this.epoch,
      sequence: this.sequence,
      occurredAt: this.clock().now(),
      ...structuredClone(input),
    };
    this.record(event);
    this.deliver(event);
    return event;
  }

  /** Deliver an event that arrived from another replica, deduped by id. */
  ingest(event: MockEvent): boolean {
    if (this.buffer.some((e) => e.id === event.id)) return false;
    this.record(event);
    this.deliver(event);
    return true;
  }

  private record(event: MockEvent): void {
    this.buffer.push(event);
    if (this.buffer.length > this.bufferSize) this.buffer.splice(0, this.buffer.length - this.bufferSize);
  }

  private deliver(event: MockEvent): void {
    for (const handler of this.handlers) {
      try {
        handler(event);
      } catch (error) {
        // One bad subscriber must not break the chain or roll back a mutation
        // that already succeeded.
        this.onHandlerError(error);
      }
    }
  }

  subscribe(handler: (e: MockEvent) => void, opts?: { since?: string }): () => void {
    if (opts?.since !== undefined) {
      const index = this.buffer.findIndex((e) => e.id === opts.since);
      if (index === -1) {
        // The cursor predates the buffer: say so with a distinct type rather
        // than a silent gap, and rather than reusing store.reset, which would
        // collide with a real reset and with the gap-free sequence rule.
        handler(this.syntheticResync("cursor predates the retained event buffer"));
      } else {
        for (const event of this.buffer.slice(index + 1)) handler(event);
      }
    }
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  list(opts?: { since?: string; accountId?: string }): MockEvent[] {
    let out = [...this.buffer];
    if (opts?.since !== undefined) {
      const index = out.findIndex((e) => e.id === opts.since);
      out = index === -1 ? out : out.slice(index + 1);
    }
    if (opts?.accountId !== undefined) out = out.filter((e) => e.accountId === opts.accountId);
    return out;
  }

  /** Emitted locally whenever this replica's view was replaced wholesale. */
  resync(reason: string): MockEvent {
    const event = this.syntheticResync(reason);
    this.record(event);
    this.deliver(event);
    return event;
  }

  private syntheticResync(reason: string): MockEvent {
    // Consumes a sequence number like any other event. Without this a replica
    // that only ever adopts (never emits) minted the same id for every resync,
    // and the dedupe rule in the delivery contract silently dropped all but
    // the first - which is the exact silent divergence resync exists to stop.
    this.sequence += 1;
    return {
      id: `${this.originId}:${this.epoch}:resync-${this.sequence}`,
      originId: this.originId,
      epoch: this.epoch,
      sequence: this.sequence,
      type: "store.resync",
      occurredAt: this.clock().now(),
      resource: { kind: "store", id: "store" },
      data: { reason },
    };
  }

  /** New epoch: sequence restarts at 1 for the new (originId, epoch) pair. */
  rollEpoch(next: number): void {
    this.epoch = next;
    this.sequence = 0;
    this.buffer = [];
  }
}
