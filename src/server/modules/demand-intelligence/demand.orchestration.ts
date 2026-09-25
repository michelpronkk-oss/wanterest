import "server-only";

import type { ProductRow } from "@/server/db/database.helpers";
import { planDriftComparison } from "./drift-comparability";
import { ensureEngineVersion } from "@/server/modules/observability/engine.repository";
import { createSupabaseServiceClient } from "@/server/providers/supabase/service";
import { SupabaseIntelligenceRepository } from "../intelligence/intelligence.repository";
import { DemandIntelligenceService } from "./demand.service";
import { SupabaseDemandRepository } from "./demand.repository";
import { FixtureDemandThemeEngine } from "./demand.engines";
import type { DemandWindow } from "./demand.schemas";

export type DemandRebuildInput = {
  product: ProductRow;
  evaluationIds: string[];
  /** Positional with evaluationIds; null means the evaluation did not become a Signal. */
  signalIds: Array<string | null>;
  traceId?: string;
};

export type DemandRebuildResult = {
  observationsUpdated: number;
  mapUpdated: number;
  gapUpdated: number;
  driftUpdated: number;
  warnings: string[];
};

const windows: DemandWindow[] = ["7d", "30d", "90d"];

export async function rebuildDemandIntelligenceForScan(input: DemandRebuildInput): Promise<DemandRebuildResult> {
  const client = createSupabaseServiceClient();
  const intelligence = new SupabaseIntelligenceRepository(client);
  const warnings: string[] = [];
  const profile = input.product.current_demand_profile_id
    ? await intelligence.getDemandProfileById(input.product.current_demand_profile_id)
    : null;
  const snapshots = await intelligence.getProductSnapshots(input.product.id);
  const productSnapshot = snapshots.find((row) => row.id === input.product.current_snapshot_id) ?? snapshots.at(-1) ?? null;
  if (!profile || !productSnapshot) {
    return {
      observationsUpdated: 0,
      mapUpdated: 0,
      gapUpdated: 0,
      driftUpdated: 0,
      warnings: ["Demand intelligence was skipped because product understanding is incomplete."],
    };
  }

  const observationEngine = await ensureEngineVersion(client, {
    engine_type: "map",
    version: "demand-observation-v1",
    model: "deterministic",
    prompt_version: "demand-observation-v1",
    config_hash: null,
    metadata: { workflow: "product-demand-scan", stage: "observations", traceId: input.traceId ?? null },
  });
  const themeEngine = await ensureEngineVersion(client, {
    engine_type: "map",
    version: "demand-theme-v1",
    model: "deterministic",
    prompt_version: "demand-theme-v1",
    config_hash: null,
    metadata: { workflow: "product-demand-scan", stage: "themes", traceId: input.traceId ?? null },
  });
  const mapEngine = await ensureEngineVersion(client, {
    engine_type: "map",
    version: "demand-map-v1",
    model: "deterministic",
    prompt_version: "demand-map-v1",
    config_hash: null,
    metadata: { workflow: "product-demand-scan", stage: "map", traceId: input.traceId ?? null },
  });
  const gapEngine = await ensureEngineVersion(client, {
    engine_type: "gap",
    version: "demand-gap-v1",
    model: "deterministic",
    prompt_version: "demand-gap-v1",
    config_hash: null,
    metadata: { workflow: "product-demand-scan", stage: "gap", traceId: input.traceId ?? null },
  });
  const driftEngine = await ensureEngineVersion(client, {
    engine_type: "drift",
    version: "demand-drift-v1",
    model: "deterministic",
    prompt_version: "demand-drift-v1",
    config_hash: null,
    metadata: { workflow: "product-demand-scan", stage: "drift", traceId: input.traceId ?? null },
  });

  const repository = new SupabaseDemandRepository(client);
  const service = new DemandIntelligenceService(repository, intelligence);
  let observationsUpdated = 0;
  for (const [index, evaluationId] of input.evaluationIds.entries()) {
    const signalId = input.signalIds.length === input.evaluationIds.length ? input.signalIds[index] : null;
    try {
      observationsUpdated += (await service.materializeObservations(input.product, evaluationId, observationEngine.id, signalId)).length;
    } catch (error) {
      warnings.push(error instanceof Error ? `Observation ${evaluationId} skipped: ${error.message.slice(0, 180)}` : `Observation ${evaluationId} skipped.`);
    }
  }

  const snapshotsByWindow = new Map<DemandWindow, Awaited<ReturnType<typeof service.aggregateDemand>>[]>();
  let mapUpdated = 0;
  let gapUpdated = 0;
  for (const window of windows) {
    const snapshot = await service.aggregateDemand({
      product: input.product,
      profile,
      window,
      mapEngineVersionId: mapEngine.id,
      themeEngineVersionId: themeEngine.id,
      themeEngine: new FixtureDemandThemeEngine(),
    });
    if (window === "30d") mapUpdated = (await repository.listSnapshotThemes(snapshot.id)).length;
    const existing = await repository.listSnapshots(input.product.workspace_id, input.product.id, window);
    snapshotsByWindow.set(window, existing);
    gapUpdated += (await service.calculateDemandGap(input.product, productSnapshot, snapshot, gapEngine.id)).length;
  }

  // Drift comparability v1: compare day-anchored adjacent windows only, and
  // only once Wanterest has observed this market for the whole previous
  // window. Never "latest two snapshots", which overlap almost entirely.
  let driftUpdated = 0;
  const allSnapshots = [...snapshotsByWindow.values()].flat();
  const monitoringStartedAt = allSnapshots.length ? allSnapshots.map((row) => row.created_at).sort()[0] : null;
  for (const window of windows) {
    const plan = planDriftComparison({ window, now: new Date(), monitoringStartedAt });
    if (!plan.comparable) {
      warnings.push(`Drift ${window} skipped: ${plan.reason}.`);
      continue;
    }
    const aggregateInput = { product: input.product, profile, window, mapEngineVersionId: mapEngine.id, themeEngineVersionId: themeEngine.id, themeEngine: new FixtureDemandThemeEngine() };
    const current = await service.aggregateDemand({ ...aggregateInput, periodEnd: plan.currentPeriodEnd });
    const previous = await service.aggregateDemand({ ...aggregateInput, periodEnd: plan.previousPeriodEnd });
    driftUpdated += (await service.calculateDemandDrift(current, previous, driftEngine.id)).length;
  }

  return {
    observationsUpdated,
    mapUpdated,
    gapUpdated,
    driftUpdated,
    warnings,
  };
}
