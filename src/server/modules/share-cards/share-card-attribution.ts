import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

import { getServerEnv } from "@/server/lib/env";
import { recordShareCardEventCommand } from "./share-card.commands";
import type { ShareCardEventType } from "./share-card.schemas";

export const SHARE_CARD_ATTRIBUTION_COOKIE = "wanterest_share_attribution";
export const SHARE_CARD_ATTRIBUTION_TTL_SECONDS = 30 * 24 * 60 * 60;

const publicSlugPattern = /^[A-Za-z0-9_-]{32,96}$/;

function secret(secretOverride?: string): string {
  return secretOverride ?? getServerEnv().SUPABASE_SERVICE_ROLE_KEY;
}

function signature(payload: string, secretOverride?: string): string {
  return createHmac("sha256", secret(secretOverride)).update(payload).digest("base64url");
}

export function createShareCardAttributionToken(
  publicSlug: string,
  now = Date.now(),
  secretOverride?: string,
): string | null {
  if (!publicSlugPattern.test(publicSlug)) return null;
  const expiresAt = Math.floor(now / 1000) + SHARE_CARD_ATTRIBUTION_TTL_SECONDS;
  const payload = `${expiresAt}.${publicSlug}`;
  return `${payload}.${signature(payload, secretOverride)}`;
}

export function verifyShareCardAttributionToken(
  token: string | null | undefined,
  now = Date.now(),
  secretOverride?: string,
): string | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [expiresAtText, publicSlug, providedSignature] = parts;
  const expiresAt = Number(expiresAtText);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Math.floor(now / 1000) || !publicSlugPattern.test(publicSlug ?? "")) return null;
  const expected = signature(`${expiresAtText}.${publicSlug}`, secretOverride);
  const left = Buffer.from(providedSignature ?? "");
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null;
  return publicSlug;
}

export async function readShareCardAttribution(): Promise<string | null> {
  try {
    const cookieStore = await cookies();
    return verifyShareCardAttributionToken(cookieStore.get(SHARE_CARD_ATTRIBUTION_COOKIE)?.value);
  } catch {
    // Server actions and tests can run without a request cookie context. A
    // missing context means no attribution, never an authorization failure.
    return null;
  }
}

export async function clearShareCardAttribution(): Promise<void> {
  try {
    const cookieStore = await cookies();
    cookieStore.delete(SHARE_CARD_ATTRIBUTION_COOKIE);
  } catch {
    // Cookie cleanup is best effort; the bounded signed token remains safe.
  }
}

export async function recordShareCardAttributionEvent(eventType: Extract<ShareCardEventType, "signup_completed">): Promise<boolean> {
  const publicSlug = await readShareCardAttribution();
  if (!publicSlug) return false;
  try {
    await recordShareCardEventCommand({ publicSlug, eventType, source: null });
    return true;
  } catch {
    // Analytics is deliberately non-authoritative and cannot block auth.
    return false;
  }
}
