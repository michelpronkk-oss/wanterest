import "server-only";

import type { ProductRow } from "@/server/db/database.helpers";
import { selectComparableDrifts } from "@/server/modules/demand-intelligence/drift-comparability";
import { capabilityAllows } from "@/server/modules/entitlements/entitlement-policy";
import { getWorkspaceEntitlement } from "@/server/modules/entitlements/entitlement.repository";
import { ensureEngineVersion } from "@/server/modules/observability/engine.repository";
import { getServerEnv } from "@/server/lib/env";
import { legacyActionGenerationPauseReason } from "./action.schemas";
import { createSupabaseServiceClient } from "@/server/providers/supabase/service";
import { SupabaseDemandRepository } from "../demand-intelligence/demand.repository";
import { actionInputFromDrift, actionInputFromGap, actionInputFromGeoMarket, actionInputFromSnapshot } from "./action.candidates";
import { GeographyService } from "../geography/geography.service";
import { resolveWorkspaceCapabilities } from "../entitlements/plan-capabilities";
import { SupabaseIntelligenceRepository } from "../intelligence/intelligence.repository";
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

  // Layer 9B: none of the legacy triggers below (gap, drift, snapshot fallback,
  // geography) carry a lifecycle-verified Stage 2G concept basis. Rather than
  // generate an Action that could rest on superseded/invalidated/stale evidence,
  // generation is paused until Layer 9C adds a verified concept trigger. Existing
  // persisted Actions are never touched here. See docs/architecture.md §17.
  const pauseReason = legacyActionGenerationPauseReason(getServerEnv().DOWNSTREAM_INTELLIGENCE_V2_ENABLED === "true");
  if (pauseReason) return { actionsUpdated: 0, warnings: [pauseReason] };

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
  // Actions only originate from comparable (adjacent-window) drift.
  const drifts = selectComparableDrifts(await demand.listSnapshots(input.product.workspace_id, input.product.id), await demand.listDrifts(input.product.workspace_id, input.product.id))?.drifts ?? [];
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
  // Geo actions are deliberately conservative: one market-aware positioning
  // hypothesis is emitted only when the market meets the same minimum sample
  // gate used by the Geography surface.
  try {
    const capabilities = await resolveWorkspaceCapabilities(client, input.product.workspace_id);
    const geographyService = new GeographyService(demand, new SupabaseIntelligenceRepository(client));
    const geographyAccess = {
      enabled: capabilities.geography.enabled,
      historyDays: capabilities.geography.historyDays,
      trendEnabled: capabilities.geography.trendEnabled && capabilities.geography.historyDays >= 30,
      maxMarkets: capabilities.geography.maxMarkets,
      countryDrilldown: capabilities.geography.countryDrilldown,
      regionDrilldown: capabilities.geography.regionDrilldown,
      regionalHistoryDays: capabilities.geography.regionalHistoryDays,
      comparisonEnabled: capabilities.geography.comparisonEnabled,
      upgradeHint: null,
    };
    const geography = await geographyService.getGeography({
      product: input.product,
      window: "30d",
      periodEnd: latestSnapshot.period_end,
      access: geographyAccess,
    });
    let market = geography.topMarkets.find((candidate) => candidate.qualifiedSignalCount >= 5 && candidate.recommendedAction);
    if (!market && geographyAccess.regionDrilldown) {
      for (const country of geography.topMarkets.slice(0, 3)) {
        const regional = await geographyService.getGeography({ product: input.product, window: "30d", periodEnd: latestSnapshot.period_end, access: geographyAccess, selection: { countryCode: country.countryCode } });
        const regionalMarket = regional.topMarkets.find((candidate) => candidate.level === "region" && candidate.qualifiedSignalCount >= 5 && candidate.recommendedAction);
        if (regionalMarket) { market = regionalMarket; break; }
      }
    }
    if (market) actionsUpdated += (await service.generateActions(actionInputFromGeoMarket(input.product, latestSnapshot, market, { actionEngineVersionId: engineVersion.id }))).actions.length;
  } catch (error) {
    warnings.push(error instanceof Error ? `Geo action skipped: ${error.message.slice(0, 180)}` : "Geo action skipped.");
  }
  return { actionsUpdated, warnings };
}
