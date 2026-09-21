import { cache } from "react";
import type { SupabaseClient, User } from "@supabase/supabase-js";

import type { Database } from "@/server/db/database.types";
import { AppError } from "@/server/lib/errors";
import { createSupabaseServerClient } from "@/server/providers/supabase/server";
import { authProviderErrorMetadata, classifyAuthProviderError } from "./auth.errors";

type AuthClient = SupabaseClient<Database>;

function handleAuthProviderError(error: unknown): null {
  if (classifyAuthProviderError(error) === "unauthenticated") {
    return null;
  }

  if (process.env.NODE_ENV !== "production") {
    console.warn("[auth] Supabase session verification temporarily unavailable.", authProviderErrorMetadata(error));
  }
  throw new AppError("AUTH_TRANSIENT", "We could not verify your session right now. Please try again in a moment.");
}

async function resolveCurrentUser(client?: AuthClient): Promise<User | null> {
  const supabase = client ?? (await createSupabaseServerClient());
  let data: { user: User | null };
  let error: unknown;

  try {
    ({ data, error } = await supabase.auth.getUser());
  } catch (providerError) {
    return handleAuthProviderError(providerError);
  }

  if (error) return handleAuthProviderError(error);
  return data.user;
}

// React cache is request-scoped in the server render context. This avoids
// repeated auth.getUser calls from nested layouts, pages, and repositories
// without creating a process-global user cache.
const getCachedCurrentUser = cache(async () => resolveCurrentUser());

export async function getCurrentUser(client?: AuthClient): Promise<User | null> {
  return client ? resolveCurrentUser(client) : getCachedCurrentUser();
}

export async function requireUser(client?: AuthClient): Promise<User> {
  const user = await getCurrentUser(client);
  if (!user) {
    throw new AppError("UNAUTHENTICATED", "Authentication is required.");
  }
  return user;
}
