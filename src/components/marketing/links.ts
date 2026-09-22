import { APP_ORIGIN, APP_START_URL, startPathForWebsite } from "@/shared/config/site";
import { normalizePublicWebsiteUrl } from "@/shared/validation/public-website";

export const APP_SIGNUP_URL = `${APP_ORIGIN}/signup`;
export const APP_LOGIN_URL = `${APP_ORIGIN}/login`;
export const APP_FORGOT_PASSWORD_URL = `${APP_ORIGIN}/forgot-password`;
export { APP_START_URL };

export function startUrlForSite(site: string): string {
  const normalized = normalizePublicWebsiteUrl(site);
  const url = new URL(APP_START_URL);
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

export function onboardingPathForWebsite(site?: string | null): string {
  return startPathForWebsite(site);
}
