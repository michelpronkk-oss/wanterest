import "server-only";

import { createClient } from "@supabase/supabase-js";

import { getServerEnv } from "@/server/lib/env";
import type { Database } from "@/server/db/database.types";

export function createSupabaseServiceClient() {
  const { NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = getServerEnv();

  return createClient<Database>(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}
