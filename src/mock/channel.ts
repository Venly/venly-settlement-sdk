import type { MockEvent } from "./runtime.js";

export type MockStoreSnapshot = Record<string, unknown>;

export type MockChannelMessage =
  | {
      kind: "snapshot";
      epoch: number;
      revision: number;
      originId: string;
      state: MockStoreSnapshot;
      /** Exactly the events the broadcasting mutation produced — never a tail. */
      events: MockEvent[];
    }
  | { kind: "hello"; originId: string };

export interface MockStateChannel {
  readonly originId: string;
  readonly adapter: "memory" | "broadcast" | "custom";
  post(message: MockChannelMessage): void;
  subscribe(handler: (m: MockChannelMessage) => void): () => void;
  peers(): number;
  close(): void;
}

function mintOriginId(): string {
  return crypto.randomUUID().slice(0, 8);
}

/** Single-context default: nothing to replicate, nothing to receive. */
export function memoryChannel(): MockStateChannel {
  return {
    originId: mintOriginId(),
    adapter: "memory",
    post() {},
    subscribe() {
      return () => {};
    },
    peers: () => 0,
    close() {},
  };
}

let warnedAboutOrigin = false;

/**
 * `BroadcastChannel`, which is same-origin in a browser (tabs, iframes,
 * workers) and worker_threads-scoped in Node (one process). Two dev servers on
 * different ports are different origins and will NOT share — the warning below
 * exists because that failure is otherwise silent.
 */
export function broadcastChannel(sessionId: string): MockStateChannel {
  const originId = mintOriginId();
  if (typeof BroadcastChannel === "undefined") {
    throw new Error(
      "channel: \"broadcast\" needs BroadcastChannel, which this runtime does not provide. " +
        "Use the default \"memory\" channel, or supply your own MockStateChannel.",
    );
  }
  const bc = new BroadcastChannel(`venly-mock:${sessionId}`);
  // Node's BroadcastChannel holds the event loop open, so a test process (or
  // any short-lived script) would never exit. Browsers have no unref and do
  // not need one.
  (bc as { unref?: () => void }).unref?.();
  const seenPeers = new Set<string>();
  const handlers = new Set<(m: MockChannelMessage) => void>();

  bc.onmessage = (event: MessageEvent) => {
    const message = event.data as MockChannelMessage;
    if (!message || message.originId === originId) return;
    seenPeers.add(message.originId);
    for (const handler of handlers) handler(message);
  };

  if (!warnedAboutOrigin && typeof window !== "undefined" && typeof console !== "undefined") {
    warnedAboutOrigin = true;
    console.warn(
      `[venly mock] Shared state uses BroadcastChannel "venly-mock:${sessionId}", which is ` +
        `scoped to this origin (${globalThis.location?.origin ?? "unknown"}). Two apps on ` +
        `different ports are different origins and will not share a mock. Call ` +
        `simulations.channelInfo() to confirm peers before relying on it.`,
    );
  }

  return {
    originId,
    adapter: "broadcast",
    post(message) {
      bc.postMessage(message);
    },
    subscribe(handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    peers: () => seenPeers.size,
    close() {
      handlers.clear();
      bc.close();
    },
  };
}
