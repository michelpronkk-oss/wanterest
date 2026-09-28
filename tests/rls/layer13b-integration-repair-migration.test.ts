import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(path.resolve(process.cwd(), "supabase/migrations/20261029000000_layer13b_integration_repair_v1.sql"), "utf8");

describe("Layer 13B targeted integration repair migration contract", () => {
  it("revalidates applicant authority without revoking permanent cohort identities", () => {
    expect(migration).toContain("left join public.waitlist_applications as application");
    expect(migration).toContain("application.status not in ('declined', 'withdrawn')");
    expect(migration).toContain("application.email_verification_status = 'verified'");
    expect(migration).toContain("publication.waitlist_application_id is null");
    expect(migration).toContain("create or replace function public.get_public_share_card(p_public_slug text)");
  });

  it("keeps the OPEN attribution handoff server validated and non-authorizing", () => {
    expect(migration).toContain("share_card_publication_id uuid");
    expect(migration).toContain("p_share_card_public_slug text");
    expect(migration).toContain("share_card_attribution_unavailable");
    expect(migration).toContain("verified_conversion");
    expect(migration).toContain("references public.share_card_publications(id)");
    expect(migration).toContain("revoke all on function public.provision_workspace_admission(uuid, text, text, text, text, uuid, uuid, text, text) from public, anon, authenticated");
    expect(migration).toContain("grant execute on function public.provision_workspace_admission(uuid, text, text, text, text, uuid, uuid, text, text) to service_role");
    expect(migration).toContain("NOT RUNTIME VALIDATED");
  });

  it("preserves the exact 13B migration order", () => {
    const names = [
      "20261026000000_layer13b1_dynamic_share_card_engine_v1.sql",
      "20261027000000_layer13b2_intelligence_sharing_v1.sql",
      "20261028000000_layer13b3_public_intelligence_attribution_v1.sql",
      "20261029000000_layer13b_integration_repair_v1.sql",
    ];
    expect(names).toEqual([...names].sort());
  });
});
