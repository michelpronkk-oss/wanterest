import { SourceAdapterError, type RateLimitMetadata } from "./contracts";

export type SourceFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export function rateLimitFromHeaders(response: Response, provider: string, mode: RateLimitMetadata["mode"] = "public"): RateLimitMetadata {
  const integerHeader = (name: string): number | null => {
    const value = Number(response.headers.get(name) ?? "");
    return Number.isInteger(value) && value >= 0 ? value : null;
  };
  const retryAfter = Number(response.headers.get("retry-after") ?? "");
  const resetUnix = Number(response.headers.get("x-ratelimit-reset") ?? response.headers.get("x-rate-limit-reset") ?? "");
  return {
    provider,
    mode,
    remaining: integerHeader("x-ratelimit-remaining") ?? integerHeader("x-rate-limit-remaining"),
    limit: integerHeader("x-ratelimit-limit") ?? integerHeader("x-rate-limit-limit"),
    retryAfterMs: Number.isFinite(retryAfter) && retryAfter >= 0 ? Math.round(retryAfter * 1000) : null,
    resetAt: Number.isFinite(resetUnix) && resetUnix > 0 ? new Date(resetUnix * 1000).toISOString() : null,
  };
}

export async function fetchJson(
  fetchImpl: SourceFetch,
  url: string | URL,
  options: { provider: string; headers?: HeadersInit; timeoutMs?: number; mode?: RateLimitMetadata["mode"] } ,
): Promise<{ body: unknown; response: Response; rateLimit: RateLimitMetadata }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.min(15_000, Math.max(1_000, options.timeoutMs ?? 8_000)));
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      headers: { Accept: "application/json", ...options.headers },
      signal: controller.signal,
    });
    const rateLimit = rateLimitFromHeaders(response, options.provider, options.mode);
    if (response.status === 429) throw new SourceAdapterError("RATE_LIMITED", `${options.provider} rate limit reached.`, true);
    if (!response.ok) throw new SourceAdapterError(`HTTP_${response.status}`, `${options.provider} request failed.`, response.status >= 500);
    return { body: await response.json(), response, rateLimit };
  } catch (error) {
    if (error instanceof SourceAdapterError) throw error;
    if (error instanceof Error && error.name === "AbortError") throw new SourceAdapterError("TIMEOUT", `${options.provider} request timed out.`, true);
    throw new SourceAdapterError("REQUEST_FAILED", `${options.provider} request could not be completed.`, true);
  } finally {
    clearTimeout(timeout);
  }
}

export function safeProviderMessage(error: unknown, fallback: string): string {
  return error instanceof SourceAdapterError ? error.message : fallback;
}
