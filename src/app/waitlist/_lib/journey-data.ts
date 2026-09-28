import "server-only";

import { cookies } from "next/headers";

import type { ShareAvailability } from "@/components/waitlist/share-my-place";
import type { ShareCardPanelCard } from "@/components/share-cards/share-card-panel";
import { getApplicantShareCardsQuery } from "@/server/modules/share-cards";
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
 * Sharing depends on the Layer 13B.1 share-card schema. Where that isn't available (e.g. the
 * migrations aren't applied in an environment), report it as unavailable rather than as "no
 * cards" — and never let it take the verification/status experience down with it.
 */
export async function loadShareAvailability(token: string): Promise<ShareAvailability> {
  try {
    const cards = await getApplicantShareCardsQuery(token);
    return { available: true, cards: cards as ShareCardPanelCard[] };
  } catch {
    return { available: false };
  }
}
