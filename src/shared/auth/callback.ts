export type AuthCallbackError = "invalid_link" | "temporarily_unavailable";

export function isRecoveryCallbackPath(path: string): boolean {
  return path === "/forgot-password/update" || path.startsWith("/forgot-password/update?");
}

export function authCallbackErrorPath(
  next: string,
  error: AuthCallbackError,
  websiteUrl?: string | null,
): string {
  const destination = isRecoveryCallbackPath(next) ? "/forgot-password" : "/login";
  const search = new URLSearchParams({ error });
  if (websiteUrl) search.set("website", websiteUrl);
  return `${destination}?${search.toString()}`;
}

export function authCallbackErrorMessage(error: string | null | undefined): string | null {
  if (error === "invalid_link") return "That email link is invalid or expired. Request a new one and try again.";
  if (error === "temporarily_unavailable") return "Authentication is temporarily unavailable. Please try again in a moment.";
  return null;
}
