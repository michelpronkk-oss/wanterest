import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { PublicMembersWall } from "../../src/components/members/public-members-wall";
import type { PublicCohortRow } from "../../src/server/modules/cohort-public/cohort-public.schemas";
import { selectPublicMemberIdentity } from "../../src/server/modules/cohort-public/cohort-public.identity";

const foundingMember: PublicCohortRow = {
  publicSlug: "northwind", displayName: "Northwind", logoUrl: null, avatarUrl: null, monogram: "N", headline: "Building carefully.", websiteUrl: null,
  cohort: "founding_25", number: 7, limit: 25, assignedAt: "2026-09-28T00:00:00.000Z",
};

describe("public Members Wall", () => {
  it("renders only the supplied public projection with cohort provenance", () => {
    const html = renderToStaticMarkup(<PublicMembersWall founding={[{ ...foundingMember, identity: selectPublicMemberIdentity(foundingMember) }]} early={[]} primaryAction={{ href: "/waitlist", label: "Request access" }} />);
    expect(html).toContain("The first workspaces to find real demand.");
    expect(html).toContain("FOUNDING 25");
    // Apex 2.0 serial-led card: authoritative number in the approved two-digit format.
    expect(html).toContain('aria-label="Northwind, Founding 25 #07"');
    expect(html).toMatch(/>07<\/span><span[^>]*>\/25</);
    expect(html).not.toContain("#0007");
    expect(html).toContain("Northwind");
    expect(html).toContain("Admitted Sep 2026");
    expect(html).not.toContain("/members/northwind");
    expect(html).not.toContain("View public pass");
    expect(html).not.toContain("View pass");
    expect(html).not.toMatch(/<a [^>]*href="\/members\//);
    expect(html).not.toContain("workspace_id");
    expect(html).not.toContain("invite");
    expect(html).not.toContain("@northwind");
  });

  it("keeps the cohort switcher keyboard-addressable and the empty state honest", () => {
    const html = renderToStaticMarkup(<PublicMembersWall founding={[]} early={[]} primaryAction={{ href: "/waitlist", label: "Request access" }} />);
    expect(html).toContain('role="tablist"');
    expect(html).toContain('role="tab"');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain('role="tabpanel"');
    expect(html).toContain("No public members yet.");
    expect(html).toContain("Only members who choose public visibility appear on the wall. Founding 25 identities exist whether or not they are shown here.");
    expect(html).toContain("Early 100 identities exist whether or not they are shown here.");
    expect(html).not.toContain("/25<");
    const source = readFileSync(join(process.cwd(), "src/components/members/public-members-wall.tsx"), "utf8");
    expect(source).toContain("onKeyDown");
    expect(source).toContain("ArrowRight");
    expect(source).toContain("ArrowLeft");
    expect(source).toContain("Home");
    expect(source).toContain("End");
  });
});
