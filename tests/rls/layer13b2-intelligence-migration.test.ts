import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(path.resolve(process.cwd(), "supabase/migrations/20261027000000_layer13b2_intelligence_sharing_v1.sql"), "utf8");

describe("Layer 13B.2 intelligence sharing migration contract", () => {
  it("keeps intelligence publications workspace/product/source scoped", () => {
    expect(migration).toContain("share_card_publications_product_fk");
    expect(migration).toContain("share_card_publications_intelligence_shape_check");
    expect(migration).toContain("share_card_publications_workspace_intelligence_source_idx");
    expect(migration).toContain("source_evidence_node_id uuid references public.evidence_nodes(id)");
  });

  it("revalidates live authority before publishing and serving", () => {
    expect(migration).toContain("lifecycle_status in ('active', 'saved')");
    expect(migration).toContain("status = 'active'");
    expect(migration).toContain("signal.evidence_node_id = publication.source_evidence_node_id");
    expect(migration).toContain("product.status = 'active'");
    expect(migration).toContain("NOT RUNTIME VALIDATED");
  });

  it("keeps the public surface and mutation grants narrow", () => {
    expect(migration).toContain("revoke all on function public.publish_share_card(uuid, uuid, text, text, jsonb, uuid, uuid, uuid, uuid) from public, anon, authenticated");
    expect(migration).toContain("grant execute on function public.get_public_share_card(text) to anon, authenticated, service_role");
    expect(migration).not.toContain("grant execute on function public.publish_share_card(uuid, uuid, text, text, jsonb, uuid, uuid, uuid, uuid) to anon");
    expect(migration).toContain("card_kind text");
    expect(migration).not.toContain("source_url text");
  });
});
