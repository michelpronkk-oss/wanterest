import "server-only";

import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { z } from "zod";

const sessionEnvironmentSchema = z.object({
  url: z.string().url(),
  anonKey: z.string().min(1),
});

const serviceEnvironmentSchema = z.object({
  url: z.string().url(),
  serviceRoleKey: z.string().min(1),
});

const productionProjectHost = "hudjhlkbizngahpadqpt.supabase.co";

function isPublicPreviewDeployment() {
  return process.env.VERCEL === "1" && process.env.VERCEL_ENV === "preview";
}

export function isAdminAuthConfigured() {
  const env = getSupabaseEnvironment();
  return !isPublicPreviewDeployment() && Boolean(env && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export function getAdminAuthRecoveryRedirectUrl() {
  const value = process.env.ADMIN_AUTH_RECOVERY_REDIRECT_URL;
  const parsed = z.string().url().safeParse(value);
  return parsed.success ? parsed.data : null;
}

function getSupabaseEnvironment() {
  const parsed = sessionEnvironmentSchema.safeParse({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });
  if (!parsed.success || new URL(parsed.data.url).hostname !== productionProjectHost) return null;
  return parsed.data;
}

export async function createAdminSessionClient() {
  if (isPublicPreviewDeployment()) return null;
  const env = getSupabaseEnvironment();
  if (!env) return null;
  const cookieStore = await cookies();
  return createServerClient(env.url, env.anonKey, {
    cookies: {
      getAll() { return cookieStore.getAll(); },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
        } catch {
          // Server Components cannot write cookies; the session is refreshed by auth actions.
        }
      },
    },
  });
}

export function createAdminServiceClient() {
  if (isPublicPreviewDeployment()) return null;
  const parsed = serviceEnvironmentSchema.safeParse({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  });
  const env = parsed.success ? parsed.data : null;
  if (!env || new URL(env.url).hostname !== productionProjectHost) return null;
  return createClient(env.url, env.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { headers: { "x-application-name": "wanterest-admin" } },
  });
}
