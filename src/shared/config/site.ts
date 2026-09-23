/**
 * The app hostname is configured once and shared by marketing CTAs, auth
 * callbacks, and the app entry route. NEXT_PUBLIC_APP_URL should be set to
 * https://app.wanterest.com in production; local development falls back to
 * the local Next.js origin.
 */
const configuredAppOrigin = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "");
export const APP_ORIGIN = configuredAppOrigin || (process.env.NODE_ENV === "production" ? "https://app.wanterest.com" : "http://localhost:3000");

const APP_HOSTNAME = new URL(APP_ORIGIN).hostname;
const APP_START_PATH = "/start";

export const APP_START_URL = `${APP_ORIGIN}${APP_START_PATH}`;

/**
 * The canonical, indexable marketing origin. NEXT_PUBLIC_SITE_URL should be set to
 * https://www.wanterest.com in production; local development falls back to the
 * local Next.js origin so metadata/canonicals resolve during `npm run dev`.
 */
const configuredSiteOrigin = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/$/, "");
export const SITE_ORIGIN = configuredSiteOrigin || (process.env.NODE_ENV === "production" ? "https://www.wanterest.com" : "http://localhost:3000");

/** Real, confirmed Wanterest contact/social details. Do not invent alternatives. */
export const SUPPORT_EMAIL = "support@wanterest.com";
export const X_HANDLE = "@wanterestHQ";
export const X_PROFILE_URL = "https://x.com/wanterestHQ";

/** Use the local browser origin for client-side entry links during local development. */
export function runtimeAppOrigin(): string {
  if (typeof window !== "undefined" && /^(localhost|127\.0\.0\.1|\[?::1\]?)$/i.test(window.location.hostname)) {
    return window.location.origin;
  }
  return APP_ORIGIN;
}

export function appPath(pathname: string, search?: URLSearchParams): string {
  const query = search?.toString();
  return `${pathname}${query ? `?${query}` : ""}`;
}

export function startPathForWebsite(websiteUrl?: string | null): string {
  const search = new URLSearchParams();
  if (websiteUrl) search.set("website", websiteUrl);
  return appPath(APP_START_PATH, search);
}

/** Only accepts internal app paths, never an arbitrary absolute URL. */
export function safeInternalPath(input: string | null | undefined, fallback = "/start"): string {
  if (!input || !input.startsWith("/") || input.startsWith("//") || input.includes("\\")) return fallback;
  return input;
}

/** True when a request is using the production app surface, not marketing. */
export function isAppHost(host: string | null | undefined): boolean {
  if (!host) return false;
  const hostname = host.split(":")[0].toLowerCase();
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]") return false;
  return hostname === APP_HOSTNAME.toLowerCase() || hostname === "app.wanterest.com";
}
