const SUPABASE_AUTH_COOKIE = /^sb-.+-auth-token(?:\.\d+)?$/i;

export type SupabaseSessionRequest = {
  method: string;
  nextUrl: { pathname: string };
  headers: Pick<Headers, "has">;
  cookies: { getAll(): Array<{ name: string }> };
};

export function shouldVerifySupabaseSession(request: SupabaseSessionRequest): boolean {
  if (request.method === "POST" && request.headers.has("Next-Action")) return false;
  if (request.nextUrl.pathname === "/auth/callback" || request.nextUrl.pathname.startsWith("/api/")) return false;
  return request.cookies.getAll().some(({ name }) => SUPABASE_AUTH_COOKIE.test(name));
}
