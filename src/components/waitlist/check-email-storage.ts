/**
 * Carries the just-submitted payload from the form to the dedicated /waitlist/check-email screen
 * so "Resend" can replay the exact same request. Deliberately sessionStorage, not a URL query
 * param or a server session: the backend sets no cookie until after verification (by design,
 * this boundary must not become an email-enumeration oracle), so there is no real server-side
 * "pending" session to read back. sessionStorage survives a same-tab refresh, which is what
 * "refreshing the page must behave safely" requires; a fresh tab or cleared storage safely falls
 * back to a generic, non-personalized confirmation rather than fabricating one.
 */
const STORAGE_KEY = "wanterest_waitlist_pending_v1";

export type PendingWaitlistSubmission = {
  email: string;
  payload: Record<string, unknown>;
};

export function storePendingSubmission(email: string, payload: Record<string, unknown>): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ email, payload } satisfies PendingWaitlistSubmission));
  } catch {
    // Storage can be unavailable (private browsing, quota). The check-email page degrades
    // gracefully to its generic state in that case — nothing here is load-bearing for security.
  }
}

function readPendingSubmission(): PendingWaitlistSubmission | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PendingWaitlistSubmission>;
    if (typeof parsed.email !== "string" || !parsed.payload || typeof parsed.payload !== "object") return null;
    return { email: parsed.email, payload: parsed.payload };
  } catch {
    return null;
  }
}

/**
 * A useSyncExternalStore-friendly snapshot getter: memoized so repeated calls return the same
 * reference (sessionStorage is written once, before navigating here, and never mutated again
 * during this page's lifetime, so a compute-once cache is correct — not just an optimization).
 * useSyncExternalStore handles the server/client split itself (server snapshot is always null),
 * so this needs no effect and never risks a hydration mismatch.
 */
let cachedSnapshot: PendingWaitlistSubmission | null | undefined;
export function getPendingSubmissionSnapshot(): PendingWaitlistSubmission | null {
  if (cachedSnapshot === undefined) cachedSnapshot = readPendingSubmission();
  return cachedSnapshot;
}
function noopSubscribe(): () => void {
  return () => {};
}
function getServerSnapshot(): null {
  return null;
}
export { noopSubscribe, getServerSnapshot };

export function clearPendingSubmission(): void {
  try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* nothing to clear */ }
}
