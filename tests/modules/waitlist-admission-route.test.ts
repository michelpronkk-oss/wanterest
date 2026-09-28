import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const acceptRoute = readFileSync(join(process.cwd(), "src/app/invite/accept/route.ts"), "utf8");
const completeRoute = readFileSync(join(process.cwd(), "src/app/invite/complete/route.ts"), "utf8");
const signupForm = readFileSync(join(process.cwd(), "src/components/auth/signup-form.tsx"), "utf8");
const loginForm = readFileSync(join(process.cwd(), "src/components/auth/login-form.tsx"), "utf8");

describe("13A.5 invite acceptance route contract", () => {
  it("moves the token into an HttpOnly handoff cookie and redirects to a clean URL", () => {
    expect(acceptRoute).toContain("httpOnly: true");
    expect(acceptRoute).toContain("path: \"/invite\"");
    expect(acceptRoute).toContain("/invite/complete");
    expect(acceptRoute).toContain("referrer-policy");
    expect(acceptRoute).toContain("cache-control");
  });

  it("requires the authenticated server user before admission and clears the handoff cookie", () => {
    expect(completeRoute).toContain("getCurrentUser");
    expect(completeRoute).toContain("acceptInvite");
    expect(completeRoute).toContain("maxAge: 0");
    expect(completeRoute).toContain("/login?next=/invite/complete");
    expect(completeRoute).toContain("referrer-policy");
  });

  it("preserves the internal completion path across new-user signup and existing-user login", () => {
    expect(signupForm).toContain("authCallbackUrl(nextPath");
    expect(signupForm).toContain("router.replace(nextPath");
    expect(loginForm).toContain("const destination = nextPath");
    expect(loginForm).toContain("/signup?next=");
  });
});
