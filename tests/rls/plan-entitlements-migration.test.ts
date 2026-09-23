import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const catalogMigration = readFileSync(resolve(process.cwd(), "supabase/migrations/20261003000002_plan_entitlements_source_budget_v1.sql"), "utf8");
const enforcementMigration = readFileSync(resolve(process.cwd(), "supabase/migrations/20261003000003_plan_usage_and_seats_v1.sql"), "utf8");

describe("Plan Entitlements + Source Budget Matrix v1 migration contract", () => {
  it("converges all three internal catalogs and materializes current workspace revisions", () => {
    expect(catalogMigration).toContain("manual_scans_monthly");
    expect(catalogMigration).toContain("intelligence_cycle_max_sources");
    expect(catalogMigration).toContain("deep_refresh_max_sources");
    expect(catalogMigration).toContain("select distinct on (workspace_id)");
    expect(catalogMigration).toContain("source_subscription_id");
    expect(catalogMigration.toLowerCase()).not.toContain("scale");
  });

  it("keeps manual usage idempotent and excludes onboarding/monitoring from the manual allowance", () => {
    expect(enforcementMigration).toContain("scanProfile");
    expect(enforcementMigration).toContain("manual_standard");
    expect(enforcementMigration).toContain("manual_deep");
    expect(enforcementMigration).toContain("when unique_violation");
    expect(enforcementMigration).toContain("seat_limit_exceeded");
  });
});
