import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(path.resolve(process.cwd(), "supabase/migrations/20261028000000_layer13b3_public_intelligence_attribution_v1.sql"), "utf8");

describe("Layer 13B.3 public intelligence migration contract", () => {
  it("keeps the existing public route projection narrow and evidence-aware", () => {
    expect(migration).toContain("create or replace function public.get_public_share_card(p_public_slug text)");
    expect(migration).toContain("claim_type text");
    expect(migration).toContain("observation_period text");
    expect(migration).toContain("uncertainty text");
    expect(migration).toContain("case when coalesce(publication.snapshot ->> 'sourceUrl'");
    expect(migration).not.toContain("workspace_id,");
    expect(migration).not.toContain("product_id,");
  });

  it("rechecks current source authority and current access CTA", () => {
    expect(migration).toContain("publication.publication_state = 'published'");
    expect(migration).toContain("signal.lifecycle_status in ('active', 'saved')");
    expect(migration).toContain("product.status = 'active'");
    expect(migration).toContain("/signup?source=share_card");
    expect(migration).toContain("/waitlist?source=share_card");
    expect(migration).toContain("NOT RUNTIME VALIDATED");
  });

  it("does not expose public mutation execution", () => {
    expect(migration).toContain("revoke all on function public.get_public_share_card(text) from public, anon, authenticated");
    expect(migration).toContain("grant execute on function public.get_public_share_card(text) to anon, authenticated, service_role");
    expect(migration).not.toContain("grant execute on function public.publish_share_card");
  });
});
