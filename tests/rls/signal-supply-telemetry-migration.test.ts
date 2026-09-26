import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** Static contract for 20261020000000_signal_supply_telemetry_v1.sql (behaviour proven on real Postgres). */
const name = "20261020000000_signal_supply_telemetry_v1.sql";
const migration = readFileSync(`supabase/migrations/${name}`, "utf8");

describe("Layer 12A.1 migration contract", () => {
  it("sorts after Layer 11, is additive and backfills nothing", () => {
    const files = readdirSync("supabase/migrations").filter((file) => file.endsWith(".sql")).sort();
    expect(files.indexOf(name)).toBe(files.indexOf("20261019000000_experiment_measurement_v1.sql") + 1);
    expect(migration).not.toMatch(/\bdrop table\b|\bdelete from\b|\balter table public\.(product_match_evaluations|signals|conversations|job_runs|query_yield_artifacts)\b/i);
    expect(migration).not.toMatch(/insert into public\.(supply_refresh_facts|product_supply_facts)/i);
  });

  it("one immutable fact per job identity; explicit cost units that never mix", () => {
    expect(migration).toContain("job_run_id uuid not null unique references public.job_runs(id)");
    expect(migration).toContain("unique (refresh_job_run_id, product_id)");
    expect(migration).toContain("provider_cost_unit text not null check (provider_cost_unit in ('usd', 'quota_units', 'requests', 'unknown'))");
    expect(migration).toContain("check ((provider_cost_value is null) = (provider_cost_unit = 'unknown'))");
    expect(migration).toContain("check ((reasoning_cost_value is null) = (reasoning_cost_unit = 'unknown'))");
    expect(migration).toContain("create trigger supply_refresh_facts_immutable before update");
    expect(migration).toContain("create trigger product_supply_facts_immutable before update");
  });

  it("tenant facts use workspace RLS and a composite product FK; global facts have no browser access", () => {
    expect(migration).toContain("foreign key (workspace_id, product_id) references public.products(workspace_id, id) on delete cascade");
    expect(migration).toMatch(/create policy product_supply_facts_member_select on public\.product_supply_facts for select to authenticated\s+using \(public\.is_workspace_member\(workspace_id\)\)/);
    expect(migration).toContain("revoke all on public.supply_refresh_facts from public, anon, authenticated;");
    expect(migration).not.toMatch(/grant [a-z, ]+ on public\.supply_refresh_facts to (anon|authenticated)/i);
    expect(migration).not.toMatch(/grant (insert|update|delete)[a-z, ]* on public\.product_supply_facts to authenticated/i);
    expect(migration).toContain("create trigger product_supply_facts_scope before insert");
  });

  it("the funnel is bounded, service-role only, security invoker, and never sums costs across units", () => {
    expect(migration).toContain("p_until - p_since > interval '31 days'");
    expect(migration).toContain("revoke all on function public.signal_supply_funnel(timestamptz, timestamptz, uuid, uuid) from public, anon, authenticated;");
    expect(migration).toContain("grant execute on function public.signal_supply_funnel(timestamptz, timestamptz, uuid, uuid) to service_role;");
    expect(migration).not.toMatch(/security definer/i);
    expect(migration).toMatch(/group by source_key, provider_cost_unit/);
    expect(migration).toMatch(/group by workspace_id, product_id, reasoning_cost_unit/);
    expect(migration).toContain("'net', 'deferred'");
    expect(migration).toContain("si.source_key <> 'fixture'");
  });
});

describe("Layer 12A.1 frozen-system isolation", () => {
  const telemetry = readFileSync("src/server/modules/operations/signal-supply-telemetry.ts", "utf8");
  const refresh = readFileSync("src/server/modules/ingestion/market-partition-refresh.service.ts", "utf8");
  const incremental = readFileSync("src/server/modules/operations/incremental-product-matching.service.ts", "utf8");

  it("the telemetry module imports no discovery, selection, qualification, clustering or LLM code", () => {
    const imports = [...telemetry.matchAll(/from "([^"]+)"/g)].map((match) => match[1]);
    expect(imports).toEqual(["@supabase/supabase-js", "@/server/db/database.types"]);
    expect(telemetry).not.toMatch(/fetch\(|providers\/(llm|source)|openai/i);
  });

  it("frozen versions and caps are unchanged", async () => {
    const { SIGNAL_QUALIFICATION_VERSION } = await import("../../src/server/modules/intelligence/signal-qualification.config");
    const { SEMANTIC_REASONING_ROUTER_VERSION } = await import("../../src/server/modules/intelligence/semantic-reasoning-router");
    expect(SIGNAL_QUALIFICATION_VERSION).toBe("signal_qualification_v1_7");
    expect(SEMANTIC_REASONING_ROUTER_VERSION).toBe("semantic_reasoning_router_v2");
    const policy = readFileSync("src/server/modules/operations/incremental-product-matching.policy.ts", "utf8");
    expect(policy).toContain("export const INCREMENTAL_MATCH_MAX_EVALUATIONS_PER_PRODUCT = 15;");
    const refreshPolicy = readFileSync("src/server/modules/ingestion/market-partition-refresh.policy.ts", "utf8");
    expect(refreshPolicy).toContain('export const MARKET_PARTITION_REFRESH_SOURCE_KEYS = ["github", "stack-exchange", "hacker-news"] as const;');
    expect(refreshPolicy).toContain("export const MARKET_PARTITION_REFRESH_LIMIT = 10;");
  });

  it("telemetry is written only after the owning job is finalized and every write is guarded", () => {
    expect(refresh.indexOf('await recordSupplyFact("succeeded")')).toBeGreaterThan(refresh.indexOf('await completeJobRun(client, job.id, "succeeded", storedResult)'));
    expect(refresh.indexOf('await recordSupplyFact("succeeded")')).toBeGreaterThan(refresh.indexOf("await repository.recordSuccess({"));
    expect(incremental.indexOf("await deps.telemetry?.recordProduct(")).toBeGreaterThan(incremental.indexOf('await deps.repository.completeJob(job.id, { status: "succeeded"'));
    expect(refresh).toContain("// Telemetry is observational; it never fails a refresh.");
    expect(incremental).toContain("// Telemetry is observational; it never fails a product match.");
  });
});
