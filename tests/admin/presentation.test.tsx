import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminContext } from "../../apps/admin/src/server/auth";
import type { SearchConsoleReadySnapshot, SearchConsoleSnapshot } from "../../apps/admin/src/server/search-console/model";

vi.mock("server-only", () => ({}));
vi.mock("@admin/server/supabase", () => ({ createAdminServiceClient: () => null, isAdminAuthConfigured: () => false }));
vi.mock("@admin/server/actions", () => ({ signOut: vi.fn(), signIn: vi.fn(), requestPasswordRecovery: vi.fn(), verifyMfa: vi.fn(), startMfaEnrollment: vi.fn(), restartMfaEnrollment: vi.fn() }));
vi.mock("@admin/server/trigger-runs", () => ({ getTriggerRunsSnapshot: async () => ({ state: "unavailable", checkedAt: null, runs: null, routingRuns: null, source: "Trigger.dev · production environment" }) }));
vi.mock("@admin/server/auth", async (original) => ({ ...await original<object>(), requireAdminPermission: vi.fn() }));
vi.mock("@admin/server/search-console/authorized", () => ({ getAuthorizedSearchConsoleSnapshot: vi.fn() }));

import { requireAdminPermission } from "../../apps/admin/src/server/auth";
import { getAuthorizedSearchConsoleSnapshot } from "../../apps/admin/src/server/search-console/authorized";
import SearchConsolePage from "../../apps/admin/src/app/search-console/page";
import OverviewPage from "../../apps/admin/src/app/page";
import OperationsPage from "../../apps/admin/src/app/operations/page";
import EarlyAccessPage from "../../apps/admin/src/app/early-access/page";
import SystemMapPage from "../../apps/admin/src/app/system-map/page";
import LoginPage from "../../apps/admin/src/app/login/page";
import ForgotPasswordPage from "../../apps/admin/src/app/forgot-password/page";
import { ConsoleShell } from "../../apps/admin/src/components/console-shell";
import { AuthShell } from "../../apps/admin/src/components/auth-shell";
import { MfaEnrollment } from "../../apps/admin/src/components/mfa-enrollment";
import { MfaCodeChallenge } from "../../apps/admin/src/components/mfa-code-challenge";

const context: AdminContext = { userId: "presentation-fixture", role: "founder", roleLabel: "Founder", initials: "FO" };
const base = {
  property: "sc-domain:wanterest.com", source: "Google Search Console · Search Analytics API",
  checkedAt: "2026-09-30T12:00:00.000Z",
  period: { startDate: "2026-08-30", endDate: "2026-09-26", days: 28 },
  comparison: { startDate: "2026-08-02", endDate: "2026-08-29", days: 28 },
};
// Synthetic values are confined to tests. Optional review HTML is visibly labelled,
// stored in ignored /out, and never exposed through a Next.js route or auth bypass.
function ready(overrides: Partial<SearchConsoleReadySnapshot> = {}): SearchConsoleReadySnapshot {
  const query = { key: "TEST FIXTURE demand intelligence", clicks: 3, impressions: 240, ctr: 3 / 240, position: 12 };
  return {
    ...base, state: "available", permission: "restricted", rowLimit: 1000,
    metrics: { clicks: 12, impressions: 480, ctr: .025, position: 11.5 },
    previousMetrics: { clicks: 8, impressions: 320, ctr: .025, position: 12.5 },
    queries: [query, { ...query, key: "wanterest TEST FIXTURE", clicks: 9, ctr: 9 / 240, position: 3 }],
    previousQueries: [{ ...query, clicks: 2, impressions: 110, ctr: 2 / 110 }],
    pages: [{ ...query, key: "https://www.wanterest.com/presentation-test-fixture" }],
    previousPages: [],
    queryPages: [{ ...query, key: JSON.stringify([query.key, "https://www.wanterest.com/presentation-test-fixture"]) }],
    previousQueryPages: [],
    freshness: { state: "settled", latestAvailableDate: "2026-09-29", firstIncompleteDate: null, detail: "Recent data checked. The headline period uses finalized data." },
    ...overrides,
  };
}

function render(name: string, node: React.ReactNode) {
  const markup = renderToStaticMarkup(node);
  if (process.env.ADMIN_DESIGN_REVIEW === "1") {
    const output = resolve("out/admin-design-review");
    mkdirSync(output, { recursive: true });
    const fonts = [["Inter-400", "Inter", "400"], ["Inter-700", "Inter Bold", "700"], ["Sora-600", "Sora", "600"], ["Archivo-700", "Archivo", "700"]];
    for (const [file] of fonts) copyFileSync(resolve("assets/fonts", file + ".ttf"), resolve(output, file + ".ttf"));
    const fontCss = fonts.map(([file, family, weight]) => `@font-face{font-family:'${family}';src:url('${file}.ttf');font-weight:${weight};font-display:swap}`).join("");
    writeFileSync(resolve(output, "styles.css"), fontCss + readFileSync(resolve("apps/admin/src/app/styles.css"), "utf8"));
    writeFileSync(resolve(output, name + ".html"), `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Local UI review · ${name}</title><link rel="stylesheet" href="styles.css"><style>body{margin:0}.review-label{padding:10px 20px;background:#d7ff3d;color:#111110;font:12px Arial;letter-spacing:.04em}.admin-scope{--font-inter:'Inter';--font-inter-bold:'Inter Bold';--font-sora:'Sora';--font-archivo:'Archivo'}</style></head><body><div class="review-label">LOCAL PRESENTATION REVIEW · SYNTHETIC TEST FIXTURE / NO PRODUCTION CONNECTION</div><div class="admin-scope">${markup}</div></body></html>`);
  }
  return markup;
}

async function search(name: string, snapshot: SearchConsoleSnapshot, sort?: string) {
  vi.mocked(getAuthorizedSearchConsoleSnapshot).mockResolvedValue({ context, snapshot });
  return render(name, await SearchConsolePage({ searchParams: Promise.resolve({ sort }) }));
}

beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Presentation tests must never access providers"); }));
  vi.stubEnv("VERCEL_API_TOKEN", "");
  vi.mocked(requireAdminPermission).mockResolvedValue(context);
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe("Admin presentation and truthful data states", () => {
  it("presents missing Search Console configuration without sample metrics", async () => {
    const html = await search("search-not-configured", { ...base, state: "not_configured", checkedAt: null, reason: "Production OAuth access is not configured." });
    expect(html).toContain("Search Console not configured");
    expect(html).not.toContain('class="metric-card');
    expect(html).not.toContain("TEST FIXTURE demand intelligence");
  });
  it("preserves the provider error and offers a read-only retry", async () => {
    const html = await search("search-error", { ...base, state: "unavailable", reason: "Google Search Console is temporarily unavailable." });
    expect(html).toContain("Google Search Console is temporarily unavailable.");
    expect(html).toContain('href="/search-console">Retry connection');
    expect(html).not.toContain('class="metric-card');
  });
  it("renders no settled data as missing rather than zero", async () => {
    const html = await search("search-empty", ready({ state: "empty", metrics: null, previousMetrics: null, queries: [], previousQueries: [], pages: [], previousPages: [], queryPages: [], freshness: { state: "unknown", latestAvailableDate: null, firstIncompleteDate: null, detail: "No recent rows were returned." } }));
    expect(html).toContain("not a confirmed zero-traffic measurement");
    expect(html.match(/<strong>—<\/strong>/g)).toHaveLength(4);
    expect(html).toContain("No query rows are available for classification.");
  });
  it("keeps finalized metrics, comparisons, evidence and accessible sections", async () => {
    const html = await search("search-settled", ready());
    expect(html).toContain("2.50%");
    expect(html).toContain("11.5");
    expect(html).toContain("Branded and non-branded");
    expect(html).toContain("Impressions without clicks");
    expect(html).toContain('aria-label="Search Console sections"');
    expect(html).toContain('tabindex="0" aria-label="Scrollable Search Console query results"');
    expect(html).toContain("2026-08-30");
    expect(html).toContain("2026-08-02");
    expect(getAuthorizedSearchConsoleSnapshot).toHaveBeenCalledOnce();
  });
  it("displays provisional maturity separately from the finalized metrics", async () => {
    const html = await search("search-provisional", ready({ freshness: { state: "provisional", latestAvailableDate: "2026-09-29", firstIncompleteDate: "2026-09-28", detail: "Recent data is provisional. Finalized measurements remain in the headline period." } }));
    expect(html).toContain("Recent data is still processing");
    expect(html).toContain('class="seo-freshness provisional"');
    expect(html).toContain("2.50%");
    expect(html).toContain("2026-09-28");
  });
  it("retains sorting and displays returned zeros as real zeros", async () => {
    const html = await search("search-zero", ready({ metrics: { clicks: 0, impressions: 0, ctr: 0, position: 0 } }), "position");
    expect(html).toContain('<option value="position" selected="">');
    expect(html.match(/<strong>0<\/strong>/g)).toHaveLength(2);
    expect(html).toContain("0.00%");
  });
  it("keeps the shared navigation permission-filtered and keyboard accessible", () => {
    const html = render("shell-support", <ConsoleShell context={{ ...context, role: "support", roleLabel: "Support" }} active="/search-console"><h1>Support</h1></ConsoleShell>);
    expect(html).toContain('href="#admin-content"');
    expect(html).toContain('aria-current="page"');
    expect(html).not.toContain('href="/operations"');
    expect(html).not.toContain('href="/system-map"');
    expect(html).not.toContain('class="avatar"');
  });
  it("keeps Overview counts unavailable when no database is connected", async () => {
    const html = render("overview", await OverviewPage());
    expect(html.match(/<strong>—<\/strong>/g)).toHaveLength(8);
    expect(html).toContain('metric-card metric-featured');
    expect(requireAdminPermission).toHaveBeenCalledWith("operations.read");
  });
  it("preserves Early Access search controls and source failure", async () => {
    const html = render("early-access", await EarlyAccessPage({ searchParams: Promise.resolve({ q: "", status: "all" }) }));
    expect(html).toContain('role="search"');
    expect(html).toContain('name="status"');
    expect(html).toContain("Source unavailable");
    expect(requireAdminPermission).toHaveBeenCalledWith("lifecycle.read");
  });
  it("retains the known incident and unavailable operations sources", async () => {
    const html = render("operations", await OperationsPage());
    expect(html).toContain("42P10");
    expect(html).toContain("product_routing_edges");
    expect(html).toContain("Source unavailable");
  });
  it("shows all registered providers and stages with unknown observed health", async () => {
    const html = render("system-map", await SystemMapPage());
    expect(html.match(/class="map-node compact unknown"/g)).toHaveLength(15);
    expect(html.match(/class="map-node pipeline-node unknown"/g)).toHaveLength(6);
    expect(html).not.toContain('class="map-node service-node healthy"');
    expect(requireAdminPermission).toHaveBeenCalledWith("operations.summary.read");
  });
  it("renders login, validation feedback and recovery without changing form actions", async () => {
    render("login", await LoginPage({ searchParams: Promise.resolve({}) }));
    const error = render("login-error", await LoginPage({ searchParams: Promise.resolve({ error: "credentials" }) }));
    expect(error).toContain('role="alert"');
    expect(error).toContain('autoComplete="current-password"');
    render("recovery", await ForgotPasswordPage({ searchParams: Promise.resolve({}) }));
    const sent = render("recovery-sent", await ForgotPasswordPage({ searchParams: Promise.resolve({ sent: "1" }) }));
    expect(sent).toContain("If an administrator account matches");
  });
  it("renders the existing enrollment, resume and challenge components without secrets", () => {
    const shell = (title: string, children: React.ReactNode) => <AuthShell eyebrow="SECURITY CHECK" title={title} description="Admin access requires a verified authenticator before any operational data is shown.">{children}</AuthShell>;
    render("mfa-new", shell("Set up your authenticator.", <MfaEnrollment />));
    const resume = render("mfa-resume", shell("Set up your authenticator.", <MfaEnrollment initialState="pending" pendingFactors={[{ id: "test-pending-factor", createdAt: base.checkedAt }]} />));
    expect(resume).toContain("Restart authenticator setup");
    const challenge = render("mfa-challenge", shell("Verify your identity.", <MfaCodeChallenge factors={[{ id: "test-verified-factor", friendlyName: "Test authenticator" }]} />));
    expect(challenge).toContain('autoComplete="one-time-code"');
    expect(challenge).not.toContain("otpauth:");
  });
});
