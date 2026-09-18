/** One entry from the API's `errors[]` array. */
export interface ApiErrorBody {
  code?: string;
  message?: string;
  /** Unique identifier for tracing the error in Venly's logs. Quote this when escalating to support. */
  traceCode?: string;
}

/** Thrown for any non-2xx API response. */
export class VenlyApiError extends Error {
  readonly status: number;
  readonly errors: ApiErrorBody[];
  readonly method: string;
  readonly path: string;
  /** Raw parsed response body, when the response was JSON. */
  readonly body: unknown;

  constructor(opts: {
    status: number;
    errors: ApiErrorBody[];
    method: string;
    path: string;
    body: unknown;
  }) {
    const first = opts.errors[0];
    const detail = first
      ? `${first.code ?? "UNKNOWN"}: ${first.message ?? "no message"}` +
        (first.traceCode ? ` (traceCode ${first.traceCode})` : "")
      : `HTTP ${opts.status}`;
    super(`${opts.method} ${opts.path} failed with ${opts.status} – ${detail}`);
    this.name = "VenlyApiError";
    this.status = opts.status;
    this.errors = opts.errors;
    this.method = opts.method;
    this.path = opts.path;
    this.body = opts.body;
  }

  /** First traceCode in the error list, if any. */
  get traceCode(): string | undefined {
    return this.errors.find((e) => e.traceCode)?.traceCode;
  }
}

/**
 * Thrown when the OAuth2 token endpoint rejects the client credentials, or answers
 * with a success status whose body carries no usable `access_token`. The second
 * case is caught at the auth boundary on purpose: caching a token-less payload would
 * send `Bearer undefined` on every later request and surface as a 401 somewhere else.
 */
export class VenlyAuthError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, body: unknown, reason?: string) {
    super(
      reason
        ? `OAuth2 token request failed with ${status}: ${reason}`
        : `OAuth2 token request failed with ${status}`,
    );
    this.name = "VenlyAuthError";
    this.status = status;
    this.body = body;
  }
}
