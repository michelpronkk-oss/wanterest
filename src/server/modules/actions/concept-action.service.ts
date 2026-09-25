import type { ProductRow, ProductSnapshotRow } from "../../db/database.helpers";
import { DEMAND_CLUSTERING_VERSION, staleBefore } from "../demand-intelligence/demand-clustering.policy";
import { CONCEPT_DRIFT_STATE_POLICY_VERSION, CONCEPT_GAP_STATE_POLICY_VERSION, CONCEPT_MARKET_STATE_POLICY_VERSION, conceptMarketStateInputFingerprint } from "../demand-intelligence/concept-market-state.policy";
import type { ConceptMarketStateRepository } from "../demand-intelligence/concept-market-state.repository";
import type { ConceptMarketStateService } from "../demand-intelligence/concept-market-state.service";
import type { IntelligenceRepository } from "../intelligence/intelligence.repository";
import { actionCandidateIsQualified } from "./action.engines";
import { actionInputFromConceptDrift, actionInputFromConceptGap } from "./action.candidates";
import type { DemandActionEngine } from "./action.engines";
import type { DemandActionService } from "./action.service";

const DRIFT_WINDOWS = ["7d", "30d", "90d"] as const;

export type ConceptActionNonGenerationReason = "no_market_state" | "basis_currentness_mismatch" | "basis_positioning_mismatch" | "basis_stale" | "not_eligible" | "actions_enabled" | "actions_engine_declined" | "usage_limit";

export type ConceptActionAttempt = { conceptKey: string; window?: string; triggerType: "concept_gap" | "concept_drift"; outcome: "generated" | "skipped"; reason?: ConceptActionNonGenerationReason; actionId?: string };

export type ConceptActionGenerationResult = { attempts: ConceptActionAttempt[]; actionsCreated: number };

/**
 * Wanterest Layer 9C: generates Actions only from a persisted, live-validated
 * concept_gap_states / concept_drift_states basis. Plan gating happens in the
 * caller (action.orchestration.ts), before this runs. See docs/architecture.md
 * Section 18, "Action basis" / "Drift Action basis".
 */
export class ConceptActionService {
  constructor(
    private readonly stateRepository: ConceptMarketStateRepository,
    private readonly marketStateService: ConceptMarketStateService,
    private readonly actionService: DemandActionService,
    private readonly intelligence: IntelligenceRepository,
  ) {}

  private async currentPositioningSnapshot(product: ProductRow): Promise<ProductSnapshotRow | null> {
    const snapshots = await this.intelligence.getProductSnapshots(product.id);
    return snapshots.find((row) => row.id === product.current_snapshot_id) ?? snapshots.at(-1) ?? null;
  }

  async generateEligibleActions(input: { product: ProductRow; now: Date; actionEngineVersionId?: string; engine?: DemandActionEngine }): Promise<ConceptActionGenerationResult> {
    const { product, now } = input;
    const attempts: ConceptActionAttempt[] = [];
    let actionsCreated = 0;

    const marketStates = await this.stateRepository.listLatestMarketStates(product.workspace_id, product.id, DEMAND_CLUSTERING_VERSION, CONCEPT_MARKET_STATE_POLICY_VERSION);
    const marketByConcept = new Map(marketStates.map((row) => [row.anchor_concept_key, row]));
    // One live currentness read, reused for every concept this run considers — never one per candidate.
    const liveConcepts = await this.marketStateService.liveConcepts(product.workspace_id, product.id, now);
    const liveFingerprintByConcept = new Map(liveConcepts.map((concept) => [concept.conceptKey, concept]));
    const positioning = await this.currentPositioningSnapshot(product);

    const record = (attempt: ConceptActionAttempt) => attempts.push(attempt);
    const staleBeforeIso = staleBefore(now);

    const gapStates = (await this.stateRepository.listLatestGapStates(product.workspace_id, product.id, DEMAND_CLUSTERING_VERSION, CONCEPT_GAP_STATE_POLICY_VERSION)).filter((row) => row.status === "scored");
    for (const gapState of gapStates) {
      const marketState = marketByConcept.get(gapState.anchor_concept_key);
      if (!marketState || marketState.id !== gapState.market_state_id) { record({ conceptKey: gapState.anchor_concept_key, triggerType: "concept_gap", outcome: "skipped", reason: "no_market_state" }); continue; }
      if (marketState.computed_at < staleBeforeIso) { record({ conceptKey: gapState.anchor_concept_key, triggerType: "concept_gap", outcome: "skipped", reason: "basis_stale" }); continue; }
      const liveConcept = liveFingerprintByConcept.get(gapState.anchor_concept_key);
      const liveFingerprint = liveConcept ? conceptMarketStateInputFingerprint(liveConcept) : null;
      if (liveFingerprint !== marketState.input_fingerprint) { record({ conceptKey: gapState.anchor_concept_key, triggerType: "concept_gap", outcome: "skipped", reason: "basis_currentness_mismatch" }); continue; }
      if (!positioning || positioning.id !== gapState.product_snapshot_id) { record({ conceptKey: gapState.anchor_concept_key, triggerType: "concept_gap", outcome: "skipped", reason: "basis_positioning_mismatch" }); continue; }
      const candidate = actionInputFromConceptGap(product, gapState, marketState, { actionEngineVersionId: input.actionEngineVersionId });
      if (!actionCandidateIsQualified(candidate)) { record({ conceptKey: gapState.anchor_concept_key, triggerType: "concept_gap", outcome: "skipped", reason: "not_eligible" }); continue; }
      const result = await this.actionService.generateActions(candidate, input.engine);
      if (result.actions.length) { actionsCreated += 1; record({ conceptKey: gapState.anchor_concept_key, triggerType: "concept_gap", outcome: "generated", actionId: result.actions[0].id }); }
      else record({ conceptKey: gapState.anchor_concept_key, triggerType: "concept_gap", outcome: "skipped", reason: (result.suppressed[0] as ConceptActionNonGenerationReason | undefined) ?? "not_eligible" });
    }

    for (const window of DRIFT_WINDOWS) {
      const driftStates = (await this.stateRepository.listLatestDriftStates(product.workspace_id, product.id, DEMAND_CLUSTERING_VERSION, CONCEPT_DRIFT_STATE_POLICY_VERSION, window))
        .filter((row) => row.comparable && row.direction === "rising" && (row.significance === "notable" || row.significance === "strong"));
      for (const driftState of driftStates) {
        const marketState = marketByConcept.get(driftState.anchor_concept_key);
        if (!marketState || marketState.id !== driftState.market_state_id) { record({ conceptKey: driftState.anchor_concept_key, window, triggerType: "concept_drift", outcome: "skipped", reason: "no_market_state" }); continue; }
        if (marketState.computed_at < staleBeforeIso) { record({ conceptKey: driftState.anchor_concept_key, window, triggerType: "concept_drift", outcome: "skipped", reason: "basis_stale" }); continue; }
        const liveConcept = liveFingerprintByConcept.get(driftState.anchor_concept_key);
        const liveFingerprint = liveConcept ? conceptMarketStateInputFingerprint(liveConcept) : null;
        if (liveFingerprint !== marketState.input_fingerprint) { record({ conceptKey: driftState.anchor_concept_key, window, triggerType: "concept_drift", outcome: "skipped", reason: "basis_currentness_mismatch" }); continue; }
        const candidate = actionInputFromConceptDrift(product, driftState, marketState, { actionEngineVersionId: input.actionEngineVersionId });
        if (!actionCandidateIsQualified(candidate)) { record({ conceptKey: driftState.anchor_concept_key, window, triggerType: "concept_drift", outcome: "skipped", reason: "not_eligible" }); continue; }
        const result = await this.actionService.generateActions(candidate, input.engine);
        if (result.actions.length) { actionsCreated += 1; record({ conceptKey: driftState.anchor_concept_key, window, triggerType: "concept_drift", outcome: "generated", actionId: result.actions[0].id }); }
        else record({ conceptKey: driftState.anchor_concept_key, window, triggerType: "concept_drift", outcome: "skipped", reason: (result.suppressed[0] as ConceptActionNonGenerationReason | undefined) ?? "not_eligible" });
      }
    }

    return { attempts, actionsCreated };
  }
}
