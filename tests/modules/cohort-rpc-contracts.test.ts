import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CohortDatabase, CohortDatabaseFunctions, PublicCohortRpcRow, PrivateCohortProfileRpcRow } from "@/server/db/cohort-contracts";

const source = (name: string) => readFileSync(join(process.cwd(), "supabase/migrations", name), "utf8");
const cohort = source("20260927202715_layer13a2_cohort_membership_identity_v1.sql");
const assignment = source("20260927212000_layer13a2_cohort_rpc_repair.sql");
const benefits = source("20260927212230_layer13a2b_cohort_benefits_billing_v1.sql");
const profiles = source("20260928004407_layer13a4_public_cohort_profiles_v1.sql");
const upsert = source("20260928012224_layer13a4_monogram_normalization_repair.sql");
const repair = source("20261031000000_f1_6a_public_identity_url_authority.sql");
const publicColumns = ["public_slug", "display_name", "logo_url", "avatar_url", "monogram", "headline", "website_url", "cohort", "cohort_number", "cohort_limit", "assigned_at"] as const satisfies readonly (keyof PublicCohortRpcRow)[];
const privateColumns = ["profile_id", "workspace_id", ...publicColumns.slice(0, 7), "wall_visible", "pass_visible", ...publicColumns.slice(7)] as const satisfies readonly (keyof PrivateCohortProfileRpcRow)[];
const allPublicColumnsCovered: Exclude<keyof PublicCohortRpcRow, typeof publicColumns[number]> extends never ? true : false = true;
const publicSqlTypes: Record<keyof PublicCohortRpcRow, string> = {
  public_slug: "text", display_name: "text", logo_url: "text", avatar_url: "text", monogram: "text", headline: "text", website_url: "text", cohort: "text", cohort_number: "integer", cohort_limit: "integer", assigned_at: "timestamptz",
};

function signature(sql: string, name: string) {
  const match = new RegExp(`function public\\.${name}\\(([\\s\\S]*?)\\)\\s*returns table\\s*\\(([\\s\\S]*?)\\)`, "i").exec(sql);
  if (!match) throw new Error(`Missing SQL signature: ${name}`);
  return { args: match[1].split(",").map((entry) => entry.trim().split(/\s+/)[0]), columns: match[2].split(",").map((entry) => entry.trim().split(/\s+/)[0]) };
}
const privateArgs: CohortDatabaseFunctions["upsert_workspace_public_cohort_profile"]["Args"] = {
  p_workspace_id: "workspace", p_public_slug: "company", p_display_name: null, p_logo_url: null,
  p_avatar_url: null, p_monogram: null, p_headline: null, p_website_url: null,
  p_wall_visible: false, p_pass_visible: true, p_trace_id: null,
};
const identity: CohortDatabaseFunctions["get_workspace_cohort_identity"]["Returns"][number] = { workspace_id: "workspace", cohort: "none", cohort_number: null, assigned_at: null, cohort_limit: null, display_identity: null, workspace_status: "active" };

describe("explicit migration-reviewed cohort contract coverage", () => {
  it("matches exact public return order before and after the forward repair", () => {
    expect(allPublicColumnsCovered).toBe(true);
    for (const sql of [profiles, repair]) {
      expect(signature(sql, "get_public_cohort_wall")).toEqual({ args: ["p_cohort"], columns: [...publicColumns] });
      expect(signature(sql, "get_public_cohort_profile")).toEqual({ args: ["p_public_slug"], columns: [...publicColumns] });
      for (const name of ["get_public_cohort_wall", "get_public_cohort_profile"]) {
        const fields = new RegExp(`function public\\.${name}\\([\\s\\S]*?returns table\\s*\\(([\\s\\S]*?)\\)`, "i").exec(sql)![1];
        expect(Object.fromEntries(fields.split(",").map((entry) => entry.trim().split(/\s+/)))).toEqual(publicSqlTypes);
      }
    }
  });
  it("matches private read/write/initialization signatures and optional consent", () => {
    expect(signature(upsert, "upsert_workspace_public_cohort_profile")).toEqual({ args: Object.keys(privateArgs), columns: [...privateColumns] });
    expect(signature(profiles, "get_workspace_public_cohort_profile").columns).toEqual([...privateColumns]);
    expect(signature(profiles, "initialize_workspace_public_cohort_profile").args).toEqual(["p_workspace_id", "p_public_slug", "p_trace_id"]);
  });
  it("covers assignment wrapper outputs without inventing private identity fields", () => {
    expect(signature(cohort, "get_workspace_cohort_identity").columns).toEqual(Object.keys(identity));
    expect(signature(benefits, "assign_workspace_cohort_membership_with_benefit").columns).toEqual([...signature(assignment, "assign_workspace_cohort_membership").columns, "benefit_policy_key", "benefit_status"]);
    expect(identity).not.toHaveProperty("benefit_policy_key");
  });
  it("provides table insert/nullable contracts while leaving runtime authority to SQL", () => {
    const profile: CohortDatabase["public"]["Tables"]["workspace_public_cohort_profiles"]["Insert"] = { workspace_id: "workspace", cohort_membership_id: "membership", public_slug: "company", display_name: "Company" };
    const membership: CohortDatabase["public"]["Tables"]["workspace_cohort_memberships"]["Insert"] = { workspace_id: "workspace", cohort: "founding_25", cohort_number: 1 };
    expect(profile).not.toHaveProperty("pass_visible");
    expect(membership.cohort_number).toBe(1);
    expect(profiles).toMatch(/foreign key \(workspace_id, cohort_membership_id\)[\s\S]*references public.workspace_cohort_memberships \(workspace_id, id\)/);
  });
});
