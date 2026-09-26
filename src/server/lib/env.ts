import { z } from "zod";

import { publicEnvSchema } from "../../shared/config/public-env";

const optionalServerString = z.preprocess((value) => value === "" ? undefined : value, z.string().min(1).optional());
const optionalServerUrl = z.preprocess((value) => value === "" ? undefined : value, z.string().url().optional());
const optionalServerPositiveInt = z.preprocess((value) => value === "" ? undefined : value, z.coerce.number().int().positive().optional());
const optionalServerNonnegativeNumber = z.preprocess((value) => value === "" ? undefined : value, z.coerce.number().nonnegative().optional());

const serverEnvSchema = publicEnvSchema.extend({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  DODO_PAYMENTS_API_KEY: optionalServerString,
  DODO_WEBHOOK_SECRET: optionalServerString,
  DODO_PAYMENTS_ENVIRONMENT: z.enum(["test_mode", "live_mode"]).default("test_mode"),
  DODO_API_BASE_URL: optionalServerUrl,
  DODO_PRODUCT_PRO_MONTHLY: optionalServerString,
  DODO_PRODUCT_PRO_ANNUAL: optionalServerString,
  DODO_PRODUCT_GROWTH_MONTHLY: optionalServerString,
  DODO_PRODUCT_GROWTH_ANNUAL: optionalServerString,
  REDDIT_CLIENT_ID: optionalServerString,
  REDDIT_CLIENT_SECRET: optionalServerString,
  REDDIT_USER_AGENT: optionalServerString,
  REDDIT_API_BASE_URL: optionalServerUrl,
  REDDIT_AUTH_BASE_URL: optionalServerUrl,
  GITHUB_TOKEN: optionalServerString,
  X_BEARER_TOKEN: optionalServerString,
  X_API_BASE_URL: optionalServerUrl,
  X_MAX_POSTS_PER_SCAN: optionalServerPositiveInt,
  X_POST_READ_COST_USD: optionalServerNonnegativeNumber,
  X_COST_CONFIG_VERSION: optionalServerString,
  OPENAI_API_KEY: optionalServerString,
  OPENAI_MODEL: optionalServerString,
  TRIGGER_SECRET_KEY: optionalServerString,
  TRIGGER_LOCAL_EXECUTION: z.enum(["direct", "remote"]).default("remote"),
  RESEND_API_KEY: optionalServerString,
  RESEND_FROM_EMAIL: optionalServerString,
  // Temporary internal validation mechanism — see src/server/modules/operations/internal-scan-bypass.ts.
  // Comma-separated workspace UUIDs. Leave blank in normal environments.
  INTERNAL_SCAN_COOLDOWN_BYPASS_WORKSPACE_IDS: optionalServerString,
  INTERNAL_X_DISCOVERY_WORKSPACE_IDS: optionalServerString,
  INTERNAL_X_MAX_POSTS_PER_SCAN: optionalServerPositiveInt,
  INTERNAL_X_MAX_QUERIES_PER_SCAN: optionalServerPositiveInt,
  DISCOVERY_COVERAGE_V1_ENABLED: z.enum(["true", "false"]).optional(),
  DISCOVERY_COVERAGE_V1_WORKSPACE_IDS: optionalServerString,
  DISCOVERY_COVERAGE_V1_MAX_SOURCES: optionalServerPositiveInt,
  DISCOVERY_COVERAGE_V1_MAX_QUERIES: optionalServerPositiveInt,
  DISCOVERY_COVERAGE_V1_MAX_CANDIDATES: optionalServerPositiveInt,
  READ_FIRST_FRESH_HOURS: optionalServerPositiveInt,
  READ_FIRST_RECENT_HOURS: optionalServerPositiveInt,
  // Stage 2C kill switch for the autonomous market-partition refresh scheduler.
  // Defaults to disabled (treated as "false" unless exactly "true").
  MARKET_PARTITION_REFRESH_ENABLED: z.enum(["true", "false"]).optional(),
  // Stage 2D kill switch for incremental product matching after a successful
  // partition refresh. Defaults to disabled unless exactly "true".
  INCREMENTAL_PRODUCT_MATCHING_ENABLED: z.enum(["true", "false"]).optional(),
  // Stage 2G kill switch for product-private demand clustering/strengthening
  // during demand rebuilds. Defaults to disabled unless exactly "true".
  DEMAND_CLUSTERING_ENABLED: z.enum(["true", "false"]).optional(),
  // Layer 9A: cluster-led Demand Map / Overview market state (read-only).
  // Defaults to the legacy view unless exactly "true".
  DEMAND_MAP_V2_ENABLED: z.enum(["true", "false"]).optional(),
  // Layer 9B: lifecycle-aware Gap/Drift v2, paused legacy Action generation,
  // lifecycle-filtered Digests. Read in both Vercel and Trigger. Defaults off.
  DOWNSTREAM_INTELLIGENCE_V2_ENABLED: z.enum(["true", "false"]).optional(),
  // Layer 9C: persisted, append-only concept market/gap/drift state materialization.
  // Read by Trigger only (the rebuild path). Defaults off.
  CONCEPT_MARKET_STATE_ENABLED: z.enum(["true", "false"]).optional(),
  // Layer 9C: concept-based Action generation (requires DOWNSTREAM_INTELLIGENCE_V2_ENABLED
  // and materialized state to do anything). Defaults off.
  CONCEPT_ACTIONS_ENABLED: z.enum(["true", "false"]).optional(),
  // Layer 9D: lifecycle-aware current Geography (read-only). Read only by the
  // Geography page's server component; no Trigger task executes this path.
  // Defaults off.
  GEOGRAPHY_V2_ENABLED: z.enum(["true", "false"]).optional(),
  // Layer 11: experiment measurement v1. Gates only NEW work (create, draft edits,
  // mark ready, starting a ready experiment's treatment); never blocks draining
  // (public events, manual measurement observations, the measurement pass).
  // Read in both Vercel and Trigger. Defaults off.
  EXPERIMENT_MEASUREMENT_ENABLED: z.enum(["true", "false"]).optional(),
  // Layer 12A.1: signal supply telemetry facts (observational only; never
  // changes discovery, selection, qualification or clustering). Trigger. Defaults off.
  SIGNAL_SUPPLY_TELEMETRY_ENABLED: z.enum(["true", "false"]).optional(),
  // Layer 12A.2: planner-seeded shared market partitions + explicit partition
  // interests (persistence only; no extra foreground provider/model calls).
  // Read in Vercel and Trigger (scans run in both). Defaults off.
  SUPPLY_PARTITION_SEEDING_ENABLED: z.enum(["true", "false"]).optional(),
});

export type PublicEnv = z.infer<typeof publicEnvSchema>;
export type ServerEnv = z.infer<typeof serverEnvSchema>;

function parseOrThrow<T>(schema: z.ZodType<T>, values: Record<string, string | undefined>): T {
  const result = schema.safeParse(values);
  if (!result.success) {
    throw new Error(`Invalid environment configuration: ${result.error.message}`);
  }
  return result.data;
}

export function getPublicEnv(): PublicEnv {
  return parseOrThrow(publicEnvSchema, {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });
}

export function getServerEnv(): ServerEnv {
  return parseOrThrow(serverEnvSchema, {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    DODO_PAYMENTS_API_KEY: process.env.DODO_PAYMENTS_API_KEY,
    DODO_WEBHOOK_SECRET: process.env.DODO_WEBHOOK_SECRET,
    DODO_PAYMENTS_ENVIRONMENT: process.env.DODO_PAYMENTS_ENVIRONMENT,
    DODO_API_BASE_URL: process.env.DODO_API_BASE_URL,
    DODO_PRODUCT_PRO_MONTHLY: process.env.DODO_PRODUCT_PRO_MONTHLY,
    DODO_PRODUCT_PRO_ANNUAL: process.env.DODO_PRODUCT_PRO_ANNUAL,
    DODO_PRODUCT_GROWTH_MONTHLY: process.env.DODO_PRODUCT_GROWTH_MONTHLY,
    DODO_PRODUCT_GROWTH_ANNUAL: process.env.DODO_PRODUCT_GROWTH_ANNUAL,
    REDDIT_CLIENT_ID: process.env.REDDIT_CLIENT_ID,
    REDDIT_CLIENT_SECRET: process.env.REDDIT_CLIENT_SECRET,
    REDDIT_USER_AGENT: process.env.REDDIT_USER_AGENT,
    REDDIT_API_BASE_URL: process.env.REDDIT_API_BASE_URL,
    REDDIT_AUTH_BASE_URL: process.env.REDDIT_AUTH_BASE_URL,
    GITHUB_TOKEN: process.env.GITHUB_TOKEN,
    X_BEARER_TOKEN: process.env.X_BEARER_TOKEN,
    X_API_BASE_URL: process.env.X_API_BASE_URL,
    X_MAX_POSTS_PER_SCAN: process.env.X_MAX_POSTS_PER_SCAN,
    X_POST_READ_COST_USD: process.env.X_POST_READ_COST_USD,
    X_COST_CONFIG_VERSION: process.env.X_COST_CONFIG_VERSION,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENAI_MODEL: process.env.OPENAI_MODEL,
    TRIGGER_SECRET_KEY: process.env.TRIGGER_SECRET_KEY,
    TRIGGER_LOCAL_EXECUTION: process.env.TRIGGER_LOCAL_EXECUTION,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    RESEND_FROM_EMAIL: process.env.RESEND_FROM_EMAIL,
    INTERNAL_SCAN_COOLDOWN_BYPASS_WORKSPACE_IDS: process.env.INTERNAL_SCAN_COOLDOWN_BYPASS_WORKSPACE_IDS,
    INTERNAL_X_DISCOVERY_WORKSPACE_IDS: process.env.INTERNAL_X_DISCOVERY_WORKSPACE_IDS,
    INTERNAL_X_MAX_POSTS_PER_SCAN: process.env.INTERNAL_X_MAX_POSTS_PER_SCAN,
    INTERNAL_X_MAX_QUERIES_PER_SCAN: process.env.INTERNAL_X_MAX_QUERIES_PER_SCAN,
    DISCOVERY_COVERAGE_V1_ENABLED: process.env.DISCOVERY_COVERAGE_V1_ENABLED,
    DISCOVERY_COVERAGE_V1_WORKSPACE_IDS: process.env.DISCOVERY_COVERAGE_V1_WORKSPACE_IDS,
    DISCOVERY_COVERAGE_V1_MAX_SOURCES: process.env.DISCOVERY_COVERAGE_V1_MAX_SOURCES,
    DISCOVERY_COVERAGE_V1_MAX_QUERIES: process.env.DISCOVERY_COVERAGE_V1_MAX_QUERIES,
    DISCOVERY_COVERAGE_V1_MAX_CANDIDATES: process.env.DISCOVERY_COVERAGE_V1_MAX_CANDIDATES,
    READ_FIRST_FRESH_HOURS: process.env.READ_FIRST_FRESH_HOURS,
    READ_FIRST_RECENT_HOURS: process.env.READ_FIRST_RECENT_HOURS,
    MARKET_PARTITION_REFRESH_ENABLED: process.env.MARKET_PARTITION_REFRESH_ENABLED,
    INCREMENTAL_PRODUCT_MATCHING_ENABLED: process.env.INCREMENTAL_PRODUCT_MATCHING_ENABLED,
    DEMAND_CLUSTERING_ENABLED: process.env.DEMAND_CLUSTERING_ENABLED,
    DEMAND_MAP_V2_ENABLED: process.env.DEMAND_MAP_V2_ENABLED,
    DOWNSTREAM_INTELLIGENCE_V2_ENABLED: process.env.DOWNSTREAM_INTELLIGENCE_V2_ENABLED,
    CONCEPT_MARKET_STATE_ENABLED: process.env.CONCEPT_MARKET_STATE_ENABLED,
    CONCEPT_ACTIONS_ENABLED: process.env.CONCEPT_ACTIONS_ENABLED,
    GEOGRAPHY_V2_ENABLED: process.env.GEOGRAPHY_V2_ENABLED,
    EXPERIMENT_MEASUREMENT_ENABLED: process.env.EXPERIMENT_MEASUREMENT_ENABLED,
    SIGNAL_SUPPLY_TELEMETRY_ENABLED: process.env.SIGNAL_SUPPLY_TELEMETRY_ENABLED,
    SUPPLY_PARTITION_SEEDING_ENABLED: process.env.SUPPLY_PARTITION_SEEDING_ENABLED,
  });
}

export const envSchemas = { publicEnvSchema, serverEnvSchema };
