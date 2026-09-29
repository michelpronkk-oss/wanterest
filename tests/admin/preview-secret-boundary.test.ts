import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@supabase/ssr", () => ({ createServerClient: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn() }));

const original = {
  VERCEL: process.env.VERCEL,
  VERCEL_ENV: process.env.VERCEL_ENV,
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
};

afterEach(() => {
  for (const [key, value] of Object.entries(original)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.clearAllMocks();
});

describe("public Vercel Preview credential boundary", () => {
  it("never creates an Auth or service client even if production env vars are attached", async () => {
    process.env.VERCEL = "1";
    process.env.VERCEL_ENV = "preview";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "public-anon-key";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "must-not-be-used";

    const { createAdminSessionClient, createAdminServiceClient, isAdminAuthConfigured } = await import("../../apps/admin/src/server/supabase");
    expect(isAdminAuthConfigured()).toBe(false);
    await expect(createAdminSessionClient()).resolves.toBeNull();
    expect(createAdminServiceClient()).toBeNull();
    expect(vi.mocked(await import("@supabase/ssr")).createServerClient).not.toHaveBeenCalled();
    expect(vi.mocked(await import("@supabase/supabase-js")).createClient).not.toHaveBeenCalled();
  });

  it("fails closed for every Vercel environment except production", async () => {
    process.env.VERCEL = "1";
    process.env.VERCEL_ENV = "development";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://hudjhlkbizngahpadqpt.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "public-anon-key";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "must-not-be-used";

    const { createAdminSessionClient, createAdminServiceClient, isAdminAuthConfigured } = await import("../../apps/admin/src/server/supabase");
    expect(isAdminAuthConfigured()).toBe(false);
    await expect(createAdminSessionClient()).resolves.toBeNull();
    expect(createAdminServiceClient()).toBeNull();
  });

  it("accepts admin database clients only for the existing production project", async () => {
    process.env.VERCEL = "0";
    process.env.VERCEL_ENV = "development";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://another-project.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "public-anon-key";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "server-only-key";

    const { createAdminSessionClient, createAdminServiceClient, isAdminAuthConfigured } = await import("../../apps/admin/src/server/supabase");
    expect(isAdminAuthConfigured()).toBe(false);
    await expect(createAdminSessionClient()).resolves.toBeNull();
    expect(createAdminServiceClient()).toBeNull();
  });
});
