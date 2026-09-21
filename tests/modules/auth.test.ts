import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { classifyAuthProviderError } from "../../src/server/modules/auth/auth.errors";

describe("server auth boundary", () => {
  it("classifies missing and invalid sessions as unauthenticated", () => {
    expect(classifyAuthProviderError({ name: "AuthSessionMissingError" })).toBe("unauthenticated");
    expect(classifyAuthProviderError({ status: 401, message: "Invalid JWT" })).toBe("unauthenticated");
  });

  it("keeps rate limits transient instead of treating them as unauthenticated", () => {
    expect(classifyAuthProviderError({ status: 429, code: "over_request_rate_limit" })).toBe("transient");
  });

  it("keeps network failures transient as well", () => {
    expect(classifyAuthProviderError(new TypeError("Failed to fetch"))).toBe("transient");
  });

  it("uses a request-scoped auth cache and a distinct transient AppError", () => {
    const source = readFileSync(new URL("../../src/server/modules/auth/auth.service.ts", import.meta.url), "utf8");
    expect(source).toContain("const getCachedCurrentUser = cache(async () => resolveCurrentUser());");
    expect(source).toContain('new AppError("AUTH_TRANSIENT"');
    expect(source).not.toContain("treating as unauthenticated");
  });
});
