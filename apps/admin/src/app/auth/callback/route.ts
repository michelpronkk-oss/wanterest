import { NextResponse, type NextRequest } from "next/server";
import { isAdminHostnameRequest } from "@admin/server/request";
import { createAdminSessionClient } from "@admin/server/supabase";

export async function GET(request: NextRequest) {
  if (!await isAdminHostnameRequest()) return new NextResponse(null, { status: 404, headers: { "Cache-Control": "private, no-store, max-age=0", "X-Robots-Tag": "noindex, nofollow, noarchive" } });
  const code = request.nextUrl.searchParams.get("code");
  const next = request.nextUrl.searchParams.get("next");
  const safeNext = next === "/recover" ? next : "/login?error=recovery";
  const session = await createAdminSessionClient();
  if (!code || !session) return NextResponse.redirect(new URL("/login?error=recovery", request.url));
  const { error } = await session.auth.exchangeCodeForSession(code);
  const response = NextResponse.redirect(new URL(error ? "/login?error=recovery" : safeNext, request.url));
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  return response;
}
