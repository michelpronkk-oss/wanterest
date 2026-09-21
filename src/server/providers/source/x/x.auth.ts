import { z } from "zod";

const runtimeSchema = z.object({
  X_BEARER_TOKEN: z.preprocess((value) => value === "" ? undefined : value, z.string().min(1).optional()),
  X_API_BASE_URL: z.preprocess((value) => value === "" ? undefined : value, z.string().url().optional()),
  X_MAX_POSTS_PER_SCAN: z.preprocess((value) => value === "" ? undefined : value, z.coerce.number().int().positive().optional()),
  X_POST_READ_COST_USD: z.preprocess((value) => value === "" ? undefined : value, z.coerce.number().nonnegative().optional()),
  X_COST_CONFIG_VERSION: z.preprocess((value) => value === "" ? undefined : value, z.string().min(1).optional()),
});

export type XRuntimeConfig = {
  token?: string;
  apiBaseUrl: string;
  maxPostsPerScan: number;
  postReadCostUsd: number;
  costConfigVersion: string;
};

function assertOfficialBaseUrl(value: string): string {
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" || !["api.x.com", "api.twitter.com"].includes(parsed.hostname) || !["", "/"].includes(parsed.pathname)) {
    throw new Error("X API base URL must be an official HTTPS X API host.");
  }
  return `https://${parsed.hostname}`;
}

export function getXRuntimeConfig(env: Record<string, string | undefined> = process.env): XRuntimeConfig {
  const parsed = runtimeSchema.safeParse({
    X_BEARER_TOKEN: env.X_BEARER_TOKEN,
    X_API_BASE_URL: env.X_API_BASE_URL,
    X_MAX_POSTS_PER_SCAN: env.X_MAX_POSTS_PER_SCAN,
    X_POST_READ_COST_USD: env.X_POST_READ_COST_USD,
    X_COST_CONFIG_VERSION: env.X_COST_CONFIG_VERSION,
  });
  if (!parsed.success) throw new Error(`Invalid X configuration: ${parsed.error.message}`);
  return {
    token: parsed.data.X_BEARER_TOKEN,
    apiBaseUrl: assertOfficialBaseUrl(parsed.data.X_API_BASE_URL ?? "https://api.x.com"),
    maxPostsPerScan: Math.max(10, Math.min(parsed.data.X_MAX_POSTS_PER_SCAN ?? 10, 1_000)),
    postReadCostUsd: parsed.data.X_POST_READ_COST_USD ?? 0.005,
    costConfigVersion: parsed.data.X_COST_CONFIG_VERSION ?? "x-post-read-v1",
  };
}
