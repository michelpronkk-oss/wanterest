export type ClientAuthErrorKind = "invalid_credentials" | "transient" | "generic";

type AuthErrorShape = {
  code?: unknown;
  message?: unknown;
  name?: unknown;
  status?: unknown;
};

function errorShape(error: unknown): AuthErrorShape {
  return error && typeof error === "object" ? error as AuthErrorShape : {};
}

function lowerString(value: unknown): string {
  return typeof value === "string" ? value.toLowerCase() : "";
}

function statusOf(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function classifyClientAuthError(error: unknown): ClientAuthErrorKind {
  const value = errorShape(error);
  const code = lowerString(value.code);
  const message = lowerString(value.message);
  const name = lowerString(value.name);
  const status = statusOf(value.status);

  if (status === 429 || (status !== null && status >= 500)) return "transient";
  if (name.includes("network") || /failed to fetch|network|timeout|temporarily unavailable|gateway/.test(message)) return "transient";
  if (["invalid_credentials", "invalid_login_credentials"].includes(code) || /invalid login credentials/.test(message)) {
    return "invalid_credentials";
  }
  return "generic";
}

export type ClientAuthOperation = "login" | "signup" | "reset" | "update";

export function clientAuthErrorMessage(operation: ClientAuthOperation, error: unknown): string {
  if (classifyClientAuthError(error) === "transient") {
    return "Authentication is temporarily unavailable. Please try again in a moment.";
  }

  switch (operation) {
    case "login":
      return "We couldn’t sign you in with those credentials.";
    case "signup":
      return "We couldn’t create your account. Check your details and try again.";
    case "reset":
      return "We couldn’t send a reset link. Please try again in a moment.";
    case "update":
      return "We couldn’t update your password. Request a new reset link and try again.";
  }
}

export function isExistingSignupAccount(user: { identities?: unknown[] | null } | null | undefined): boolean {
  return Boolean(user && Array.isArray(user.identities) && user.identities.length === 0);
}

export function passwordConfirmationError(password: string, confirmation: string): string | null {
  return password === confirmation ? null : "Passwords do not match.";
}
