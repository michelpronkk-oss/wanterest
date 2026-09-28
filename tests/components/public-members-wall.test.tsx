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
    expect(html).toContain("The people building");
    expect(html).toContain("Founding 25");
    expect(html).toContain("#0007");
    expect(html).toContain("Northwind");
    expect(html).toContain("Visible by choice");
    expect(html).not.toContain("/members/northwind");
    expect(html).not.toContain("View public pass");
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
    expect(html).toContain("Only members who have chosen public visibility appear on this wall.");
    const source = readFileSync(join(process.cwd(), "src/components/members/public-members-wall.tsx"), "utf8");
    expect(source).toContain("onKeyDown");
    expect(source).toContain("ArrowRight");
    expect(source).toContain("ArrowLeft");
    expect(source).toContain("Home");
    expect(source).toContain("End");
  });
});
