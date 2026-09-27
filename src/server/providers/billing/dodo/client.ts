import DodoPayments, { type ClientOptions } from "dodopayments";

export type DodoEnvironment = "live_mode" | "test_mode";

export type DodoClientConfig = {
  apiKey: string;
  environment?: DodoEnvironment;
  baseUrl?: string;
  fetcher?: typeof fetch;
  timeoutMs?: number;
};

/**
 * One server-provider construction boundary for the official Dodo SDK. This
 * module lives under src/server and is imported only by server billing code;
 * a caller
 * must provide either an explicit environment or an explicit base URL; the
 * SDK's live-mode default is never accepted implicitly by Wanterest.
 */
export function createDodoClient(config: DodoClientConfig): DodoPayments {
  if (!config.apiKey.trim()) throw new Error("Dodo API key is required.");
  const options: ClientOptions = {
    bearerToken: config.apiKey,
    maxRetries: 0,
    ...(config.fetcher ? { fetch: config.fetcher } : {}),
    ...(config.timeoutMs ? { timeout: config.timeoutMs } : {}),
  };

  const baseUrl = config.baseUrl?.trim();
  if (baseUrl) {
    return new DodoPayments({ ...options, baseURL: baseUrl });
  }
  if (!config.environment) throw new Error("Dodo environment is required when no base URL is configured.");
  return new DodoPayments({ ...options, environment: config.environment });
}

