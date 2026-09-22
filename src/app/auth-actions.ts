"use server";

import { after } from "next/server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { createSupabaseServerClientFromSnapshot } from "@/server/providers/supabase/server";
import { isSupabaseAuthCookieName } from "@/server/providers/supabase/auth-cookie";

export async function logoutAction(): Promise<never> {
  const cookieStore = await cookies();
  const cleanupClient = createSupabaseServerClientFromSnapshot(cookieStore.getAll().map(({ name, value }) => ({ name, value })));

  // Clear the SSR session cookie in the redirect response so the browser cannot
  // render private dashboard content while the provider-side cleanup finishes.
  for (const cookie of cookieStore.getAll()) {
    if (isSupabaseAuthCookieName(cookie.name)) cookieStore.delete(cookie.name);
  }

  // Keep the existing local sign-out semantics, but do not make the user wait
  // for the provider round trip before receiving the redirect.
  after(async () => {
    try {
      await cleanupClient.auth.signOut({ scope: "local" });
    } catch {
      // The SSR cookies are already gone; a transient provider failure must not
      // leave the user looking at a stale authenticated UI.
    }
  });

  redirect("/login");
}
