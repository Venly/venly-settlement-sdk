import type { RequestOptions, Transport } from "../core/http.js";
import { VenlyApiError } from "../core/errors.js";
import { errorPresets, toErrorEnvelope, type ErrorPresetName, type ErrorSpec } from "./errors.js";
import type { RequestShape } from "../generated/finance-shapes.js";

/** One recorded call against a mock client. */
export interface MockCall {
  method: string;
  /** Concrete path, e.g. "/parties/p-123". */
  path: string;
  /** Matched route template, e.g. "GET /parties/{partyId}"; undefined when unmatched. */
  route?: string;
  query?: Record<string, string | number | boolean | readonly (string | number)[] | undefined>;
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
  /** Return one exact envelope for the next matching request. */
  respondNext(response: unknown, match?: string): void;
  /** Delay the next matching request; useful for exercising loading states. */
  delayNext(milliseconds: number, match?: string): void;
}

/** Context handed to handler-kind routes. */
export interface HandlerContext {
  method: string;
  /** Matched template, e.g. "GET /parties/{partyId}". */
  template: string;
  /** Concrete path. */
  path: string;
  /** Path parameters by template name, e.g. { partyId: "p-1" }. */
  params: Record<string, string>;
  query: Record<string, string | number | boolean | readonly (string | number)[] | undefined>;
  body: unknown;
  /** Effective key recorded for a mutating request. */
  idempotencyKey?: string;
}

/** How a mocked route answers. */
export type RouteEntry =
  | { kind: "item"; result: unknown }
  | { kind: "list"; items: unknown[] }
  | { kind: "array"; items: unknown[] }
  | { kind: "create"; base: unknown }
  | { kind: "update"; base: unknown }
  | { kind: "none" }
  | { kind: "text"; body: string }
  /** Stateful route: the handler returns the full envelope (or throws). */
  | { kind: "handler"; handle: (ctx: HandlerContext) => unknown };

export type RouteTable = Record<string, RouteEntry>;

interface QueuedFailure {
  spec: ErrorSpec;
  match?: string;
}

interface QueuedResponse {
  response: unknown;
  match?: string;
}

interface QueuedDelay {
  milliseconds: number;
  match?: string;
}

function matchTemplate(template: string, path: string): boolean {
  const t = template.split("/");
  const p = path.split("/");
  if (t.length !== p.length) return false;
  return t.every((seg, i) => seg === p[i] || (seg.startsWith("{") && seg.endsWith("}")));
}

/** Extract `{name: value}` path parameters from a matched template. */
export function pathParams(template: string, path: string): Record<string, string> {
  const t = template.split("/");
  const p = path.split("/");
  const params: Record<string, string> = {};
  t.forEach((seg, i) => {
    if (seg.startsWith("{") && seg.endsWith("}")) params[seg.slice(1, -1)] = p[i];
  });
  return params;
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

/** Envelope for a paginated list, sliced by `page`/`size`. */
export function listEnvelope(
  items: unknown[],
  query: Record<string, string | number | boolean | readonly (string | number)[] | undefined> = {},
): unknown {
  const page = Math.max(1, Number(query.page ?? 1));
  // Spec default: `size` is 100 on both APIs. The mock mirrored 20 for a
  // while, which silently truncated any list past one screen.
  const size = Math.max(1, Number(query.size ?? 100));
  const start = (page - 1) * size;
  const slice = items.slice(start, start + size);
  const numberOfPages = Math.max(1, Math.ceil(items.length / size));
  return {
    success: true,
    result: slice,
    pagination: {
      pageNumber: page,
      pageSize: size,
      numberOfElements: slice.length,
      numberOfPages,
      hasNextPage: page < numberOfPages,
      hasPreviousPage: page > 1,
    },
  };
}

/** Envelope for a single entity. */
export function itemEnvelope(result: unknown): unknown {
  return { success: true, result };
}

/** Throw a mock-side `VenlyApiError` with the given spec. */
export function mockError(spec: ErrorSpec, method: string, path: string): never {
  const { status, errors, body } = toErrorEnvelope(spec);
  throw new VenlyApiError({ status, errors, method, path, body });
}

/**
 * Validate a mutating request body against the vendored OpenAPI spec's shape:
 * unknown top-level fields (and unknown keys of one-level object fields) are
 * rejected, missing required fields are rejected. This is what stops an
 * invented field from silently "working" in mock and failing in staging.
 */
export function validateRequestBody(
  shape: RequestShape,
  body: unknown,
  routeKey: string,
  method: string,
  path: string,
): void {
  if (body === undefined || body === null || typeof body !== "object" || Array.isArray(body)) {
    mockError(
      {
        status: 400,
        code: "invalid-request",
        message: `${routeKey} requires a JSON object body.`,
      },
      method,
      path,
    );
  }
  const record = body as Record<string, unknown>;
  const allowed = shape.properties;
  const unknown = Object.keys(record).filter((k) => !(k in allowed));
  if (unknown.length > 0) {
    mockError(
      {
        status: 400,
        code: "invalid-request",
        message:
          `Unknown field${unknown.length > 1 ? "s" : ""} ${unknown.map((k) => `"${k}"`).join(", ")} for ${routeKey}. ` +
          `Allowed fields: ${Object.keys(allowed).join(", ")}. (mock spec validation)`,
      },
      method,
      path,
    );
  }
  const missing = shape.required.filter((k) => record[k] === undefined);
  if (missing.length > 0) {
    mockError(
      {
        status: 400,
        code: "invalid-request",
        message: `Missing required field${missing.length > 1 ? "s" : ""} ${missing.map((k) => `"${k}"`).join(", ")} for ${routeKey}. (mock spec validation)`,
      },
      method,
      path,
    );
  }
  for (const [key, nestedKeys] of Object.entries(allowed)) {
    const value = record[key];
    if (!nestedKeys || value === undefined || value === null) continue;
    if (typeof value !== "object" || Array.isArray(value)) continue;
    const bad = Object.keys(value).filter((k) => !nestedKeys.includes(k));
    if (bad.length > 0) {
      mockError(
        {
          status: 400,
          code: "invalid-request",
          message: `Unknown key${bad.length > 1 ? "s" : ""} ${bad.map((k) => `"${k}"`).join(", ")} in "${key}" for ${routeKey}. Allowed: ${nestedKeys.join(", ")}. (mock spec validation)`,
        },
        method,
        path,
      );
    }
  }
}

/**
 * Fixture-backed `Transport`. Zero network by construction: it holds no fetch,
 * no token manager and no base URL. Successful responses are envelope-shaped
 * (`{success, result, pagination}`), so the resource classes' unwrap helpers
 * behave exactly as against the live API. When constructed with request
 * shapes, mutating request bodies are validated against the vendored spec.
 */
export class MockTransport implements Transport, VenlyMock {
  private readonly routes: RouteTable;
  private readonly presets: Record<string, ErrorSpec>;
  private readonly requestShapes: Record<string, RequestShape>;
  private readonly log: MockCall[] = [];
  private readonly failures: QueuedFailure[] = [];
  private readonly responses: QueuedResponse[] = [];
  private readonly delays: QueuedDelay[] = [];

  constructor(
    routes: RouteTable,
    presets: Record<string, ErrorSpec> = errorPresets,
    requestShapes: Record<string, RequestShape> = {},
  ) {
    this.routes = routes;
    this.presets = presets;
    this.requestShapes = requestShapes;
  }

  get calls(): readonly MockCall[] {
    return this.log;
  }

  clear(): void {
    this.log.length = 0;
    this.failures.length = 0;
    this.responses.length = 0;
    this.delays.length = 0;
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

  respondNext(response: unknown, match?: string): void {
    this.responses.push({ response: structuredClone(response), match });
  }

  delayNext(milliseconds: number, match?: string): void {
    if (!Number.isFinite(milliseconds) || milliseconds < 0) {
      throw new Error("delayNext milliseconds must be a non-negative finite number");
    }
    this.delays.push({ milliseconds, match });
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
      const bodyKey =
        options.body && typeof options.body === "object" && !Array.isArray(options.body)
          ? ((options.body as Record<string, unknown>).idempotencyKey as string | undefined)
          : undefined;
      call.idempotencyKey = options.idempotencyKey ?? bodyKey ?? crypto.randomUUID();
    }
    this.log.push(call);

    const delayIndex = this.delays.findIndex((item) => !item.match || item.match === routeKey);
    if (delayIndex !== -1) {
      const { milliseconds } = this.delays.splice(delayIndex, 1)[0];
      await new Promise((resolve) => setTimeout(resolve, milliseconds));
    }

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

    const shape = this.requestShapes[routeKey];
    if (shape && (method === "POST" || method === "PUT" || method === "PATCH")) {
      validateRequestBody(shape, options.body ?? {}, routeKey, method, path);
    }

    const responseIndex = this.responses.findIndex((item) => !item.match || item.match === routeKey);
    if (responseIndex !== -1) {
      return structuredClone(this.responses.splice(responseIndex, 1)[0].response) as T;
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
      case "list":
        return listEnvelope(entry.items, options.query);
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
      case "handler": {
        const body = options.body && typeof options.body === "object" && !Array.isArray(options.body)
          ? options.body as Record<string, unknown>
          : undefined;
        return entry.handle({
          method: routeKey.split(" ")[0],
          template,
          path,
          params: pathParams(template, path),
          query: options.query ?? {},
          body: options.body,
          idempotencyKey: options.idempotencyKey
            ?? (typeof body?.idempotencyKey === "string" ? body.idempotencyKey : undefined),
        });
      }
    }
  }
}
