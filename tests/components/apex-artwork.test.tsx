import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ApexMark, ApexPlate } from "@/components/identity/apex-artwork";
import { FounderPassArtwork } from "@/components/members/founder-pass";
import { MemberIdentity } from "@/components/members/member-identity";
import { AccessStatusChip, CohortBadge, EarlyAccessNumber, EarlyAccessPill, IdentityFallback, PriorityPill, PublicationChip, WorkspaceActivity } from "@/components/members/member-identity-slots";
import { MemberWallCard } from "@/components/members/member-wall-card";
import { MembershipSection } from "@/components/dashboard/membership-section";
import { completeProfilePayload } from "@/components/dashboard/membership-settings";
import { WorkspaceCohortIdentity } from "@/components/dashboard/workspace-cohort-identity";
import { MembershipLadder } from "@/components/waitlist/membership-ladder";
import { admissionHtml, reviewHtml } from "@/app/invite/complete/admission-html";
import type { AdmissionResult } from "@/server/modules/waitlist";
import {
  APEX_GEOMETRY,
  APEX_STATIC_ASSETS,
  APEX_VIEW_BOX,
  WANTEREST_LOGO,
  apexCutForSize,
  apexSvgMarkup,
  plateGlyphSize,
  plateRadius,
  wanterestLogoSvgMarkup,
} from "@/shared/apex-artwork";
import { admittedCohortPresentation, monogramFontSize, monogramTone } from "@/shared/member-presentation";
import type { PublicMemberIdentity } from "@/shared/public-member-identity";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");
const SOURCE = read("docs/design/claude/originals/Wanterest Apex 2.0 Identity System.dc.html");
const monogram = (value: string): PublicMemberIdentity => ({ assets: [{ kind: "monogram", value }, { kind: "placeholder" }] });

describe("Apex 2.0 geometry is extracted verbatim from the approved source", () => {
  it("matches the approved polygons, viewBox and master logo exactly", () => {
    expect(SOURCE).toContain(`viewBox="${APEX_VIEW_BOX}"`);
    for (const cut of Object.values(APEX_GEOMETRY)) {
      expect(SOURCE).toContain(`<polygon points="${cut.peak}"`);
      expect(SOURCE).toContain(`<polygon points="${cut.keystone}"`);
    }
    expect(SOURCE).toContain(`<polyline points="${WANTEREST_LOGO.polyline}" fill="none" stroke="#111110" stroke-width="16"`);
    // Master LogoMark: shared package keeps the exact approved W geometry, without the cohort keystone.
    const brandMark = read("packages/brand/src/logo-mark.tsx");
    const navIcons = read("src/components/dashboard/nav-icons.tsx");
    expect(brandMark).toContain(`points="${WANTEREST_LOGO.polyline}"`);
    expect(navIcons).toContain('export { LogoMark } from "@wanterest/brand/logo-mark"');
    expect(brandMark).not.toContain("<polygon");
    expect(navIcons).not.toContain("<polygon");
    expect(wanterestLogoSvgMarkup({ size: 20 })).not.toContain("<polygon");
  });

  it("uses the 7u micro cut below 24px and the 3u standard cut from 24px (board 02/03)", () => {
    expect(apexCutForSize(10)).toBe("micro");
    expect(apexCutForSize(20)).toBe("micro");
    expect(apexCutForSize(23)).toBe("micro");
    expect(apexCutForSize(24)).toBe("standard");
    expect(apexCutForSize(30)).toBe("standard");
    expect(renderToStaticMarkup(<ApexMark size={14} fill="founding-light" />)).toContain(APEX_GEOMETRY.micro.peak);
    expect(renderToStaticMarkup(<ApexMark size={30} fill="founding-light" />)).toContain(APEX_GEOMETRY.standard.peak);
  });

  it("follows the board 03 plate ladder (radius 24%, glyph 62.5%)", () => {
    expect([16, 20, 24, 32, 48, 64].map(plateRadius)).toEqual([4, 5, 6, 8, 12, 15]);
    expect([16, 20, 24, 32, 48, 64].map(plateGlyphSize)).toEqual([10, 12, 15, 20, 30, 40]);
    expect(renderToStaticMarkup(<ApexPlate size={48} edition="founding" />)).toContain("border-radius:12px");
  });

  it("keeps the lime keystone exclusive to Founding 25", () => {
    expect(apexSvgMarkup({ size: 30, fill: "founding-light" })).toContain('fill="#D7FF3D"');
    expect(apexSvgMarkup({ size: 30, fill: "early-light" })).not.toContain("#D7FF3D");
    expect(apexSvgMarkup({ size: 30, fill: "early-dark" })).not.toContain("#D7FF3D");
  });
});

describe("static library public/identity/apex-2", () => {
  const directory = join(root, "public/identity/apex-2");
  it("contains exactly the generated files and they match the geometry module", () => {
    expect(readdirSync(directory).sort()).toEqual(Object.keys(APEX_STATIC_ASSETS).sort());
    for (const [name, build] of Object.entries(APEX_STATIC_ASSETS)) {
      const actual = readFileSync(join(directory, name), "utf8").replace(/\r\n?/g, "\n");
      const expected = `${build()}\n`.replace(/\r\n?/g, "\n");
      expect(actual).toBe(expected);
    }
  });
  it("is sanitized: no scripts, handlers, foreignObject, external references or member data", () => {
    for (const name of readdirSync(directory)) {
      const svg = readFileSync(join(directory, name), "utf8");
      expect(svg).not.toMatch(/<script|\son[a-z]+=|foreignObject|href=|url\(|<image|<text|@import/i);
      expect(svg).not.toMatch(/\d{2,3}\/(25|100)|Founding|Early|#0\d/);
    }
  });
  it("does not invent the three composition exports the source only references", () => {
    for (const missing of ["founder-pass-artwork.svg", "early100-pass-artwork.svg", "share-og-founding-artwork.svg"]) {
      expect(SOURCE).toContain(`assets/identity/${missing}`);
      expect(Object.keys(APEX_STATIC_ASSETS)).not.toContain(missing);
    }
  });
});

describe("cohort badge family", () => {
  it("renders both permanent cohorts with authoritative serial formats", () => {
    const founding = renderToStaticMarkup(<CohortBadge cohort="founding_25" number={7} />);
    const early = renderToStaticMarkup(<CohortBadge cohort="early_100" number={42} />);
    expect(founding).toContain(">FOUNDING<");
    expect(founding).toContain(">07<");
    expect(founding).toContain("Founding 25 #07");
    expect(early).toContain(">EARLY<");
    expect(early).toContain(">042<");
    expect(early).toContain("Early 100 #042");
    expect(early).not.toContain("#D7FF3D");
    expect(renderToStaticMarkup(<CohortBadge cohort="early_100" number={100} />)).toContain(">100<");
  });
  it("supports micro, compact and standard sizes on light and dark surfaces", () => {
    const micro = renderToStaticMarkup(<CohortBadge cohort="founding_25" number={7} size="micro" />);
    expect(micro).toContain(">#07<");
    expect(micro).toContain('data-apex-plate="founding"');
    expect(renderToStaticMarkup(<CohortBadge cohort="early_100" number={42} size="micro" tone="dark" />)).toContain('data-surface="dark"');
    expect(renderToStaticMarkup(<CohortBadge cohort="founding_25" size="compact" />)).toContain('data-badge-size="compact"');
    expect(renderToStaticMarkup(<CohortBadge cohort="founding_25" />)).not.toMatch(/>\d{2,3}</);
  });
  it("refuses invalid or out-of-namespace numbers instead of inventing one", () => {
    expect(() => renderToStaticMarkup(<CohortBadge cohort="founding_25" number={26} />)).toThrow();
    expect(() => renderToStaticMarkup(<CohortBadge cohort="early_100" number={0} />)).toThrow();
    expect(admittedCohortPresentation("founding_25", 7)).toMatchObject({ serial: "#07", digits: "07", limit: 25 });
    expect(admittedCohortPresentation("early_100", 7)).toMatchObject({ serial: "#007", digits: "007", limit: 100 });
  });
});

describe("Early Access and Priority stay separate from cohorts", () => {
  it("formats the independent waitlist number with the existing formatter and no Apex", () => {
    const pill = renderToStaticMarkup(<EarlyAccessPill number={184} />);
    expect(pill).toContain("Early access");
    expect(pill).toContain("#0184");
    expect(pill).not.toContain("<svg");
    expect(renderToStaticMarkup(<EarlyAccessPill number={12408} />)).toContain("#12408");
    expect(renderToStaticMarkup(<EarlyAccessNumber label="#0184" />)).toMatch(/>#<\/span>0184/);
  });
  it("shows Priority only while granted and never with an Apex or cohort serial", () => {
    const granted = renderToStaticMarkup(<PriorityPill status="granted" earlyAccessNumber={184} />);
    expect(granted).toContain("Priority");
    expect(granted).toContain("#0184");
    expect(granted).not.toContain("<svg");
    expect(renderToStaticMarkup(<PriorityPill status="revoked" earlyAccessNumber={184} />)).toBe("");
    expect(renderToStaticMarkup(<PriorityPill status={null} />)).toBe("");
  });
  it("draws the membership ladder with the Apex family and no numbers", () => {
    const html = renderToStaticMarkup(<MembershipLadder />);
    expect(html).toContain('data-cohort="founding_25"');
    expect(html).toContain('data-cohort="early_100"');
    expect(html).toContain('data-access-kind="priority_access"');
    expect(html).toContain('data-access-kind="early_access"');
    expect(html).not.toMatch(/>#?\d{2,5}</);
  });
  it("renders status, publication and activity indicators independently", () => {
    expect(renderToStaticMarkup(<AccessStatusChip status="email_confirmed" />)).toContain("Email confirmed");
    expect(renderToStaticMarkup(<PublicationChip surface="wall" visible />)).toContain("On public wall");
    expect(renderToStaticMarkup(<PublicationChip surface="pass" visible={false} />)).toContain("Pass private");
    expect(renderToStaticMarkup(<WorkspaceActivity active={false} />)).toContain("Workspace inactive");
  });
});

describe("member identity fallback presentation", () => {
  it("uses the board 04 monogram typography and tones without deriving a new monogram", () => {
    expect([monogramFontSize("A", 40), monogramFontSize("MP", 40), monogramFontSize("PNS", 40)]).toEqual([17.6, 14.4, 11.2]);
    expect([monogramTone("A"), monogramTone("MP"), monogramTone("PNS")]).toEqual(["ink", "ivory", "neutral"]);
    const html = renderToStaticMarkup(<IdentityFallback asset={{ kind: "monogram", value: "MP" }} size={40} />);
    expect(html).toContain(">MP<");
    expect(html).toContain("border-radius:10px");
  });
  it("renders the neutral placeholder as a sand tile with an open ring (no member data)", () => {
    const html = renderToStaticMarkup(<IdentityFallback asset={{ kind: "placeholder" }} size={40} />);
    expect(html).toContain('data-identity-kind="placeholder"');
    expect(html).toContain("width:12px");
    expect(html).not.toContain("—");
  });
  it("contains logos, crops avatars in a circle frame, and walks the chain once per failed asset", () => {
    const logo = renderToStaticMarkup(<MemberIdentity identity={{ assets: [{ kind: "company_logo", url: "https://assets.example.com/l.png" }, { kind: "placeholder" }] }} size={52} />);
    expect(logo).toContain("object-fit:contain");
    expect(logo).toContain('data-asset-index="0"');
    const avatar = renderToStaticMarkup(<MemberIdentity identity={{ assets: [{ kind: "profile_avatar", url: "https://assets.example.com/a.png" }, { kind: "placeholder" }] }} size={52} />);
    expect(avatar).toContain("object-fit:cover");
    expect(avatar).toContain('data-identity-kind="profile_avatar"');
    const client = read("src/components/members/member-identity-client.tsx");
    expect(client).toContain("element?.complete && element.naturalWidth === 0");
    expect(client).toContain("current === failedIndex");
  });
});

describe("serial-led member card", () => {
  const card = (cohort: "founding_25" | "early_100", number: number, headline: string | null = null) =>
    renderToStaticMarkup(<MemberWallCard cohort={cohort} number={number} displayName="Fixture" headline={headline} admissionMonth="Mar 2026" identity={monogram("F")} />);
  it("renders both editions with the approved serial and total", () => {
    expect(card("founding_25", 1)).toMatch(/data-edition="founding"[\s\S]*>01<[\s\S]*>\/25</);
    expect(card("early_100", 42)).toMatch(/data-edition="early"[\s\S]*>042<[\s\S]*>\/100</);
  });
  it("omits an absent headline and is never a link", () => {
    const html = card("founding_25", 12);
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("View pass");
    expect(card("founding_25", 12, "Public headline")).toContain("Public headline");
  });
});

describe("Founder Pass variants", () => {
  const props = { identity: monogram("HC"), displayName: "Fixture Co", headline: "Public headline", admissionMonth: "Mar 2026", admissionMonthLong: "March 2026" };
  it("renders the Founding 25 pass with the lit keystone and accurate label", () => {
    const html = renderToStaticMarkup(<FounderPassArtwork cohort="founding_25" number={7} {...props} />);
    expect(html).toContain("FOUNDING MEMBER");
    expect(html).toContain("Fixture Co, Founding 25 #07 public pass");
    expect(html).toContain("No. 07 of 25");
    expect(html).toContain("March 2026");
    expect(html).toContain("#D7FF3D");
  });
  it("renders the separately approved Early 100 pass without lime on the Apex", () => {
    const html = renderToStaticMarkup(<FounderPassArtwork cohort="early_100" number={42} {...props} layout="vertical" />);
    expect(html).toContain("EARLY 100 MEMBER");
    expect(html).toContain("Early 100 #042 public pass");
    expect(html).toContain("No. 042 of 100");
    expect(html).not.toMatch(/points="60,19\.3[^"]*" fill="#D7FF3D"/);
  });
  it("supports the compact preview row", () => {
    const html = renderToStaticMarkup(<FounderPassArtwork cohort="founding_25" number={25} {...props} layout="compact" />);
    expect(html).toContain('data-layout="compact"');
    expect(html).toContain(">25<");
  });
});

describe("public pass route wiring", () => {
  const page = read("src/app/members/[slug]/page.tsx");
  const view = read("src/components/members/member-profile.tsx");
  it("renders the pass only after the current pass-visible RPC read and keeps not-found/noindex", () => {
    expect(page).toContain("getPublicCohortPassQuery(slug)");
    expect(page).toContain("if (!profile) notFound();");
    expect(page).toContain("robots: { index: false, follow: false }");
    expect(page).toContain("alternates: { canonical: profile.canonicalUrl }");
    expect(page).toContain("publicMemberPassPresentation(profile)");
    expect(view).toContain('layout="horizontal"');
    expect(view).toContain('layout="vertical"');
  });
  it("does not activate 13B sharing", () => {
    expect(view).not.toMatch(/Share pass<|share-cards|ShareCard/);
  });
});

describe("Settings membership integration", () => {
  it("always submits the complete profile including both independent visibility flags", () => {
    const payload = completeProfilePayload({ publicSlug: " fixture ", displayName: " Fixture ", headline: " ", logoUrl: "", avatarUrl: null, websiteUrl: " https://example.org ", monogram: "fx", wallVisible: false, passVisible: true });
    expect(payload).toEqual({ publicSlug: "fixture", displayName: "Fixture", headline: null, logoUrl: null, avatarUrl: null, websiteUrl: "https://example.org", monogram: "FX", wallVisible: false, passVisible: true });
    expect(Object.keys(payload)).toEqual(expect.arrayContaining(["wallVisible", "passVisible"]));
  });
  it("renders permanent identity from the private cohort query and independent consent", () => {
    const html = renderToStaticMarkup(<MembershipSection data={{ workspaceId: "00000000-0000-4000-8000-000000000001", publicOrigin: "https://wanterest.com", cohort: { state: "member", cohort: "early_100", number: 42, workspaceStatus: "suspended" }, profile: null }} />);
    expect(html).toContain("Early 100 #042");
    expect(html).toContain("Workspace inactive");
    expect(html).toContain("No public profile");
    const none = renderToStaticMarkup(<MembershipSection data={{ workspaceId: "00000000-0000-4000-8000-000000000001", publicOrigin: "https://wanterest.com", cohort: { state: "none", workspaceStatus: "active" }, profile: null }} />);
    expect(none).toContain("No permanent cohort");
    expect(none).not.toMatch(/data-cohort=/);
  });
  it("uses existing authorized queries and never a public wall read", () => {
    const settings = read("src/app/app/settings/page.tsx");
    expect(settings).toContain("getWorkspaceCohortIdentityQuery(workspace.id)");
    expect(settings).toContain("getWorkspacePublicCohortProfileQuery(workspace.id)");
    expect(settings).not.toContain("getPublicCohortWallsQuery");
    const editor = read("src/components/dashboard/membership-settings.tsx");
    expect(editor).toContain('method: "PATCH"');
    expect(editor).toContain("completeProfilePayload(values)");
    expect(editor).toContain('role="switch"');
    expect(editor).not.toMatch(/type="file"|upload\(/i);
  });
});

describe("compact workspace identity", () => {
  it("renders the compact pill with an accessible tooltip", () => {
    const html = renderToStaticMarkup(<WorkspaceCohortIdentity cohort="founding_25" number={7} />);
    expect(html).toContain('role="tooltip"');
    expect(html).toContain("Founding 25 · No. 07");
    expect(html).toContain('tabindex="0"');
  });
  it("reads the private workspace identity in parallel, once, for the selected workspace", () => {
    const shell = read("src/components/dashboard/dashboard-shell.tsx");
    expect(shell).toContain("getWorkspaceCohortIdentityQuery(workspace.id)");
    expect(shell).toContain("Promise.all");
    expect(shell).not.toMatch(/getPublicCohort|publicSlug/);
    expect(read("src/components/dashboard/context-switchers.tsx")).not.toContain("Cohort");
  });
});

describe("admission reveal presentation", () => {
  const base: AdmissionResult = {
    admissionId: "00000000-0000-4000-8000-0000000000a1", inviteId: "00000000-0000-4000-8000-0000000000a2", waitlistApplicationId: "00000000-0000-4000-8000-0000000000a3",
    userId: "00000000-0000-4000-8000-0000000000a4", workspaceId: "00000000-0000-4000-8000-0000000000a5", cohort: "founding_25", cohortNumber: 7, cohortLimit: 25,
    benefitPolicyKey: null, benefitStatus: null, profileInitialized: true, onboardingStatus: "required", admittedAt: "2026-09-28T12:00:00Z", idempotent: false,
  };
  it("shows only the cohort and number returned by the admission transaction", () => {
    const founding = admissionHtml(base);
    expect(founding).toContain("You&rsquo;re Founding 07.");
    expect(founding).toContain("<b>07</b><span>/25</span>");
    expect(founding).toContain("#D7FF3D");
    const early = admissionHtml({ ...base, cohort: "early_100", cohortNumber: 42, cohortLimit: 100 });
    expect(early).toContain("You&rsquo;re Early 042.");
    expect(early).toContain("EARLY 100 MEMBER");
    const none = admissionHtml({ ...base, cohort: null, cohortNumber: null, cohortLimit: null });
    expect(none).toContain("Welcome to Wanterest.");
    expect(none).not.toMatch(/FOUNDING MEMBER|EARLY 100 MEMBER|class="serial/);
  });
  it("is server-safe static HTML with a reduced-motion final state and no token", () => {
    const html = admissionHtml(base);
    expect(html).toContain("prefers-reduced-motion:reduce");
    expect(html).not.toMatch(/token=|<script/);
    const htmlModule = read("src/app/invite/complete/admission-html.ts");
    expect(htmlModule).not.toMatch(/from "react"|use client|useState/);
    expect(reviewHtml("a@example.test")).toContain("Invitation ready");
    expect(reviewHtml("<b>@x")).toContain("&lt;b&gt;@x");
  });
});

describe("visual-QA fixtures are isolated", () => {
  it("are disabled in production and outside the explicit opt-in", () => {
    const page = read("src/app/dev/apex-fixtures/page.tsx");
    const admission = read("src/app/dev/apex-fixtures/admission/route.ts");
    expect(page).toContain('process.env.NODE_ENV !== "production" && process.env.APEX_FIXTURES === "1"');
    expect(page).toContain("robots: { index: false, follow: false }");
    expect(admission).toContain('process.env.NODE_ENV === "production" || process.env.APEX_FIXTURES !== "1"');
    for (const route of ["src/app/members/page.tsx", "src/app/members/[slug]/page.tsx", "src/app/app/settings/page.tsx"]) expect(read(route)).not.toContain("apex-fixtures");
  });
});
