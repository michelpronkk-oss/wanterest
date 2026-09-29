import { NextResponse, type NextRequest } from "next/server";

import { resolveAdminHostRequest } from "@admin/host-routing";
import { createAdminProxyResponse } from "@admin/proxy";
import { updateSupabaseSession } from "@/server/providers/supabase/proxy";

export async function proxy(request: NextRequest) {
  const decision = resolveAdminHostRequest({
    hostname: request.headers.get("host")?.split(":", 1)[0] ?? request.nextUrl.hostname,
    pathname: request.nextUrl.pathname,
    isVercel: process.env.VERCEL === "1",
    vercelEnvironment: process.env.VERCEL_ENV,
    allowLocalAdminHost: process.env.NODE_ENV === "development",
  });

  if (decision.kind === "blocked") {
    const response = new NextResponse(null, { status: 404 });
    response.headers.set("Cache-Control", "private, no-store, max-age=0");
    response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
    response.headers.set("X-Content-Type-Options", "nosniff");
    response.headers.set("X-Frame-Options", "DENY");
    return response;
  }

  if (decision.kind === "admin") return createAdminProxyResponse(request, decision.rewritePath);

  return updateSupabaseSession(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
