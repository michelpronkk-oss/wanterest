import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { publicProfileUrlPolicy } from "@/shared/public-profile-url";
const sql = readFileSync(join(process.cwd(), "supabase/migrations/20261031000000_f1_6a_public_identity_url_authority.sql"), "utf8");

describe("public URL forward migration (static, NOT_RUNTIME_VALIDATED)", () => {
  it("mirrors the TS policy patterns and credential keys", () => {
    for (const pattern of [publicProfileUrlPolicy.authority, publicProfileUrlPolicy.hostname, publicProfileUrlPolicy.privateSuffix, publicProfileUrlPolicy.privatePath, publicProfileUrlPolicy.privateStorage, publicProfileUrlPolicy.privateApplication]) expect(sql).toContain(`'${pattern}'`);
    const keys = /v_credential_keys text\[\] := array\[([^\]]+)\]/.exec(sql)![1].split(",").map((entry) => entry.replace(/'/g, ""));
    expect(keys).toEqual([...publicProfileUrlPolicy.credentialKeys]);
    expect(sql).toContain("convert_from(v_bytes, 'UTF8')");
    expect(sql).toContain("if p_value is null or length(p_value) > 2048 then return null");
    expect(sql).toContain("v_path ~* '%[0-9a-f]{2}'");
  });
  it("guards new writes but permits visibility-only revocation of unchanged legacy URLs", () => {
    expect(sql).toContain("before insert or update on public.workspace_public_cohort_profiles");
    for (const field of ["logo_url", "avatar_url", "website_url"]) expect(sql).toContain(`new.${field} is distinct from old.${field} and not public.is_public_cohort_url(new.${field})`);
    expect(sql).not.toMatch(/update public.workspace_public_cohort_profiles|set wall_visible|set pass_visible|delete from/i);
    expect(sql).toContain("errcode = '22023', message = 'public_cohort_url_invalid'");
  });
  it("masks all three URL fields in each public RPC without changing consent/tenancy predicates", () => {
    for (const field of ["logo_url", "avatar_url", "website_url"]) expect(sql.split(`case when public.is_public_cohort_url(profile.${field}) then profile.${field} else null::text end`)).toHaveLength(3);
    expect(sql).toContain("profile.wall_visible = true and membership.cohort = p_cohort");
    expect(sql).toContain("profile.pass_visible = true");
    expect(sql.split("membership.workspace_id = profile.workspace_id and membership.id = profile.cohort_membership_id")).toHaveLength(3);
    expect(sql.split("workspace.status = 'active'")).toHaveLength(3);
  });
  it("keeps search paths constrained and exposes no public mutation grant", () => {
    expect(sql).toContain("security invoker set search_path = ''");
    expect(sql.split("security definer set search_path = ''")).toHaveLength(3);
    expect(sql).toContain("revoke all on function public.guard_public_cohort_profile_urls() from public, anon, authenticated");
    expect(sql).toContain("grant execute on function public.get_public_cohort_wall(text), public.get_public_cohort_profile(text) to anon, authenticated, service_role");
    expect(sql).not.toMatch(/grant .*on public\.workspace_public_cohort_profiles/i);
  });
});
