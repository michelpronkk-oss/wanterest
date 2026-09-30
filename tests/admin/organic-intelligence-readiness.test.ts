import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("private Organic Intelligence readiness surface", () => {
  it("requires the existing Admin permission and renders as a dynamic private page", () => {
    const page = read("apps/admin/src/app/publication-readiness/page.tsx");
    expect(page).toContain('export const dynamic = "force-dynamic"');
    expect(page).toContain('requireAdminPermission("operations.summary.read")');
    expect(page).toContain('<ConsoleShell context={context} active="/publication-readiness">');
    expect(page).not.toContain('"use client"');
    expect(read("src/app/admin-internal/publication-readiness/page.tsx"))
      .toContain('export { default } from "@admin/app/publication-readiness/page"');
  });

  it("shows the missing public-safe feed without sample metrics, candidates, or publication controls", () => {
    const page = read("apps/admin/src/app/publication-readiness/page.tsx");
    const source = read("apps/admin/src/server/organic-intelligence-readiness.ts");
    expect(page).toContain("No reviewed candidate feed");
    expect(page).toContain("No candidate names, example metrics");
    expect(page).not.toMatch(/auto.?publish|publish candidate|Publish now/i);
    expect(source).toContain('candidateCount: null');
    expect(source).toContain('publicationEnabled: false');
    expect(source).toContain('state: "not_evaluated"');
  });

  it("keeps Search Console in a prioritization-only role and preserves private workspace boundaries", () => {
    const page = read("apps/admin/src/app/publication-readiness/page.tsx");
    const source = read("apps/admin/src/server/organic-intelligence-readiness.ts");
    expect(page).toContain("Search Console may prioritize an already-eligible candidate for review");
    expect(source).toContain("Workspace-scoped demand rows and raw source records are intentionally excluded.");
  });

  it("places the surface behind the existing operations summary role", () => {
    const shell = read("apps/admin/src/components/console-shell.tsx");
    expect(shell).toContain('href: "/publication-readiness"');
    expect(shell).toContain('label: "Organic readiness"');
    expect(shell).toContain('permission: "operations.summary.read"');
  });
});
