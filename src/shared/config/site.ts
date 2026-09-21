/**
 * Wanterest is served from two public hostnames on one deployment:
 * www.wanterest.com (marketing) and app.wanterest.com (auth/onboarding/product).
 * This is the single source of truth for that boundary — marketing CTAs and the
 * root route's host check both derive from it, instead of each hardcoding the domain.
 */
export const APP_ORIGIN = "https://app.wanterest.com";

const APP_HOSTNAME = new URL(APP_ORIGIN).host;

/** True when the request's Host header is the app surface (app.wanterest.com), not the marketing surface. */
export function isAppHost(host: string | null | undefined): boolean {
  if (!host) return false;
  return host.split(":")[0].toLowerCase() === APP_HOSTNAME;
}
