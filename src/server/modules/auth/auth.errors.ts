type AuthProviderErrorShape = {
  name?: unknown;
  message?: unknown;
  status?: unknown;
  code?: unknown;
};

export type AuthFailureKind = "unauthenticated" | "transient";

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asStatus(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Supabase auth errors are provider-boundary errors, not application
 * authorization decisions. Only errors that clearly mean "there is no valid
 * session" may be converted to an unauthenticated result. Everything else is
 * kept distinct so a rate limit or network failure cannot trigger workspace
 * queries and redirect loops.
 */
export function classifyAuthProviderError(error: unknown): AuthFailureKind {
  const value = (error && typeof error === "object" ? error : {}) as AuthProviderErrorShape;
  const name = asString(value.name).toLowerCase();
  const message = asString(value.message).toLowerCase();
  const code = asString(value.code).toLowerCase();
  const status = asStatus(value.status);

  if (name === "authsessionmissingerror") return "unauthenticated";
  if (status === 401) return "unauthenticated";

  const definitiveCodes = new Set([
    "bad_jwt",
    "invalid_jwt",
    "invalid_token",
    "missing_authorization",
    "refresh_token_not_found",
    "refresh_token_already_used",
    "session_not_found",
    "user_not_found",
  ]);
  if (definitiveCodes.has(code)) return "unauthenticated";

  if (/(invalid|expired|missing|not found).*(session|token|jwt)|jwt.*(invalid|expired)/.test(message)) {
    return "unauthenticated";
  }

  return "transient";
}

export function authProviderErrorMetadata(error: unknown): { name: string | null; code: string | null; status: number | null } {
  const value = (error && typeof error === "object" ? error : {}) as AuthProviderErrorShape;
  return {
    name: typeof value.name === "string" ? value.name : null,
    code: typeof value.code === "string" ? value.code : null,
    status: asStatus(value.status),
  };
}
