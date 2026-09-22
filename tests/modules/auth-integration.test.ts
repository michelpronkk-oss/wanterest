import { describe, expect, it } from "vitest";

import { authCallbackErrorMessage, authCallbackErrorPath, isRecoveryCallbackPath } from "../../src/shared/auth/callback";
import { classifyClientAuthError, isExistingSignupAccount, passwordConfirmationError } from "../../src/shared/auth/client-errors";
import { authCallbackUrl } from "../../src/components/auth/auth-callback-url";
import { shouldVerifySupabaseSession } from "../../src/server/providers/supabase/proxy-policy";
import { isSupabaseAuthCookieName } from "../../src/server/providers/supabase/auth-cookie";

function requestShape(input: { method?: string; pathname?: string; headers?: Headers; cookieNames?: string[] }) {
  return {
    method: input.method ?? "GET",
    nextUrl: { pathname: input.pathname ?? "/login" },
    headers: input.headers ?? new Headers(),
    cookies: { getAll: () => (input.cookieNames ?? []).map((name) => ({ name, value: "redacted" })) },
  };
}

describe("production auth integration boundaries", () => {
  it("classifies provider rate limits, server failures, and network errors as transient", () => {
    expect(classifyClientAuthError({ status: 429 })).toBe("transient");
    expect(classifyClientAuthError({ status: 503 })).toBe("transient");
    expect(classifyClientAuthError(new TypeError("Failed to fetch"))).toBe("transient");
    expect(classifyClientAuthError({ code: "invalid_credentials" })).toBe("invalid_credentials");
  });

  it("handles Supabase's existing-account signup response and reset mismatch locally", () => {
    expect(isExistingSignupAccount({ identities: [] })).toBe(true);
    expect(isExistingSignupAccount({ identities: [{ provider: "email" }] })).toBe(false);
    expect(passwordConfirmationError("new-password", "different-password")).toBe("Passwords do not match.");
    expect(passwordConfirmationError("new-password", "new-password")).toBeNull();
  });

  it("keeps callback destinations internal and preserves the normalized website", () => {
    const callback = new URL(authCallbackUrl("/start", "https://linear.app"));
    expect(callback.pathname).toBe("/auth/callback");
    expect(callback.searchParams.get("next")).toBe("/start");
    expect(callback.searchParams.get("website")).toBe("https://linear.app");

    const unsafeCallback = new URL(authCallbackUrl("https://evil.example", null));
    expect(unsafeCallback.searchParams.get("next")).toBe("/start");
    expect(authCallbackErrorPath("/forgot-password/update", "invalid_link", "https://linear.app"))
      .toBe("/forgot-password?error=invalid_link&website=https%3A%2F%2Flinear.app");
    expect(isRecoveryCallbackPath("/forgot-password/update")).toBe(true);
    expect(authCallbackErrorMessage("invalid_link")).toContain("invalid or expired");
  });

  it("avoids proxy auth verification storms for anonymous, API, callback, and Server Action requests", () => {
    expect(shouldVerifySupabaseSession(requestShape({}))).toBe(false);
    expect(shouldVerifySupabaseSession(requestShape({ pathname: "/api/auth/session", cookieNames: ["sb-project-auth-token"] }))).toBe(false);
    expect(shouldVerifySupabaseSession(requestShape({ pathname: "/auth/callback", cookieNames: ["sb-project-auth-token"] }))).toBe(false);
    expect(shouldVerifySupabaseSession(requestShape({ method: "POST", headers: new Headers({ "Next-Action": "1" }), cookieNames: ["sb-project-auth-token"] }))).toBe(false);
    expect(shouldVerifySupabaseSession(requestShape({ cookieNames: ["sb-project-auth-token.0"] }))).toBe(true);
  });

  it("recognizes the base and chunked SSR auth cookies without touching unrelated cookies", () => {
    expect(isSupabaseAuthCookieName("sb-project-auth-token")).toBe(true);
    expect(isSupabaseAuthCookieName("sb-project-auth-token.0")).toBe(true);
    expect(isSupabaseAuthCookieName("wanterest_active_product")).toBe(false);
    expect(isSupabaseAuthCookieName("sb-project-auth-token_backup")).toBe(false);
  });
});
