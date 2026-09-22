import { APP_ORIGIN } from "@/shared/config/site";

/** Builds the /auth/callback URL Supabase email links (signup confirmation, password reset) redirect to. */
export function authCallbackUrl(next: string, websiteUrl: string | null = null): string {
  const url = new URL("/auth/callback", APP_ORIGIN);
  url.searchParams.set("next", next);
  if (websiteUrl) url.searchParams.set("website", websiteUrl);
  return url.toString();
}
