import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("13A.6 public access route contracts", () => {
  it("gates waitlist writes server-side and keeps private status paths separate", () => {
    const route = readFileSync(join(process.cwd(), "src/app/api/waitlist/route.ts"), "utf8");
    expect(route).toContain("getProductAccessPolicy");
    expect(route).toContain("waitlistRequestsAllowed");
    expect(route).toContain("Early Access requests are closed");
  });

  it("freezes referral credit after open without deleting referral history", () => {
    const route = readFileSync(join(process.cwd(), "src/app/r/[code]/route.ts"), "utf8");
    expect(route).toContain("getProductAccessState");
    expect(route).toContain("access?.mode === \"open\"");
    expect(route).toContain("/signup");
    expect(route).toContain("access?.mode !== \"open\"");
  });

  it("uses one access state for the marketing header and hero/final actions", () => {
    const home = readFileSync(join(process.cwd(), "src/components/marketing/marketing-home.tsx"), "utf8");
    const nav = readFileSync(join(process.cwd(), "src/components/marketing/marketing-nav.tsx"), "utf8");
    expect(home).toContain("PrimaryAccessAction");
    expect(home).toContain("accessState");
    expect(nav).toContain("accessMode");
    expect(nav).toContain("Request access");
  });
});
