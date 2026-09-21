import { createServerClient } from "@supabase/ssr";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { getPublicEnv } from "@/server/lib/env";
import type { Database } from "@/server/db/database.types";

export async function updateSupabaseSession(request: NextRequest) {
  const response = NextResponse.next({ request });
  const { NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY } = getPublicEnv();

  const supabase = createServerClient<Database>(
    NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            request.cookies.set(name, value);
            response.cookies.set(name, value, options);
          });
        },
      },
    },
  );

  // Server Actions validate the caller inside the action/service boundary.
  // Running a second auth.getUser() in proxy for every narrow polling POST
  // doubles provider traffic and can rotate the same SSR cookies concurrently.
  // Let the action's server client perform the authoritative check and cookie
  // refresh for this request.
  if (request.method === "POST" && request.headers.has("Next-Action")) {
    return response;
  }

  // Supabase recommends this call here so refreshed auth cookies are copied to
  // the response. A provider rate limit or network failure must not turn into
  // a redirect or a synthetic unauthenticated response; the server render will
  // classify the same failure explicitly if it cannot verify the session.
  try {
    await supabase.auth.getUser();
  } catch {
    // Keep the request moving. Do not log provider payloads or auth material.
  }
  return response;
}
