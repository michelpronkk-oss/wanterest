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
  });
}

export const envSchemas = { publicEnvSchema, serverEnvSchema };
