import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CohortBadge, IdentityFallback } from "@/components/members/member-identity-slots";
import { MemberIdentity, FounderPassArtwork } from "@/components/members/member-identity";
import { admittedCohortPresentation, type EarlyAccessPresentation, type PriorityAccessPresentation } from "@/shared/member-presentation";
import { publicMemberPassPresentation, privateMembershipPresentation } from "@/server/modules/cohort-public/cohort-public.presentation";
import type { PublicCohortPass } from "@/server/modules/cohort-public/cohort-public.schemas";
import { workspaceCohortPresentation } from "@/server/modules/cohorts/cohort-membership.presentation";

const pass: PublicCohortPass = { publicSlug: "company", canonicalUrl: "https://example.com/members/company", displayName: "Company", logoUrl: "https://assets.example.com/logo.png", avatarUrl: null, monogram: "C", headline: "Public headline", websiteUrl: null, cohort: "founding_25", number: 7, limit: 25, assignedAt: "2026-09-28T23:59:59.000Z" };
const early: EarlyAccessPresentation = { kind: "early_access", number: 7001 };
const priority: PriorityAccessPresentation = { kind: "priority_access", status: "revoked" };

describe("asset-independent identity presentation", () => {
  it("has separate pre-admission namespaces without cohort allocation", () => {
    expect(early.number).toBe(7001);
    expect(priority.status).toBe("revoked");
    expect(priority).not.toHaveProperty("number");
    expect(() => admittedCohortPresentation("founding_25", 26)).toThrow();
    expect(() => admittedCohortPresentation("early_100", 101)).toThrow();
    expect(admittedCohortPresentation("early_100", 42).serial).toBe("#042");
  });
  it("supports compact/tone/actual serial hooks without SVG substitutes", () => {
    const html = renderToStaticMarkup(<CohortBadge cohort="founding_25" number={7} size="compact" tone="dark" />);
    expect(html).toContain("Founding 25 #07");
    expect(html).toContain('data-badge-size="compact"');
    expect(html).toContain('data-tone="dark"');
    expect(html).not.toContain("<svg");
  });
  it("contains logos, crops avatars, and preserves fallback text", () => {
    const logo = renderToStaticMarkup(<MemberIdentity identity={{ assets: [{ kind: "company_logo", url: pass.logoUrl! }, { kind: "placeholder" }] }} size={32} />);
    const avatar = renderToStaticMarkup(<MemberIdentity identity={{ assets: [{ kind: "profile_avatar", url: pass.logoUrl! }, { kind: "placeholder" }] }} size={64} tone="dark" />);
    expect(logo).toContain("object-fit:contain");
    expect(logo).toContain("width:32px");
    expect(avatar).toContain("object-fit:cover");
    expect(avatar).toContain('referrerPolicy="no-referrer"');
    expect(renderToStaticMarkup(<IdentityFallback asset={{ kind: "monogram", value: "C" }} />)).toContain(">C</span>");
  });
  it("maps pass fields and Early 100 labels without leaking private extras", () => {
    const data = publicMemberPassPresentation({ ...pass, cohort: "early_100", number: 42, limit: 100 });
    expect(data).toMatchObject({ number: 42, serial: "#042", admissionMonth: "Sep 2026", headline: "Public headline" });
    const html = renderToStaticMarkup(<FounderPassArtwork {...data} />);
    expect(html).toContain("Early 100 #042 public pass");
    expect(html).not.toContain("founder pass");
    expect(html).toContain('data-admission-month="Sep 2026"');
    expect(data).not.toHaveProperty("workspaceId");
  });
  it("prepares Settings data without creating a public pass link or consent", () => {
    const data = privateMembershipPresentation({ ...pass, profileId: "00000000-0000-4000-8000-000000000001", workspaceId: "00000000-0000-4000-8000-000000000002", wallVisible: true, passVisible: false });
    expect(data?.visibility).toEqual({ wallVisible: true, passVisible: false });
    expect(data).not.toHaveProperty("canonicalUrl");
    expect(data).not.toHaveProperty("workspaceId");
    expect(privateMembershipPresentation(null)).toBeNull();
    // A missing public profile or inactive workspace must not erase private provenance.
    for (const workspaceStatus of ["active", "suspended", "archived"] as const) {
      expect(workspaceCohortPresentation({ cohort: "founding_25", number: 7, limit: 25, assignedAt: pass.assignedAt, displayIdentity: "Founding 25", workspaceStatus, benefitPolicyKey: null })).toMatchObject({ cohort: "founding_25", number: 7, serial: "#07", workspaceStatus });
    }
    expect(workspaceCohortPresentation({ cohort: "none", number: null, limit: null, assignedAt: null, displayIdentity: null, workspaceStatus: "active", benefitPolicyKey: null })).toBeNull();
  });
});
