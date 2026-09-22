import { NextResponse } from "next/server";

import { createSupabaseServerClient } from "@/server/providers/supabase/server";
import { authCallbackErrorPath, isRecoveryCallbackPath } from "@/shared/auth/callback";
import { safeInternalPath } from "@/shared/config/site";
import { tryNormalizePublicWebsiteUrl } from "@/shared/validation/public-website";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const next = safeInternalPath(requestUrl.searchParams.get("next"));
  const websiteUrl = tryNormalizePublicWebsiteUrl(requestUrl.searchParams.get("website"));
  const providerError = requestUrl.searchParams.get("error") || requestUrl.searchParams.get("error_code") || requestUrl.searchParams.get("error_description");

  if (providerError || (isRecoveryCallbackPath(next) && !code)) {
    return redirectToCallbackError(requestUrl, next, "invalid_link", websiteUrl);
  }

  if (code) {
    try {
      const supabase = await createSupabaseServerClient();
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) return redirectToCallbackError(requestUrl, next, "invalid_link", websiteUrl);
    } catch {
      return redirectToCallbackError(requestUrl, next, "temporarily_unavailable", websiteUrl);
    }
  }

  const destination = new URL(next, requestUrl.origin);
  if (websiteUrl && destination.pathname === "/start") destination.searchParams.set("website", websiteUrl);
  return NextResponse.redirect(destination);
}

function redirectToCallbackError(
  requestUrl: URL,
  next: string,
  error: "invalid_link" | "temporarily_unavailable",
  websiteUrl: string | null,
) {
  return NextResponse.redirect(new URL(authCallbackErrorPath(next, error, websiteUrl), requestUrl.origin));
}
