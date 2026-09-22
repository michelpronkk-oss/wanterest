const SUPABASE_AUTH_COOKIE_PATTERN = /^sb-[^-].*-auth-token(?:\.\d+)?$/;

export function isSupabaseAuthCookieName(name: string): boolean {
  return SUPABASE_AUTH_COOKIE_PATTERN.test(name);
}
