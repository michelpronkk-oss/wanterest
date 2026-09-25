import type { ProductRow, ProductSnapshotRow } from "../../db/database.helpers";
import { DEMAND_CLUSTERING_VERSION } from "../demand-intelligence/demand-clustering.policy";
import { CONCEPT_DRIFT_STATE_POLICY_VERSION, CONCEPT_GAP_STATE_POLICY_VERSION, CONCEPT_MARKET_STATE_POLICY_VERSION } from "../demand-intelligence/concept-market-state.policy";
import type { ConceptDriftStateRow, ConceptGapStateRow, ConceptMarketStateRepository, ConceptMarketStateRow } from "../demand-intelligence/concept-market-state.repository";
import type { DemandMapConcept } from "../demand-intelligence/demand-map.policy";
import { CONCEPT_ACTION_DRIFT_WINDOWS, selectCanonicalConceptCandidate, type ConceptActionDriftWindow, type ConceptIdentity, type ConceptSelection, type ConceptSelectorInputs } from "./concept-action.selector";

/**
 * Wanterest Layer 10: one batched, bounded, read-only load per product feeding
 * the canonical selector. Every read is capped in the database (latest-state SQL
 * functions, single-row positioning/monitoring reads); the live roll-up is the
 * existing bounded DemandCurrentnessService read. No provider or LLM calls, no
 * writes, no per-Action queries. See docs/architecture.md Section 21.
 */
export type ConceptActionInputPorts = {
  states: Pick<ConceptMarketStateRepository, "listLatestMarketStates" | "listLatestGapStates" | "listLatestDriftStates">;
  liveConcepts(workspaceId: string, productId: string, now: Date): Promise<DemandMapConcept[]>;
  positioning(product: ProductRow): Promise<ProductSnapshotRow | null>;
  monitoringStartedAt(workspaceId: string, productId: string): Promise<string | null>;
};

export type ConceptActionInputs = {
  product: ProductRow;
  now: Date;
  clusteringVersion: string;
  markets: Map<string, ConceptMarketStateRow>;
  gaps: Map<string, ConceptGapStateRow>;
  drifts: Record<ConceptActionDriftWindow, Map<string, ConceptDriftStateRow>>;
  live: Map<string, DemandMapConcept>;
  positioning: ProductSnapshotRow | null;
  monitoringStartedAt: string | null;
};

function byConcept<T extends { anchor_concept_key: string }>(rows: T[]): Map<string, T> {
  return new Map(rows.map((row) => [row.anchor_concept_key, row]));
}

export async function loadConceptActionInputs(ports: ConceptActionInputPorts, product: ProductRow, now: Date): Promise<ConceptActionInputs> {
  const { workspace_id: workspaceId, id: productId } = product;
  const clusteringVersion = DEMAND_CLUSTERING_VERSION;
  const [markets, gaps, drift7, drift30, drift90, liveConcepts, positioning, monitoringStartedAt] = await Promise.all([
    ports.states.listLatestMarketStates(workspaceId, productId, clusteringVersion, CONCEPT_MARKET_STATE_POLICY_VERSION),
    ports.states.listLatestGapStates(workspaceId, productId, clusteringVersion, CONCEPT_GAP_STATE_POLICY_VERSION),
    ports.states.listLatestDriftStates(workspaceId, productId, clusteringVersion, CONCEPT_DRIFT_STATE_POLICY_VERSION, "7d"),
    ports.states.listLatestDriftStates(workspaceId, productId, clusteringVersion, CONCEPT_DRIFT_STATE_POLICY_VERSION, "30d"),
    ports.states.listLatestDriftStates(workspaceId, productId, clusteringVersion, CONCEPT_DRIFT_STATE_POLICY_VERSION, "90d"),
    ports.liveConcepts(workspaceId, productId, now),
    ports.positioning(product),
    ports.monitoringStartedAt(workspaceId, productId),
  ]);
  return {
    product, now, clusteringVersion,
    markets: byConcept(markets), gaps: byConcept(gaps),
    drifts: { "7d": byConcept(drift7), "30d": byConcept(drift30), "90d": byConcept(drift90) },
    live: new Map(liveConcepts.map((concept) => [concept.identity.anchorConceptKey, concept])),
    positioning, monitoringStartedAt,
  };
}

export function selectorInputsFor(inputs: ConceptActionInputs, anchorConceptKey: string): ConceptSelectorInputs {
  const driftStates = Object.fromEntries(CONCEPT_ACTION_DRIFT_WINDOWS.map((window) => [window, inputs.drifts[window].get(anchorConceptKey) ?? null])) as Record<ConceptActionDriftWindow, ConceptDriftStateRow | null>;
  return {
    product: inputs.product,
    marketState: inputs.markets.get(anchorConceptKey) ?? null,
    gapState: inputs.gaps.get(anchorConceptKey) ?? null,
    driftStates,
    liveConcept: inputs.live.get(anchorConceptKey) ?? null,
    positioning: inputs.positioning,
    monitoringStartedAt: inputs.monitoringStartedAt,
    activeClusteringVersion: inputs.clusteringVersion,
  };
}

export function identityFor(inputs: ConceptActionInputs, anchorConceptKey: string, clusteringVersion = inputs.clusteringVersion): ConceptIdentity {
  return { workspaceId: inputs.product.workspace_id, productId: inputs.product.id, clusteringVersion, anchorConceptKey };
}

/** The canonical selection for one concept identity, from the batched inputs. */
export function selectFromInputs(inputs: ConceptActionInputs, identity: ConceptIdentity): ConceptSelection {
  return selectCanonicalConceptCandidate(identity, selectorInputsFor(inputs, identity.anchorConceptKey), inputs.now);
}
