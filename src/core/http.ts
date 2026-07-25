import { TokenManager } from "./auth.js";
import { VenlyApiError, type ApiErrorBody } from "./errors.js";

export interface RequestOptions {
  /** Query string parameters; undefined values are dropped. */
  query?: Record<string, string | number | boolean | undefined>;
  /** JSON request body. */
  body?: unknown;
  /**
   * Idempotency key for mutating requests (POST/PUT/PATCH). Auto-generated
   * (UUID v4) when omitted, so retries are always safe. Pass your own to
   * deduplicate across processes.
   */
  idempotencyKey?: string;
  /** Extra headers, merged last. */
  headers?: Record<string, string>;
  /** AbortSignal to cancel the request (not retried after abort). */
  signal?: AbortSignal;
  /**
   * How to read a successful body. "json" (default) parses; "text" returns
   * the raw string (e.g. CSV exports).
   */
  responseType?: "json" | "text";
}

/**
 * The single seam every resource namespace calls through. `HttpClient` is the
 * network implementation; `MockTransport` (environment: "mock") is the
 * fixture-backed one.
 */
export interface Transport {
  request<T>(method: string, path: string, options?: RequestOptions): Promise<T>;
}

export interface HttpClientOptions {
  baseUrl: string;
  tokenManager: TokenManager;
  fetch: typeof fetch;
  /** Total attempts per request including the first. Default 3. */
  maxAttempts?: number;
  /** Base backoff delay in ms; grows exponentially with jitter. Default 250. */
  backoffMs?: number;
  userAgent?: string;
}

const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(signal.reason ?? new Error("aborted"));
      },
      { once: true },
    );
  });
}

/**
 * Transport shared by every resource namespace: bearer auth with automatic
 * refresh, automatic Idempotency-Key on POST, retry with exponential backoff
 * + jitter on 429/502/503/504 and network errors (Retry-After respected),
 * and `{success, errors[], result}` envelope handling on failures.
 */
export class HttpClient implements Transport {
  private readonly opts: Required<HttpClientOptions>;

  constructor(opts: HttpClientOptions) {
    this.opts = {
      ...opts,
      maxAttempts: opts.maxAttempts ?? 3,
      backoffMs: opts.backoffMs ?? 250,
      userAgent: opts.userAgent ?? "venly-sdk",
    };
  }

  async request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
    const url = this.buildUrl(path, options.query);
    const headers: Record<string, string> = {
      Accept: "application/json",
      "User-Agent": this.opts.userAgent,
      ...options.headers,
    };
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    if (method === "POST" || method === "PUT" || method === "PATCH") {
      headers["Idempotency-Key"] = options.idempotencyKey ?? crypto.randomUUID();
    }

    let attempt = 0;
    let retriedAuth = false;
    for (;;) {
      attempt += 1;
      headers["Authorization"] = `Bearer ${await this.opts.tokenManager.getToken()}`;

      let res: Response;
      try {
        res = await this.opts.fetch(url, {
          method,
          headers,
          body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
          signal: options.signal,
        });
      } catch (err) {
        if (options.signal?.aborted || attempt >= this.opts.maxAttempts) throw err;
        await sleep(this.backoffDelay(attempt), options.signal);
        continue;
      }

      if (res.ok) {
        if (res.status === 204) return undefined as T;
        const text = await res.text();
        if (options.responseType === "text") return text as T;
        return (text ? JSON.parse(text) : undefined) as T;
      }

      // One transparent re-auth on 401: token may have been revoked early.
      if (res.status === 401 && !retriedAuth) {
        retriedAuth = true;
        this.opts.tokenManager.invalidate();
        continue;
      }

      if (RETRYABLE_STATUSES.has(res.status) && attempt < this.opts.maxAttempts) {
        const retryAfter = Number(res.headers.get("Retry-After"));
        const delay =
          Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1000
            : this.backoffDelay(attempt);
        await sleep(delay, options.signal);
        continue;
      }

      throw await this.toError(res, method, path);
    }
  }

  private buildUrl(path: string, query?: RequestOptions["query"]): string {
    const url = new URL(this.opts.baseUrl.replace(/\/$/, "") + path);
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
    return url.toString();
  }

  private backoffDelay(attempt: number): number {
    const base = this.opts.backoffMs * 2 ** (attempt - 1);
    return base + Math.random() * base;
  }

  private async toError(res: Response, method: string, path: string): Promise<VenlyApiError> {
    let body: unknown;
    let errors: ApiErrorBody[] = [];
    try {
      body = await res.json();
      const maybe = body as { errors?: ApiErrorBody[] };
      if (Array.isArray(maybe.errors)) errors = maybe.errors;
    } catch {
      body = undefined;
    }
    return new VenlyApiError({ status: res.status, errors, method, path, body });
  }
}
