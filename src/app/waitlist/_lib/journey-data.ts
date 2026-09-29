import "server-only";

import { cookies } from "next/headers";

import type { ShareAvailability } from "@/components/waitlist/share-my-place";
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
 * Loads the applicant's Board 15 share cards through the 13B.1 engine. Any failure (including the
 * share-card migration not yet being applied) degrades to `available: false`, so the journey never
 * offers a publish control that would error. Eligibility stays with the engine's authority adapter.
 */
export async function loadShareAvailability(token?: string): Promise<ShareAvailability> {
  token ??= await readStatusToken();
  if (!token) return { available: false };
  try {
    return { available: true, cards: await getApplicantShareCardsQuery(token) };
  } catch {
    return { available: false };
  }
}
