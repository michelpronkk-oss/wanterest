import { describe, expect, it } from "vitest";

import { envSchemas } from "../../src/server/lib/env";

describe("environment contracts", () => {
  it("requires public Supabase URL and anonymous key", () => {
    expect(
      envSchemas.publicEnvSchema.safeParse({
        NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
      }).success,
    ).toBe(true);
    expect(envSchemas.publicEnvSchema.safeParse({}).success).toBe(false);
  });

  it("requires the service role key only for server configuration", () => {
    const publicValues = {
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
    };
    expect(envSchemas.serverEnvSchema.safeParse(publicValues).success).toBe(false);
    expect(
      envSchemas.serverEnvSchema.safeParse({
        ...publicValues,
        SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
      }).success,
    ).toBe(true);
  });
});
