import "server-only";

import { cookies } from "next/headers";

import type { ShareAvailability } from "@/components/waitlist/share-my-place";
import { createWaitlistService } from "@/server/modules/waitlist";
import { WAITLIST_STATUS_COOKIE } from "@/server/modules/waitlist/waitlist.session";

/** The private status credential lives only in the HttpOnly cookie (path=/waitlist) set by /waitlist/verify — never the URL. */
export async function readStatusToken(): Promise<string> {
  return (await cookies()).get(WAITLIST_STATUS_COOKIE)?.value ?? "";
}

/** Returns null for no token or an unrecognised token. */
export async function loadPrivateStatus(token?: string) {
  token ??= await readStatusToken();
  if (!token) return null;
  try {
    const status = await createWaitlistService().statusWithReferral(token);
    return { token, ...status };
  } catch {
    return null;
  }
}

/**
 * The 13B share-card migrations are intentionally excluded from this F1 release.
 * Keep the optional UI truthful and isolated from the private status flow until
 * its separately validated production rollout is complete.
 */
export async function loadShareAvailability(): Promise<ShareAvailability> {
  return { available: false };
}
