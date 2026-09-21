import { APP_ORIGIN } from "@/shared/config/site";

export const APP_SIGNUP_URL = `${APP_ORIGIN}/signup`;
export const APP_LOGIN_URL = `${APP_ORIGIN}/login`;

export function signupUrlForSite(site: string): string {
  const trimmed = site.trim();
  if (!trimmed) return APP_SIGNUP_URL;
  const url = new URL(APP_SIGNUP_URL);
  url.searchParams.set("site", trimmed);
  return url.toString();
}
