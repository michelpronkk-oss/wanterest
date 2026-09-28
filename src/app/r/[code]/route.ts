import { NextResponse } from "next/server";

import { waitlistReferralCodeSchema } from "@/server/modules/waitlist";
import { getProductAccessState } from "@/server/modules/access";

const attributionKeys = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"] as const;

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ code: string }> }) {
  const { code: rawCode } = await context.params;
  let code = "";
  try {
    code = decodeURIComponent(rawCode);
  } catch {
    // Malformed path encoding degrades to the ordinary waitlist page.
  }
  // Referral links remain resolvable after launch, but OPEN freezes new
  // referral credit. A transient read failure keeps the pre-launch route
  // conservative rather than granting public-launch semantics.
  const access = await getProductAccessState().catch(() => null);
  const target = new URL(access?.mode === "open" ? "/signup" : "/waitlist", request.url);
  const parsed = waitlistReferralCodeSchema.safeParse(code);
  if (parsed.success && access?.mode !== "open") {
    target.searchParams.set("ref", parsed.data);
    target.searchParams.set("source", "referral");
    for (const key of attributionKeys) {
      const value = new URL(request.url).searchParams.get(key)?.trim().slice(0, 160);
      if (value) target.searchParams.set(key, value);
    }
  } else if (parsed.success && access?.mode === "open") {
    target.searchParams.set("source", "referral");
  }
  return NextResponse.redirect(target, {
    status: 303,
    headers: { "cache-control": "no-store", "referrer-policy": "no-referrer" },
  });
}
