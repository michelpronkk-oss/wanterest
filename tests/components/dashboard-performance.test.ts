import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("dashboard responsiveness contracts", () => {
  it("streams inbox aggregation instead of blocking the persistent shell", () => {
    const source = read("src/components/dashboard/dashboard-shell.tsx");
    expect(source).toContain("<Suspense");
    expect(source).toContain("getInboxItems(topBarProps.workspaceId, topBarProps.productId)");
    expect(source).not.toContain("await getInboxItems");
  });

  it("keeps scan progress polling narrow and visibility-aware", () => {
    const banner = read("src/components/dashboard/scan-status-banner.tsx");
    const modal = read("src/components/dashboard/scan-progress-modal.tsx");
    const onboarding = read("src/components/onboarding/onboarding-scan-status.tsx");

    expect(banner).toContain("visibilitychange");
    expect(banner.match(/router\.refresh\(\)/g)?.length ?? 0).toBe(1);
    expect(modal).toContain("visibilitychange");
    expect(modal).not.toContain("window.location.assign");
    expect(onboarding).toContain("visibilitychange");
  });

  it("uses route-level skeletons for dashboard and settings transitions", () => {
    expect(read("src/app/app/(product)/loading.tsx")).toContain("DashboardPageSkeleton");
    expect(read("src/app/app/settings/loading.tsx")).toContain("DashboardPageSkeleton");
    expect(read("src/app/app/loading.tsx")).toContain("DashboardPageSkeleton");
  });
});
