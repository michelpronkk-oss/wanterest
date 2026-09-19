import type { SupabaseClient, User } from "@supabase/supabase-js";

import type { Database } from "@/server/db/database.types";
import { AppError } from "@/server/lib/errors";
import { createSupabaseServerClient } from "@/server/providers/supabase/server";

type AuthClient = SupabaseClient<Database>;

export async function getCurrentUser(client?: AuthClient): Promise<User | null> {
  const supabase = client ?? (await createSupabaseServerClient());
  const { data, error } = await supabase.auth.getUser();

  if (error) {
    if (error.name === "AuthSessionMissingError") return null;
    throw new AppError("INTERNAL_ERROR", "Authentication could not be verified.");
  }

  return data.user;
}

export async function requireUser(client?: AuthClient): Promise<User> {
  const user = await getCurrentUser(client);
  if (!user) {
    throw new AppError("UNAUTHENTICATED", "Authentication is required.");
  }
  return user;
}
