import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");

describe("responsive marketing navigation contracts", () => {
  it("uses the same state-aware nav on the Hero v2 and standalone public pages", () => {
    const home = read("src/components/marketing/marketing-home.tsx");
    const nav = read("src/components/marketing/marketing-nav.tsx");
    const header = read("src/components/marketing/site-header.tsx");
    expect(home).toContain("<SiteNav accessState={accessState} />");
    expect(nav).toContain("<SiteNav accessState={accessState ?? getHomepageAccessState(accessMode)}");
    expect(nav.match(/<StageNavMenu/g)).toHaveLength(1);
    expect(nav).toContain("navPrimaryAction(accessState)");
    expect(header).toContain("getVisitorAccessState(mode)");
    expect(header).toContain("<MarketingNav accessState={accessState} activeHref={activeHref} />");
  });

  it("uses a native modal dialog for full-screen, clipped-stage-safe navigation", () => {
    const menu = read("src/components/marketing/stage-nav-menu.tsx");
    const css = read("src/app/globals.css");
    expect(menu).toContain("dialog.showModal()");
    expect(menu).toContain('aria-haspopup="dialog"');
    expect(menu).toContain("onCancel=");
    expect(menu).toContain("onClose=");
    expect(menu).toContain('className="marketing-stage-menu-close"');
    expect(menu).toContain('window.matchMedia("(prefers-reduced-motion: reduce)")');
    expect(css).toContain("position: fixed; inset: 0;");
    expect(css).toContain("height: 100dvh;");
    expect(css).toContain("env(safe-area-inset-bottom)");
    expect(css).toContain("overscroll-behavior: contain");
    expect(css).toContain("marketing-menu-enter 280ms");
    expect(css).toContain(".marketing-stage-menu-panel[open] { animation: none; }");
    expect(css).toContain(".marketing-hero-stage");
  });

  it("locks and restores background scrolling and returns focus through native dialog behavior", () => {
    const menu = read("src/components/marketing/stage-nav-menu.tsx");
    expect(menu).toContain('body.style.position = "fixed"');
    expect(menu).toContain("Object.assign(body.style, previous)");
    expect(menu).toContain("window.scrollTo(0, scrollY)");
    expect(menu).toContain('desktop.addEventListener("change", closeOnDesktop)');
    expect(menu).toContain('desktop.removeEventListener("change", closeOnDesktop)');
    expect(menu).toContain("dialog.close()");
  });

  it("keeps the Hero v2 preview card inset and rounded on mobile", () => {
    const css = read("src/app/globals.css");
    expect(css).toContain("margin: 28px 14px 16px; min-width: 0;");
    expect(css).toMatch(/\.marketing-preview-card\.is-mobile \{[^}]*border-radius: 16px;/);
    expect(css).not.toMatch(/\.marketing-preview-card\.is-mobile \{[^}]*border-radius: 16px 16px 0 0;/);
  });
});
