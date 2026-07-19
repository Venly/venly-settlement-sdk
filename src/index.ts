export { VenlyFinanceClient } from "./finance/client.js";
export type {
  VenlyFinanceClientOptions,
  FinanceEnvironment,
  CallOptions,
} from "./finance/client.js";
export { FundflowClient } from "./fundflow/client.js";
export type { FundflowClientOptions, FundflowEnvironment } from "./fundflow/client.js";

export { VenlyApiError, VenlyAuthError } from "./core/errors.js";
export type { ApiErrorBody } from "./core/errors.js";
export { TokenManager } from "./core/auth.js";
export { HttpClient } from "./core/http.js";
export type { RequestOptions } from "./core/http.js";
export { iteratePages } from "./core/pagination.js";
export type { Page, PagingInfo, PageParams } from "./core/pagination.js";

export type { components as FinanceComponents } from "./generated/finance.js";
export type { components as FundflowComponents } from "./generated/fundflow.js";
