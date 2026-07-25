import type { ApiErrorBody } from "../core/errors.js";

/**
 * Error presets for `mock.failNext(...)`, transcribed from the error-response
 * examples in `specs/finance.yaml` and `specs/fundflow.yaml`
 * (`components/responses`). Each throws as a real `VenlyApiError` with the
 * same envelope shape the live API returns.
 */
export interface ErrorSpec {
  status: number;
  code: string;
  message: string;
  traceCode?: string;
}

export const errorPresets = {
  VALIDATION_ERROR: {
    status: 400,
    code: "VALIDATION_ERROR",
    message: "The request contains invalid parameters.",
  },
  UNAUTHORIZED: {
    status: 401,
    code: "UNAUTHORIZED",
    message: "Missing or invalid authentication token.",
  },
  FORBIDDEN: {
    status: 403,
    code: "FORBIDDEN",
    message: "User does not have permission to access this resource.",
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
  CONFLICT: {
    status: 409,
    code: "CONFLICT",
    message: "A resource with the specified identifier already exists.",
  },
  OPTIMISTIC_LOCK_EXCEPTION: {
    status: 409,
    code: "OPTIMISTIC_LOCK_EXCEPTION",
    message: "The resource has been modified. Please fetch the latest version and retry.",
  },
  INVALID_MEDIA_TYPE: {
    status: 415,
    code: "INVALID_MEDIA_TYPE",
    message: "Request must be application/json.",
  },
  RATE_LIMITED: {
    status: 429,
    code: "RATE_LIMITED",
    message: "Too many requests. Please retry after the specified time.",
  },
  INTERNAL_SERVER_ERROR: {
    status: 500,
    code: "INTERNAL_SERVER_ERROR",
    message: "An unexpected error occurred. Please try again later.",
  },
} as const satisfies Record<string, ErrorSpec>;

export type ErrorPresetName = keyof typeof errorPresets;

/**
 * Fundflow's error-code conventions diverge from Finance in one place: its
 * 400 example uses lowercase "validation-error" (`specs/fundflow.yaml`).
 * The fundflow mock client resolves presets from this table so
 * `failNext("VALIDATION_ERROR")` teaches the code the Fundflow API actually
 * emits. Preset NAMES stay identical across both clients on purpose.
 */
export const fundflowErrorPresets: Record<ErrorPresetName, ErrorSpec> = {
  ...errorPresets,
  VALIDATION_ERROR: {
    status: 400,
    code: "validation-error",
    message: "A descriptive error message",
  },
};

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
