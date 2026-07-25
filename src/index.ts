export { VenlyFinanceClient } from "./finance/client.js";
export type {
  VenlyFinanceClientOptions,
  VenlyFinanceCredentialOptions,
  VenlyFinanceMockOptions,
  FinanceEnvironment,
  CallOptions,
} from "./finance/client.js";
export { FundflowClient } from "./fundflow/client.js";
export type {
  FundflowClientOptions,
  FundflowCredentialOptions,
  FundflowMockOptions,
  FundflowEnvironment,
} from "./fundflow/client.js";

export { VenlyApiError, VenlyAuthError } from "./core/errors.js";
export type { ApiErrorBody } from "./core/errors.js";
export { TokenManager } from "./core/auth.js";
export { HttpClient } from "./core/http.js";
export type { RequestOptions, Transport } from "./core/http.js";

export { MockTransport, errorPresets, fundflowErrorPresets } from "./mock/index.js";
export type { VenlyMock, MockCall, ErrorPresetName, ErrorSpec } from "./mock/index.js";
export { iteratePages } from "./core/pagination.js";
export type { Page, PagingInfo, PageParams } from "./core/pagination.js";

export type { components as FinanceComponents } from "./generated/finance.js";
export type { components as FundflowComponents } from "./generated/fundflow.js";
