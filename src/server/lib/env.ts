import { z } from "zod";

import { publicEnvSchema } from "../../shared/config/public-env";

const optionalServerString = z.preprocess((value) => value === "" ? undefined : value, z.string().min(1).optional());
const optionalServerUrl = z.preprocess((value) => value === "" ? undefined : value, z.string().url().optional());

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
  });
}

export const envSchemas = { publicEnvSchema, serverEnvSchema };
