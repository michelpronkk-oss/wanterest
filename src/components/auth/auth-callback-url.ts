import { runtimeAppOrigin, safeInternalPath } from "../../shared/config/site";

/** Builds the /auth/callback URL Supabase email links (signup confirmation, password reset) redirect to. */
export function authCallbackUrl(next: string, websiteUrl: string | null = null): string {
  const url = new URL("/auth/callback", runtimeAppOrigin());
  url.searchParams.set("next", safeInternalPath(next));
  if (websiteUrl) url.searchParams.set("website", websiteUrl);
  return url.toString();
}
