import { NextResponse } from "next/server";

import { isAdminHostnameRequest } from "@admin/server/request";

export const dynamic = "force-dynamic";

export async function GET() {
  const headers = {
    "Cache-Control": "private, no-store, max-age=0",
    "Content-Type": "text/plain; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    "X-Robots-Tag": "noindex, nofollow, noarchive",
  };

  if (!await isAdminHostnameRequest()) return new NextResponse(null, { status: 404, headers });

  return new NextResponse("User-agent: *\nDisallow: /\n", { status: 200, headers });
}
