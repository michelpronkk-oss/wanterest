import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { getPublicEnv } from "@/server/lib/env";
import type { Database } from "@/server/db/database.types";

type CookieSnapshot = Array<{ name: string; value: string }>;

function createClientWithCookies(getAll: () => CookieSnapshot, setAll: (cookiesToSet: Array<{ name: string; value: string; options?: Record<string, unknown> }>) => void) {
  const { NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY } = getPublicEnv();

  return createServerClient<Database>(NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll,
      setAll,
    },
  });
}

export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  return createClientWithCookies(
    () => cookieStore.getAll(),
    (cookiesToSet) => {
      try {
        cookiesToSet.forEach(({ name, value, options }) => {
          cookieStore.set(name, value, options);
        });
      } catch {
        // Server Components cannot mutate cookies. Proxy/Route Handlers refresh them.
      }
    },
  );
}

/** Creates a server client from an immutable request snapshot for deferred work. */
export function createSupabaseServerClientFromSnapshot(snapshot: CookieSnapshot) {
  return createClientWithCookies(() => snapshot, () => undefined);
}
