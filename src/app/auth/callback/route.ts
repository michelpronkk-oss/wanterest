import { NextResponse } from "next/server";

import { createSupabaseServerClient } from "@/server/providers/supabase/server";
import { safeInternalPath } from "@/shared/config/site";
import { tryNormalizePublicWebsiteUrl } from "@/shared/validation/public-website";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const next = safeInternalPath(requestUrl.searchParams.get("next"));
  const websiteUrl = tryNormalizePublicWebsiteUrl(requestUrl.searchParams.get("website"));

  if (code) {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.exchangeCodeForSession(code);
  }

  const destination = new URL(next, requestUrl.origin);
  if (websiteUrl && destination.pathname === "/start") destination.searchParams.set("website", websiteUrl);
  return NextResponse.redirect(destination);
}
