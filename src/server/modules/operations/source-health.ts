import type { SourceAdapterError } from "../../providers/source/contracts";

export const sourceHealthStates = [
  "healthy_with_results",
  "healthy_zero_results",
  "auth_error",
  "rate_limited",
  "quota_exhausted",
  "temporary_provider_error",
  "permanent_provider_error",
  "misconfigured",
  "budget_limited",
  "disabled",
  "unknown_failure",
] as const;

export type SourceHealthState = typeof sourceHealthStates[number];

export type SourceHealthResultV1 = {
  state: SourceHealthState;
  available: boolean;
  retryable: boolean;
};

export type SourceHealthErrorInput = Pick<SourceAdapterError, "code" | "retryable" | "providerDetails">;

export type SourceHealthExecutionStatus =
  | "completed"
  | "failed"
  | "skipped"
  | "completed_with_results"
  | "completed_zero_results"
  | "rate_limited"
  | "provider_error"
  | "budget_limited"
  | "execution_suppressed"
  | "disabled"
  | "unavailable"
  | "degraded";

export type SourceHealthClassifierInput = {
  executionStatus: SourceHealthExecutionStatus;
  normalizedItems: number;
  error?: SourceHealthErrorInput | null;
  /** Error code carried by an existing source/query result when no error object is available. */
  errorCode?: string | null;
  /** Provider-specific error code. It takes precedence over generic HTTP status. */
  providerCode?: string | null;
  providerStatus?: number | null;
  configurationState?: "configured" | "missing" | "unknown";
  controlState?: "enabled" | "disabled" | "budget_limited" | "misconfigured";
  /** Explicit structured provider state; message parsing is intentionally unsupported. */
  rateLimitState?: "none" | "rate_limited" | "quota_exhausted";
  /** Allows partial output to remain available when the execution also failed. */
  usableOutput?: boolean;
};

type ClassifiedFailure = Exclude<SourceHealthState, "healthy_with_results" | "healthy_zero_results" | "disabled" | "budget_limited">;

const AUTH_CODES = new Set([
  "AUTH_FAILED",
  "AUTHENTICATION_FAILED",
  "AUTHENTICATION_ERROR",
  "UNAUTHORIZED",
  "HTTP_401",
]);

const RATE_CODES = new Set([
  "RATE_LIMITED",
  "BACKOFF",
  "PROVIDER_BACKOFF",
  "HTTP_429",
]);

const QUOTA_CODES = new Set([
  "INSUFFICIENT_CREDITS",
  "QUOTA_EXCEEDED",
  "CREDITS_EXHAUSTED",
  "QUOTA_EXHAUSTED",
  "HTTP_402",
]);

const TEMPORARY_CODES = new Set([
  "TEMPORARY_FAILURE",
  "TIMEOUT",
  "DNS_ERROR",
  "NETWORK_ERROR",
  "CONNECTION_ERROR",
  "REQUEST_FAILED",
]);

const PERMANENT_CODES = new Set([
  "FORBIDDEN",
  "PERMISSION_DENIED",
  "GRAPHQL_ERROR",
  "MALFORMED_PROVIDER_PAYLOAD",
  "MALFORMED_PROVIDER_RESPONSE",
  "INVALID_QUERY",
  "INVALID_REQUEST_METADATA",
  "INVALID_CURSOR",
  "INVALID_REPOSITORY",
  "INVALID_POST_ID",
  "INVALID_URL",
  "NOT_FOUND",
  "POST_UNAVAILABLE",
  "UNSUPPORTED_ITEM",
  "THREAD_EXPANSION_UNSUPPORTED",
  "PAGINATION_UNAVAILABLE",
  "QUERY_REQUIRED",
  "PROTECTED_CONTENT",
  "STACK_EXCHANGE_RECENCY_DERIVATION_FAILED",
  "HTTP_400",
  "HTTP_403",
  "HTTP_404",
  "HTTP_409",
  "HTTP_422",
]);

const CONFIGURATION_CODES = new Set([
  "CONFIGURATION_MISSING",
  "MISSING_CREDENTIALS",
  "AUTH_NOT_CONFIGURED",
  "MISSING_TOKEN",
  "MISSING_API_KEY",
  "MISSING_BUSINESS_UNIT",
  "MISSING_OAUTH_CONFIGURATION",
]);

function normalizeCode(code: string | null | undefined): string | undefined {
  const normalized = code?.trim().toUpperCase();
  return normalized || undefined;
}

function providerStatus(input: SourceHealthClassifierInput): number | undefined {
  const status = input.providerStatus ?? input.error?.providerDetails?.status;
  return typeof status === "number" && Number.isInteger(status) ? status : undefined;
}

function providerCode(input: SourceHealthClassifierInput): string | undefined {
  return normalizeCode(input.providerCode ?? input.errorCode ?? input.error?.code);
}

function classifyCode(code: string | undefined, status: number | undefined, retryable: boolean): ClassifiedFailure | undefined {
  if (code) {
    if (CONFIGURATION_CODES.has(code)) return "misconfigured";
    if (AUTH_CODES.has(code)) return "auth_error";
    if (RATE_CODES.has(code)) return "rate_limited";
    if (QUOTA_CODES.has(code)) return "quota_exhausted";
    if (TEMPORARY_CODES.has(code) || /^HTTP_5\d\d$/.test(code)) return "temporary_provider_error";
    if (PERMANENT_CODES.has(code)) return "permanent_provider_error";
  }

  if (status === 401) return "auth_error";
  if (status === 402) return "quota_exhausted";
  if (status === 429) return "rate_limited";
  if (typeof status === "number" && status >= 500 && status <= 599) return "temporary_provider_error";
  if (status === 403 || status === 400 || status === 404 || status === 409 || status === 422) return "permanent_provider_error";
  if (retryable) return "temporary_provider_error";
  return undefined;
}

function result(state: SourceHealthState, available: boolean, retryable: boolean): SourceHealthResultV1 {
  return { state, available, retryable };
}

/**
 * Classifies one source/query execution without network access or side effects.
 * This is intentionally execution-level; source aggregation belongs to Stage 2C.
 */
export function classifySourceHealth(input: SourceHealthClassifierInput): SourceHealthResultV1 {
  const normalizedItems = Number.isFinite(input.normalizedItems) ? Math.max(0, Math.floor(input.normalizedItems)) : 0;
  const usableOutput = input.usableOutput ?? normalizedItems > 0;

  if (input.controlState === "disabled" || input.executionStatus === "disabled") return result("disabled", false, false);
  if (input.controlState === "budget_limited" || input.executionStatus === "budget_limited") return result("budget_limited", false, false);
  if (input.controlState === "misconfigured" || input.configurationState === "missing" || input.executionStatus === "unavailable") return result("misconfigured", false, false);

  const code = providerCode(input);
  const status = providerStatus(input);
  let failure: ClassifiedFailure | undefined;
  if (input.rateLimitState === "quota_exhausted") failure = "quota_exhausted";
  else if (input.rateLimitState === "rate_limited" || input.executionStatus === "rate_limited") failure = "rate_limited";
  else failure = classifyCode(code, status, input.error?.retryable === true);

  if (failure === "misconfigured") return result("misconfigured", false, false);
  if (failure === "auth_error") return result("auth_error", false, false);
  if (failure === "rate_limited") return result("rate_limited", usableOutput, true);
  if (failure === "quota_exhausted") return result("quota_exhausted", false, false);
  if (failure === "temporary_provider_error") return result("temporary_provider_error", usableOutput, true);
  if (failure === "permanent_provider_error") return result("permanent_provider_error", usableOutput, false);

  if (input.executionStatus === "completed" || input.executionStatus === "completed_with_results" || input.executionStatus === "completed_zero_results") {
    return normalizedItems > 0
      ? result("healthy_with_results", true, false)
      : result("healthy_zero_results", true, false);
  }

  return result("unknown_failure", usableOutput, false);
}
