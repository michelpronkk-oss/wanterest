import { describe, expect, it } from "vitest";

import type { DemandDriftRow, DemandSnapshotRow } from "../../src/server/db/database.helpers";
import { DemandIntelligenceService, InMemoryDemandRepository } from "../../src/server/modules/demand-intelligence";
import { selectComparableDrifts } from "../../src/server/modules/demand-intelligence/drift-comparability";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const otherWorkspaceId = "99999999-9999-4999-8999-999999999999";
const productId = "22222222-2222-4222-8222-222222222222";

function snapshot(id: string, periodStart: string, periodEnd: string, workspace_id = workspaceId, window_type = "30d") {
  return { id, workspace_id, product_id: productId, window_type, period_start: periodStart, period_end: periodEnd, created_at: periodEnd } as unknown as DemandSnapshotRow;
}

function drift(id: string, current_snapshot_id: string, previous_snapshot_id: string, workspace_id = workspaceId) {
  return { id, workspace_id, product_id: productId, current_snapshot_id, previous_snapshot_id, share_delta: 0.2 } as unknown as DemandDriftRow;
}

describe("P2.2B targeted demand reads", () => {
  it("keeps Gap latest-snapshot selection bounded and workspace/product scoped", async () => {
    const repository = new InMemoryDemandRepository();
    repository.snapshots.set("old-30d", snapshot("old-30d", "2026-07-27T00:00:00.000Z", "2026-08-26T00:00:00.000Z"));
    repository.snapshots.set("latest-7d", snapshot("latest-7d", "2026-09-17T00:00:00.000Z", "2026-09-24T00:00:00.000Z", workspaceId, "7d"));
    repository.snapshots.set("latest-30d", snapshot("latest-30d", "2026-08-26T00:00:00.000Z", "2026-09-25T00:00:00.000Z"));
    repository.snapshots.set("other-workspace", snapshot("other-workspace", "2026-09-24T00:00:00.000Z", "2026-09-26T00:00:00.000Z", otherWorkspaceId));
    const service = new DemandIntelligenceService(repository, {} as never);

    await expect(service.getDemandGap(workspaceId, productId)).resolves.toMatchObject({ snapshotId: "latest-30d" });
    await expect(service.getDemandGap(workspaceId, productId, "latest-7d")).resolves.toMatchObject({ snapshotId: "latest-7d" });
    await expect(service.getDemandGap(workspaceId, productId, "other-workspace")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("returns the same newest comparable drift pair without loading unrelated pair rows", async () => {
    const repository = new InMemoryDemandRepository();
    const previous = snapshot("previous", "2026-07-27T00:00:00.000Z", "2026-08-26T00:00:00.000Z");
    const current = snapshot("current", "2026-08-26T00:00:00.000Z", "2026-09-25T00:00:00.000Z");
    const overlappingPrevious = snapshot("overlap-previous", "2026-07-27T00:00:00.000Z", "2026-08-26T00:00:00.000Z");
    const overlappingCurrent = snapshot("overlap-current", "2026-08-26T01:00:00.000Z", "2026-09-25T01:00:00.000Z");
    for (const row of [previous, current, overlappingPrevious, overlappingCurrent]) repository.snapshots.set(row.id, row);
    repository.drifts.set("valid-drift", drift("valid-drift", current.id, previous.id));
    repository.drifts.set("overlap-drift", drift("overlap-drift", overlappingCurrent.id, overlappingPrevious.id));
    repository.drifts.set("cross-workspace-drift", drift("cross-workspace-drift", overlappingCurrent.id, overlappingPrevious.id, otherWorkspaceId));
    const service = new DemandIntelligenceService(repository, {} as never);

    const allRows = [...repository.drifts.values()].filter((row) => row.workspace_id === workspaceId);
    const legacy = selectComparableDrifts(await repository.listSnapshots(workspaceId, productId, "30d"), allRows, "30d");
    const targeted = await service.getDemandDrift(workspaceId, productId, "30d");
    expect(targeted.currentSnapshotId).toBe(legacy?.current.id);
    expect(targeted.previousSnapshotId).toBe(legacy?.previous.id);
    expect(targeted.drifts.map((row) => row.id)).toEqual(["valid-drift"]);
  });
});
