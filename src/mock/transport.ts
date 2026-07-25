import type { RequestOptions, Transport } from "../core/http.js";
import { VenlyApiError } from "../core/errors.js";
import { errorPresets, toErrorEnvelope, type ErrorPresetName, type ErrorSpec } from "./errors.js";

/** One recorded call against a mock client. */
export interface MockCall {
  method: string;
  /** Concrete path, e.g. "/parties/p-123". */
  path: string;
  /** Matched route template, e.g. "GET /parties/{partyId}"; undefined when unmatched. */
  route?: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  headers?: Record<string, string>;
  idempotencyKey?: string;
}

/** Public mock controls, exposed as `client.mock` on mock-mode clients. */
export interface VenlyMock {
  /** Every request made through this client, in order. */
  readonly calls: readonly MockCall[];
  /** Reset the call log and any queued failures. */
  clear(): void;
  /**
   * Make the next call fail with a real `VenlyApiError`. Pass a preset name
   * (e.g. "NOT_FOUND", "OPTIMISTIC_LOCK_EXCEPTION") or a custom
   * `{status, code, message}`. With `match` (a route key like "POST /parties"),
   * only the next call hitting that route fails; other calls pass through.
   * Queued failures are FIFO and each is consumed by one call.
   */
  failNext(error: ErrorPresetName | ErrorSpec, match?: string): void;
}

/** How a mocked route answers. */
export type RouteEntry =
  | { kind: "item"; result: unknown }
  | { kind: "list"; items: unknown[] }
  | { kind: "array"; items: unknown[] }
  | { kind: "create"; base: unknown }
  | { kind: "update"; base: unknown }
  | { kind: "none" }
  | { kind: "text"; body: string };

export type RouteTable = Record<string, RouteEntry>;

interface QueuedFailure {
  spec: ErrorSpec;
  match?: string;
}

function matchTemplate(template: string, path: string): boolean {
  const t = template.split("/");
  const p = path.split("/");
  if (t.length !== p.length) return false;
  return t.every((seg, i) => seg === p[i] || (seg.startsWith("{") && seg.endsWith("}")));
}

/** Substitute the last path parameter into a fixture's `id` field, when both exist. */
function echoId(template: string, path: string, result: unknown): unknown {
  if (result === null || typeof result !== "object" || Array.isArray(result)) return result;
  const t = template.split("/");
  const p = path.split("/");
  for (let i = t.length - 1; i >= 0; i -= 1) {
    if (t[i].startsWith("{") && "id" in (result as Record<string, unknown>)) {
      return { ...(result as Record<string, unknown>), id: p[i] };
    }
  }
  return result;
}

/**
 * Fixture-backed `Transport`. Zero network by construction: it holds no fetch,
 * no token manager and no base URL. Successful responses are envelope-shaped
 * (`{success, result, pagination}`), so the resource classes' unwrap helpers
 * behave exactly as against the live API.
 */
export class MockTransport implements Transport, VenlyMock {
  private readonly routes: RouteTable;
  private readonly presets: Record<string, ErrorSpec>;
  private readonly log: MockCall[] = [];
  private readonly failures: QueuedFailure[] = [];

  constructor(routes: RouteTable, presets: Record<string, ErrorSpec> = errorPresets) {
    this.routes = routes;
    this.presets = presets;
  }

  get calls(): readonly MockCall[] {
    return this.log;
  }

  clear(): void {
    this.log.length = 0;
    this.failures.length = 0;
  }

  failNext(error: ErrorPresetName | ErrorSpec, match?: string): void {
    const spec = typeof error === "string" ? this.presets[error] : error;
    if (!spec) {
      throw new Error(
        `Unknown error preset "${String(error)}". Known presets: ${Object.keys(this.presets).join(", ")}`,
      );
    }
    this.failures.push({ spec, match });
  }

  async request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
    const routeKey = this.findRoute(method, path);

    const call: MockCall = {
      method,
      path,
      route: routeKey,
      query: options.query,
      body: options.body,
      headers: options.headers,
    };
    if (method === "POST" || method === "PUT" || method === "PATCH") {
      call.idempotencyKey = options.idempotencyKey ?? crypto.randomUUID();
    }
    this.log.push(call);

    // Drain the first matching queued failure (FIFO).
    const idx = this.failures.findIndex((f) => !f.match || f.match === routeKey);
    if (idx !== -1) {
      const { spec } = this.failures.splice(idx, 1)[0];
      const { status, errors, body } = toErrorEnvelope(spec);
      throw new VenlyApiError({ status, errors, method, path, body });
    }

    if (!routeKey) {
      const known = Object.keys(this.routes).sort().join("\n  ");
      const { errors, body } = toErrorEnvelope({
        status: 404,
        code: "NOT_FOUND",
        message: `No mock fixture for ${method} ${path}. Known mock routes:\n  ${known}`,
      });
      throw new VenlyApiError({ status: 404, errors, method, path, body });
    }

    return structuredClone(this.dispatch(this.routes[routeKey], routeKey, path, options)) as T;
  }

  private findRoute(method: string, path: string): string | undefined {
    const direct = `${method} ${path}`;
    if (this.routes[direct]) return direct;
    return Object.keys(this.routes).find((key) => {
      const [m, template] = key.split(" ");
      return m === method && matchTemplate(template, path);
    });
  }

  private dispatch(
    entry: RouteEntry,
    routeKey: string,
    path: string,
    options: RequestOptions,
  ): unknown {
    const template = routeKey.split(" ")[1];
    switch (entry.kind) {
      case "item":
        return { success: true, result: echoId(template, path, entry.result) };
      case "array":
        return { success: true, result: entry.items };
      case "list": {
        const page = Math.max(1, Number(options.query?.page ?? 1));
        const size = Math.max(1, Number(options.query?.size ?? 20));
        const start = (page - 1) * size;
        const items = entry.items.slice(start, start + size);
        const numberOfPages = Math.max(1, Math.ceil(entry.items.length / size));
        return {
          success: true,
          result: items,
          pagination: {
            pageNumber: page,
            pageSize: size,
            numberOfElements: items.length,
            numberOfPages,
            hasNextPage: page < numberOfPages,
            hasPreviousPage: page > 1,
          },
        };
      }
      case "create":
      case "update": {
        const body =
          options.body && typeof options.body === "object" && !Array.isArray(options.body)
            ? (options.body as Record<string, unknown>)
            : {};
        return {
          success: true,
          result: echoId(template, path, {
            ...(entry.base as Record<string, unknown>),
            ...body,
          }),
        };
      }
      case "none":
        return undefined;
      case "text":
        return entry.body;
    }
  }
}
