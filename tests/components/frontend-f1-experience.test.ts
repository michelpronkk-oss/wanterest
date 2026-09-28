import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("F1 first-experience contracts", () => {
  it("keeps the homepage evidence-first and state-aware", () => {
    const home = read("src/components/marketing/marketing-home.tsx");
    const page = read("src/app/page.tsx");
    const nav = read("src/components/marketing/marketing-nav.tsx");

    expect(home).toContain("Know what your market");
    expect(home).toContain("with the evidence attached");
    expect(home).toContain("accessState");
    expect(page).toContain("getHomepageAccessState");
    expect(nav).toContain("CHECK_EMAIL");
    expect(nav).toContain("ACCEPT_INVITATION");
    expect(home).not.toContain("stripe");
    expect(home).not.toContain("Notion");
    expect(home).not.toContain("94% match");
    expect(home).not.toContain("31%");
  });

  it("keeps invite review and admission on the server-held handoff", () => {
    const route = read("src/app/invite/complete/route.ts");

    expect(route).toContain("export async function POST");
    expect(route).toContain('method="post" action="/invite/complete"');
    expect(route).toContain("acceptInvite");
    expect(route).toContain("httpOnly: true");
    expect(route).toContain("maxAge: 0");
    expect(route).toContain("no-store");
    expect(route).toContain("noindex,nofollow");
    expect(route).toContain("invite token");
  });

  it("does not expose fabricated live feed freshness or social proof", () => {
    const home = read("src/components/marketing/marketing-home.tsx");
    const qualification = read("src/components/marketing/qualification.tsx");
    const beyondSignals = read("src/components/marketing/beyond-signals.tsx");

    expect(home).not.toContain("500K likes");
    expect(home).not.toContain("new opportunities");
    expect(qualification).not.toContain("HIGH-CONFIDENCE SIGNAL");
    expect(beyondSignals).not.toContain("148 mentions");
    expect(beyondSignals).not.toContain("+31%");
  });
});
