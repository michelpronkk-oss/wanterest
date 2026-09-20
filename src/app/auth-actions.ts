"use server";

import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "@/server/providers/supabase/server";

export async function logoutAction(): Promise<never> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut({ scope: "local" });
  redirect("/login");
}
