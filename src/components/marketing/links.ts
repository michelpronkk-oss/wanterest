import { APP_ORIGIN, APP_START_URL, appPath, runtimeAppOrigin, startPathForWebsite } from "@/shared/config/site";
import { normalizePublicWebsiteUrl } from "@/shared/validation/public-website";

export const APP_SIGNUP_URL = `${APP_ORIGIN}/signup`;
export const APP_LOGIN_URL = `${APP_ORIGIN}/login`;
export const APP_FORGOT_PASSWORD_URL = `${APP_ORIGIN}/forgot-password`;
export { APP_START_URL };

export function startUrlForSite(site: string): string {
  const normalized = normalizePublicWebsiteUrl(site);
  const url = new URL("/start", runtimeAppOrigin());
  url.searchParams.set("website", normalized);
  return url.toString();
}

export function loginUrlForSite(site?: string | null): string {
  const url = new URL(APP_LOGIN_URL);
  if (site) url.searchParams.set("website", site);
  return url.toString();
}

export function signupUrlForSite(site?: string | null): string {
  const url = new URL(APP_SIGNUP_URL);
  if (site) url.searchParams.set("website", site);
  return url.toString();
}

export function forgotPasswordUrlForSite(site?: string | null): string {
  const url = new URL(APP_FORGOT_PASSWORD_URL);
  if (site) url.searchParams.set("website", site);
  return url.toString();
}

/** Relative auth links keep localhost navigation on the local app origin. */
export function loginPathForSite(site?: string | null): string {
  const search = new URLSearchParams();
  if (site) search.set("website", site);
  return appPath("/login", search);
}

export function signupPathForSite(site?: string | null): string {
  const search = new URLSearchParams();
  if (site) search.set("website", site);
  return appPath("/signup", search);
}

export function forgotPasswordPathForSite(site?: string | null): string {
  const search = new URLSearchParams();
  if (site) search.set("website", site);
  return appPath("/forgot-password", search);
}

export function onboardingPathForWebsite(site?: string | null): string {
  return startPathForWebsite(site);
}
