import "server-only";

import type { ProductRow } from "@/server/db/database.helpers";
import { capabilityAllows } from "@/server/modules/entitlements/entitlement-policy";
import { getWorkspaceEntitlement } from "@/server/modules/entitlements/entitlement.repository";
import { ensureEngineVersion } from "@/server/modules/observability/engine.repository";
import { createSupabaseServiceClient } from "@/server/providers/supabase/service";
import { SupabaseDemandRepository } from "../demand-intelligence/demand.repository";
import { actionInputFromDrift, actionInputFromGap, actionInputFromSnapshot } from "./action.candidates";
import { SupabaseActionRepository } from "./action.repository";
import { DemandActionService } from "./action.service";

export type ActionGenerationForScanResult = {
  actionsUpdated: number;
  warnings: string[];
};

export async function generateActionsForScan(input: { product: ProductRow; traceId?: string }): Promise<ActionGenerationForScanResult> {
  const client = createSupabaseServiceClient();
  const entitlement = await getWorkspaceEntitlement(client, input.product.workspace_id, "actions_enabled");
  if (!capabilityAllows(entitlement.value)) return { actionsUpdated: 0, warnings: ["Actions are not enabled for this workspace plan."] };

  const demand = new SupabaseDemandRepository(client);
  const snapshots = await demand.listSnapshots(input.product.workspace_id, input.product.id);
  const latestSnapshot = snapshots[0];
  if (!latestSnapshot) return { actionsUpdated: 0, warnings: ["Actions were skipped because no demand snapshot was available."] };

  const engineVersion = await ensureEngineVersion(client, {
    engine_type: "action",
    version: "demand-actions-v1",
    model: "deterministic",
    prompt_version: "demand-actions-v1",
    config_hash: null,
    metadata: { workflow: "product-demand-scan", traceId: input.traceId ?? null },
  });
  const service = new DemandActionService(new SupabaseActionRepository(client), { can: async () => true });
  let actionsUpdated = 0;
  const warnings: string[] = [];
  const gaps = await demand.listGaps(input.product.workspace_id, input.product.id, latestSnapshot.id);
  for (const gap of gaps.slice(0, 5)) {
    try {
      actionsUpdated += (await service.generateActions(actionInputFromGap(input.product, gap, { actionEngineVersionId: engineVersion.id }))).actions.length;
    } catch (error) {
      warnings.push(error instanceof Error ? `Gap action skipped: ${error.message.slice(0, 180)}` : "Gap action skipped.");
    }
  }
  const drifts = await demand.listDrifts(input.product.workspace_id, input.product.id, latestSnapshot.id);
  for (const drift of drifts.slice(0, 5)) {
    try {
      actionsUpdated += (await service.generateActions(actionInputFromDrift(input.product, drift, { actionEngineVersionId: engineVersion.id }))).actions.length;
    } catch (error) {
      warnings.push(error instanceof Error ? `Drift action skipped: ${error.message.slice(0, 180)}` : "Drift action skipped.");
    }
  }
  if (!gaps.length && !drifts.length) {
    try {
      actionsUpdated += (await service.generateActions(actionInputFromSnapshot(input.product, latestSnapshot, { actionEngineVersionId: engineVersion.id }))).actions.length;
    } catch (error) {
      warnings.push(error instanceof Error ? `Snapshot action skipped: ${error.message.slice(0, 180)}` : "Snapshot action skipped.");
    }
  }
  return { actionsUpdated, warnings };
}
