import { describe, expect, it } from "vitest";

import { classifySourceHealth, type SourceHealthClassifierInput } from "../../src/server/modules/operations/source-health";

function classify(input: Partial<SourceHealthClassifierInput> = {}) {
  return classifySourceHealth({ executionStatus: "failed", normalizedItems: 0, ...input });
}

describe("Source Health V1 canonical classifier", () => {
  it("classifies successful executions by normalized output", () => {
    expect(classify({ executionStatus: "completed", normalizedItems: 3 })).toEqual({ state: "healthy_with_results", available: true, retryable: false });
    expect(classify({ executionStatus: "completed", normalizedItems: 0 })).toEqual({ state: "healthy_zero_results", available: true, retryable: false });
    expect(classify({ executionStatus: "completed_with_results", normalizedItems: 1 })).toEqual({ state: "healthy_with_results", available: true, retryable: false });
    expect(classify({ executionStatus: "completed_zero_results", normalizedItems: 0 })).toEqual({ state: "healthy_zero_results", available: true, retryable: false });
  });

  it("keeps explicit control states ahead of provider errors", () => {
    expect(classify({ controlState: "disabled", providerCode: "AUTH_FAILED" })).toEqual({ state: "disabled", available: false, retryable: false });
    expect(classify({ controlState: "budget_limited", normalizedItems: 4 })).toEqual({ state: "budget_limited", available: false, retryable: false });
    expect(classify({ configurationState: "missing", providerCode: "AUTH_FAILED" })).toEqual({ state: "misconfigured", available: false, retryable: false });
  });

  it("maps GitHub authentication, rate limiting, and temporary failures", () => {
    expect(classify({ providerCode: "AUTH_FAILED", providerStatus: 401 })).toEqual({ state: "auth_error", available: false, retryable: false });
    expect(classify({ providerCode: "RATE_LIMITED", providerStatus: 403 })).toEqual({ state: "rate_limited", available: false, retryable: true });
    expect(classify({ providerStatus: 429 })).toEqual({ state: "rate_limited", available: false, retryable: true });
    expect(classify({ providerStatus: 503 })).toEqual({ state: "temporary_provider_error", available: false, retryable: true });
    expect(classify({ executionStatus: "completed", normalizedItems: 0 })).toEqual({ state: "healthy_zero_results", available: true, retryable: false });
  });

  it("maps X credential, auth, credit, and rate states", () => {
    expect(classify({ providerCode: "CONFIGURATION_MISSING" })).toEqual({ state: "misconfigured", available: false, retryable: false });
    expect(classify({ providerCode: "AUTH_FAILED", providerStatus: 401 })).toEqual({ state: "auth_error", available: false, retryable: false });
    expect(classify({ providerCode: "INSUFFICIENT_CREDITS", providerStatus: 402 })).toEqual({ state: "quota_exhausted", available: false, retryable: false });
    expect(classify({ providerStatus: 402 })).toEqual({ state: "quota_exhausted", available: false, retryable: false });
    expect(classify({ providerCode: "RATE_LIMITED", providerStatus: 429 })).toEqual({ state: "rate_limited", available: false, retryable: true });
  });

  it("maps YouTube credential, auth, quota, and zero-result states", () => {
    expect(classify({ providerCode: "MISSING_CREDENTIALS" })).toEqual({ state: "misconfigured", available: false, retryable: false });
    expect(classify({ providerCode: "AUTH_FAILED" })).toEqual({ state: "auth_error", available: false, retryable: false });
    expect(classify({ providerCode: "QUOTA_EXCEEDED" })).toEqual({ state: "quota_exhausted", available: false, retryable: false });
    expect(classify({ executionStatus: "completed", normalizedItems: 0 })).toEqual({ state: "healthy_zero_results", available: true, retryable: false });
  });

  it("maps G2 no-match and provider states without treating no-match as failure", () => {
    expect(classify({ providerCode: "CONFIGURATION_MISSING" })).toEqual({ state: "misconfigured", available: false, retryable: false });
    expect(classify({ providerCode: "HTTP_401" })).toEqual({ state: "auth_error", available: false, retryable: false });
    expect(classify({ providerCode: "HTTP_429" })).toEqual({ state: "rate_limited", available: false, retryable: true });
    expect(classify({ executionStatus: "completed", normalizedItems: 0 })).toEqual({ state: "healthy_zero_results", available: true, retryable: false });
    expect(classify({ executionStatus: "completed", normalizedItems: 2 })).toEqual({ state: "healthy_with_results", available: true, retryable: false });
  });

  it("maps Product Hunt and Trustpilot configuration/auth/rate states", () => {
    expect(classify({ providerCode: "CONFIGURATION_MISSING" })).toEqual({ state: "misconfigured", available: false, retryable: false });
    expect(classify({ providerCode: "AUTHENTICATION_FAILED" })).toEqual({ state: "auth_error", available: false, retryable: false });
    expect(classify({ providerCode: "HTTP_429" })).toEqual({ state: "rate_limited", available: false, retryable: true });
    expect(classify({ providerCode: "CONFIGURATION_MISSING" })).toEqual({ state: "misconfigured", available: false, retryable: false });
    expect(classify({ providerCode: "HTTP_401" })).toEqual({ state: "auth_error", available: false, retryable: false });
  });

  it("preserves Public Web zero-result behavior for locally rejected URLs", () => {
    expect(classify({ executionStatus: "completed", normalizedItems: 0 })).toEqual({ state: "healthy_zero_results", available: true, retryable: false });
  });

  it("uses provider codes before generic status and never guesses unknown failures", () => {
    expect(classify({ providerCode: "RATE_LIMITED", providerStatus: 403 })).toEqual({ state: "rate_limited", available: false, retryable: true });
    expect(classify({ providerCode: "FORBIDDEN", providerStatus: 429 })).toEqual({ state: "permanent_provider_error", available: false, retryable: false });
    expect(classify({ providerCode: "UNRECOGNIZED_PROVIDER_CODE" })).toEqual({ state: "unknown_failure", available: false, retryable: false });
    expect(classify({ error: { code: "UNRECOGNIZED_PROVIDER_CODE", retryable: true } })).toEqual({ state: "temporary_provider_error", available: false, retryable: true });
  });

  it("keeps partial usable output available while classifying the failure", () => {
    expect(classify({ providerCode: "TIMEOUT", normalizedItems: 2 })).toEqual({ state: "temporary_provider_error", available: true, retryable: true });
    expect(classify({ providerCode: "MALFORMED_PROVIDER_PAYLOAD", normalizedItems: 2 })).toEqual({ state: "permanent_provider_error", available: true, retryable: false });
  });

  it("maps explicit structured rate-limit and quota state without message parsing", () => {
    expect(classify({ rateLimitState: "rate_limited", normalizedItems: 0 })).toEqual({ state: "rate_limited", available: false, retryable: true });
    expect(classify({ rateLimitState: "quota_exhausted", normalizedItems: 0 })).toEqual({ state: "quota_exhausted", available: false, retryable: false });
    expect(classify({ executionStatus: "rate_limited", normalizedItems: 0 })).toEqual({ state: "rate_limited", available: false, retryable: true });
    expect(classify({ executionStatus: "budget_limited", normalizedItems: 0 })).toEqual({ state: "budget_limited", available: false, retryable: false });
  });
});
