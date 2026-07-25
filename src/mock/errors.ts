import type { ApiErrorBody } from "../core/errors.js";

/**
 * Error presets for `mock.failNext(...)`, transcribed from the error-response
 * examples in `specs/finance.yaml` and `specs/fundflow.yaml`
 * (`components/responses`). Each throws as a real `VenlyApiError` with the
 * same envelope shape the live API returns.
 *
 * The two APIs use different error-code conventions: Finance emits kebab-case
 * codes ("invalid-request", "concurrent-modification"), Fundflow emits
 * uppercase codes ("UNAUTHORIZED", "OPTIMISTIC_LOCK_EXCEPTION") except its 400
 * ("validation-error"). Preset NAMES stay identical across both clients so
 * `failNext("VALIDATION_ERROR")` always means "simulate this API's 400" — the
 * thrown `code` is whatever that API actually emits.
 */
export interface ErrorSpec {
  status: number;
  code: string;
  message: string;
  traceCode?: string;
}

/** Finance API presets (default table): codes from the live Finance spec. */
export const errorPresets = {
  VALIDATION_ERROR: {
    status: 400,
    code: "invalid-request",
    message: "The request contains invalid parameters.",
  },
  UNAUTHORIZED: {
    status: 401,
    code: "unauthenticated",
    message: "Please authenticate to perform this action.",
  },
  FORBIDDEN: {
    status: 403,
    code: "forbidden",
    message: "You do not have permission to access this resource.",
  },
  NOT_FOUND: {
    status: 404,
    code: "account-not-found",
    message: "The requested resource was not found.",
  },
  CONFLICT: {
    status: 409,
    code: "concurrent-modification",
    message: "This request has been modified by another user. Please refresh and retry.",
  },
  OPTIMISTIC_LOCK_EXCEPTION: {
    status: 409,
    code: "concurrent-modification",
    message: "This request has been modified by another user. Please refresh and retry.",
  },
  INSUFFICIENT_FUNDS: {
    status: 402,
    code: "insufficient-funds",
    message: "The account wallet balance is insufficient to complete this request.",
  },
  IDEMPOTENCY_CONFLICT: {
    status: 422,
    code: "idempotency-conflict",
    message: "This idempotency key was already used with a different request body.",
  },
  INTERNAL_SERVER_ERROR: {
    status: 500,
    code: "internal-error",
    message: "An unexpected error occurred. Please try again later.",
  },
} as const satisfies Record<string, ErrorSpec>;

/** Fundflow API presets: codes from the live Fundflow spec. */
export const fundflowErrorPresets = {
  VALIDATION_ERROR: {
    status: 400,
    code: "validation-error",
    message: "A descriptive error message",
  },
  UNAUTHORIZED: {
    status: 401,
    code: "UNAUTHORIZED",
    message: "Access is denied.",
  },
  FORBIDDEN: {
    status: 403,
    code: "FORBIDDEN",
    message: "User doesn't have proper authority to access this resource",
  },
  NOT_FOUND: {
    status: 404,
    code: "NOT_FOUND",
    message: "The requested resource was not found.",
  },
  METHOD_NOT_SUPPORTED: {
    status: 405,
    code: "METHOD_NOT_SUPPORTED",
    message: "HttpMethod is not supported. Supported methods are [GET, POST].",
  },
  INVALID_MEDIA_TYPE: {
    status: 415,
    code: "INVALID_MEDIA_TYPE",
    message: "Request must be application/json.",
  },
  CONFLICT: {
    status: 409,
    code: "OPTIMISTIC_LOCK_EXCEPTION",
    message: "The resource has been modified. Please fetch the latest version and retry.",
  },
  OPTIMISTIC_LOCK_EXCEPTION: {
    status: 409,
    code: "OPTIMISTIC_LOCK_EXCEPTION",
    message: "The resource has been modified. Please fetch the latest version and retry.",
  },
  INTERNAL_SERVER_ERROR: {
    status: 500,
    code: "INTERNAL_SERVER_ERROR",
    message: "An unexpected error occurred. Please try again later.",
  },
} as const satisfies Record<string, ErrorSpec>;

/**
 * Union of both tables' names. A name that exists only in the other API's
 * table fails at runtime with the list of presets the current client knows.
 */
export type ErrorPresetName = keyof typeof errorPresets | keyof typeof fundflowErrorPresets;

let traceCounter = 0;

/** Envelope body + errors array for a spec, with a distinct mock traceCode. */
export function toErrorEnvelope(spec: ErrorSpec): {
  status: number;
  errors: ApiErrorBody[];
  body: unknown;
} {
  traceCounter += 1;
  const errors: ApiErrorBody[] = [
    {
      code: spec.code,
      message: spec.message,
      traceCode: spec.traceCode ?? `mock-trace-${String(traceCounter).padStart(4, "0")}`,
    },
  ];
  return { status: spec.status, errors, body: { success: false, errors } };
}
