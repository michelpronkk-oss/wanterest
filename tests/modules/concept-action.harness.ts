import type { ProductRow, ProductSnapshotRow } from "../../src/server/db/database.helpers";
import { AppError } from "../../src/server/lib/errors";
import { deterministicUuid } from "../../src/server/modules/ingestion/hash";
import { DEMAND_CLUSTERING_VERSION } from "../../src/server/modules/demand-intelligence/demand-clustering.policy";
import { conceptMarketStateInputFingerprint } from "../../src/server/modules/demand-intelligence/concept-market-state.policy";
import { InMemoryConceptMarketStateRepository, type ConceptDriftStateRow, type ConceptGapStateRow, type ConceptMarketStateRow } from "../../src/server/modules/demand-intelligence/concept-market-state.repository";
import type { DemandMapConcept } from "../../src/server/modules/demand-intelligence/demand-map.policy";
import { InMemoryActionRepository } from "../../src/server/modules/actions/action.repository";
import { DemandActionService } from "../../src/server/modules/actions/action.service";
import { ConceptActionService } from "../../src/server/modules/actions/concept-action.service";
import { ActionLifecycleService, type ActionAccess } from "../../src/server/modules/actions/action-lifecycle.service";

/**
 * Deterministic Layer 10 harness. Generic concepts only (pricing, api_access,
 * reporting); no product, source or customer names drive behaviour.
 */
export const WS = "c1111111-1111-4111-8111-111111111111";
export const WS2 = "c2222222-2222-4222-8222-222222222222";
export const PRODUCT = "c3333333-3333-4333-8333-333333333333";
export const PRODUCT2 = "c4444444-4444-4444-8444-444444444444";
export const USER = "c5555555-5555-4555-8555-555555555555";
export const VIEWER = "c6666666-6666-4666-8666-666666666666";
export const ENGINE = "c7777777-7777-4777-8777-777777777777";
export const NOW = new Date("2026-09-25T12:00:00.000Z");
export const WINDOWS = ["7d", "30d", "90d"] as const;

export function productRow(overrides: Partial<ProductRow> = {}): ProductRow {
  return { id: PRODUCT, workspace_id: WS, name: "Example Product", current_snapshot_id: "snap-1", ...overrides } as unknown as ProductRow;
}

export function snapshot(id: string, contentHash: string, productId = PRODUCT, workspaceId = WS, version = 1): ProductSnapshotRow {
  return { id, workspace_id: workspaceId, product_id: productId, evidence_node_id: deterministicUuid(`snapshot-node:${id}`), snapshot_version: version, content_hash: contentHash, created_at: "2026-09-01T00:00:00.000Z" } as unknown as ProductSnapshotRow;
}

/** A minimal live concept whose fingerprint the harness controls through `members`. */
export function liveConcept(anchor: string, members: string[], clusteringVersion: string = DEMAND_CLUSTERING_VERSION): DemandMapConcept {
  return {
    conceptKey: anchor, identity: { clusteringVersion, anchorConceptKey: anchor }, label: anchor, status: "current",
    activeEvidenceCount: members.length, activeSourceCount: 1, sourceMix: {}, intentFamilyMix: {}, targetScopeMix: {}, level: null,
    firstActiveEvidenceAt: null, lastActiveEvidenceAt: null, observedEvidenceCount: members.length, lastObservedAt: null, exclusions: {},
    updatePending: false, stateComputedAt: null, buyerLanguage: [],
    clusters: [{ clusterId: `cluster:${anchor}`, clusterKey: anchor, label: anchor, intentFamily: "switch", targetScope: "market", evidenceNodeId: `cluster-node:${anchor}`, activeEvidenceCount: members.length, persistedState: null,
      members: members.map((id) => ({ membershipId: id, clusterId: `cluster:${anchor}`, contributes: true, reason: null, pendingRecompute: false, conversationId: `conv:${id}`, evidenceAt: "2026-09-20T00:00:00.000Z", sourceKey: "github", evidenceNodeId: `member-node:${id}` })) }],
  } as unknown as DemandMapConcept;
}

let seq = 0;
function uid(label: string) { seq += 1; return deterministicUuid(`${label}:${seq}`); }

export class Harness {
  readonly states = new InMemoryConceptMarketStateRepository();
  readonly actions = new InMemoryActionRepository();
  readonly live = new Map<string, DemandMapConcept>();
  actionsEnabled = true;
  downstreamV2 = true;
  product: ProductRow;
  monitoringStartedAt: string | null = null;
  liveReads = 0;
  positioningReads = 0;

  constructor(product: ProductRow = productRow()) {
    this.product = product;
    this.actions.snapshots.set("snap-1", snapshot("snap-1", "a".repeat(64), product.id, product.workspace_id));
    this.actions.members.set(`${product.workspace_id}:${USER}`, "member");
    this.actions.members.set(`${product.workspace_id}:${VIEWER}`, "viewer");
    // Emulates assert_concept_action_basis_guard against the in-memory 9C tables.
    this.actions.basisGuardCheck = async (identity, guard) => {
      const market = await this.states.latestMarketState(identity.workspaceId, identity.productId, identity.clusteringVersion, identity.anchorConceptKey, guard.marketStatePolicyVersion);
      const gap = await this.states.latestGapState(identity.workspaceId, identity.productId, identity.clusteringVersion, identity.anchorConceptKey, guard.gapStatePolicyVersion);
      let changed = (market?.id ?? null) !== guard.marketStateId || (gap?.id ?? null) !== guard.gapStateId;
      for (const [window, id] of Object.entries(guard.driftStateIds)) {
        const drift = await this.states.latestDriftState(identity.workspaceId, identity.productId, identity.clusteringVersion, identity.anchorConceptKey, guard.driftStatePolicyVersion, window);
        if ((drift?.id ?? null) !== id) changed = true;
      }
      if (changed) throw new AppError("CONFLICT", "Action write conflict.", 409, { reason: "action_basis_changed" });
    };
  }

  service(): ConceptActionService {
    return new ConceptActionService(this.states, this.actions, {
      liveConcepts: async () => { this.liveReads += 1; return [...this.live.values()]; },
      positioning: async (product) => { this.positioningReads += 1; return this.actions.getPositioningSnapshot(product); },
      monitoringStartedAt: async () => this.monitoringStartedAt,
    });
  }

  actionService(): DemandActionService { return new DemandActionService(this.actions, { can: async () => true }); }

  lifecycle(): ActionLifecycleService {
    const service = this.service();
    return new ActionLifecycleService({
      actionService: this.actionService(),
      actionsEnabled: async () => this.actionsEnabled,
      loadProduct: async () => this.product,
      loadConceptInputs: (product, now) => service.loadInputs(product, now),
      downstreamIntelligenceV2Enabled: this.downstreamV2,
      now: () => NOW,
    });
  }

  access(actionId: string, userId = USER): ActionAccess {
    const action = this.actions.actions.get(actionId)!;
    const role = this.actions.members.get(`${action.workspace_id}:${userId}`) ?? "viewer";
    return { userId, action, role, canMutate: role !== "viewer" };
  }

  run(now = NOW) { return this.service().reconcileAndGenerate({ product: this.product, now, actionEngineVersionId: ENGINE }); }

  /** Sets the live roll-up for a concept and appends a market state matching it (fingerprint agreement). */
  async market(anchor: string, opts: { members?: string[]; evidence?: number; intentSwitch?: number; computedAt?: string; clusteringVersion?: string } = {}): Promise<ConceptMarketStateRow> {
    const clusteringVersion: string = opts.clusteringVersion ?? DEMAND_CLUSTERING_VERSION;
    const members = opts.members ?? Array.from({ length: opts.evidence ?? 24 }, (_, index) => `${anchor}-m${index}`);
    const concept = liveConcept(anchor, members, clusteringVersion);
    this.live.set(anchor, concept);
    const latest = await this.states.latestMarketState(this.product.workspace_id, this.product.id, clusteringVersion, anchor, "concept_market_state_v1");
    const id = uid(`market:${anchor}`);
    return this.states.createMarketState({
      id, workspace_id: this.product.workspace_id, product_id: this.product.id, evidence_node_id: deterministicUuid(`node:${id}`),
      clustering_version: clusteringVersion, anchor_concept_key: anchor, concept_market_state_policy_version: "concept_market_state_v1",
      market_state_engine_version_id: ENGINE, previous_state_id: latest?.id ?? null, sequence: (latest?.sequence ?? 0) + 1,
      input_fingerprint: conceptMarketStateInputFingerprint(concept), strength_level: "corroborated",
      distinct_evidence_count: opts.evidence ?? members.length, distinct_source_count: 2, contributing_membership_count: members.length, excluded_membership_count: 0,
      source_mix: {}, intent_family_mix: { switch: opts.intentSwitch ?? members.length }, target_scope_mix: {}, exclusions: {},
      first_evidence_at: null, last_evidence_at: null, computed_at: opts.computedAt ?? NOW.toISOString(),
    });
  }

  async gap(market: ConceptMarketStateRow, opts: { status?: string; score?: number | null; share?: number; positioning?: number; snapshotId?: string } = {}): Promise<ConceptGapStateRow> {
    const latest = await this.states.latestGapState(market.workspace_id, market.product_id, market.clustering_version, market.anchor_concept_key, "concept_gap_state_v1");
    const id = uid(`gap:${market.anchor_concept_key}`);
    return this.states.createGapState({
      id, workspace_id: market.workspace_id, product_id: market.product_id, evidence_node_id: deterministicUuid(`node:${id}`),
      clustering_version: market.clustering_version, anchor_concept_key: market.anchor_concept_key, gap_state_policy_version: "concept_gap_state_v1",
      gap_engine_version_id: ENGINE, market_state_id: market.id, product_snapshot_id: opts.snapshotId ?? "snap-1", previous_state_id: latest?.id ?? null,
      sequence: (latest?.sequence ?? 0) + 1, input_fingerprint: deterministicUuid(`gapfp:${id}`).replace(/-/g, "").padEnd(64, "0"),
      status: opts.status ?? "scored", share_of_current_demand: opts.share ?? 0.6, positioning_weight: opts.positioning ?? 0.1, high_intent_share: 1,
      sample_quality: "normal", gap_score: opts.score === undefined ? 0.6 : opts.score, computed_at: NOW.toISOString(),
    });
  }

  async drift(market: ConceptMarketStateRow, window: string, opts: { direction?: string | null; significance?: string | null; comparable?: boolean; current?: number; previous?: number; shareDelta?: number; fingerprint?: string } = {}): Promise<ConceptDriftStateRow> {
    const latest = await this.states.latestDriftState(market.workspace_id, market.product_id, market.clustering_version, market.anchor_concept_key, "concept_drift_state_v1", window);
    const id = uid(`drift:${market.anchor_concept_key}:${window}`);
    const comparable = opts.comparable ?? true;
    return this.states.createDriftState({
      id, workspace_id: market.workspace_id, product_id: market.product_id, evidence_node_id: deterministicUuid(`node:${id}`),
      clustering_version: market.clustering_version, anchor_concept_key: market.anchor_concept_key, drift_state_policy_version: "concept_drift_state_v1",
      comparability_version: "drift_comparability_v1", drift_engine_version_id: ENGINE, window_type: window, market_state_id: market.id,
      previous_state_id: latest?.id ?? null, sequence: (latest?.sequence ?? 0) + 1, input_fingerprint: opts.fingerprint ?? deterministicUuid(`driftfp:${id}`).replace(/-/g, "").padEnd(64, "0"),
      comparable, comparability_reason: comparable ? null : "insufficient_history", monitoring_started_at_basis: null,
      previous_period_start: null, previous_period_end: null, current_period_start: null, current_period_end: null,
      current_frozen_evidence_count: comparable ? opts.current ?? 12 : null, previous_frozen_evidence_count: comparable ? opts.previous ?? 6 : null,
      current_frozen_source_count: 2, previous_frozen_source_count: 1,
      direction: comparable ? (opts.direction === undefined ? "stable" : opts.direction) : null,
      significance: comparable ? (opts.significance === undefined ? "weak" : opts.significance) : null,
      share_delta: comparable ? opts.shareDelta ?? 0 : null, growth_rate: null, computed_at: NOW.toISOString(),
    });
  }

  /** A fully materialized concept: market + gap (+ neutral drift in every window unless overridden). */
  async concept(anchor: string, opts: { gap?: Parameters<Harness["gap"]>[1] | null; drift?: Partial<Record<(typeof WINDOWS)[number], Parameters<Harness["drift"]>[2]>>; market?: Parameters<Harness["market"]>[1] } = {}) {
    const market = await this.market(anchor, opts.market);
    const gap = opts.gap === null ? null : await this.gap(market, opts.gap ?? {});
    const drifts: Record<string, ConceptDriftStateRow> = {};
    for (const window of WINDOWS) drifts[window] = await this.drift(market, window, opts.drift?.[window] ?? {});
    return { market, gap, drifts };
  }

  openActions() { return [...this.actions.actions.values()].filter((row) => ["proposed", "approved", "in_progress"].includes(row.status)); }
}

export const RISING_STRONG = { direction: "rising", significance: "strong", current: 12, previous: 6, shareDelta: 0.4 } as const;
export const RISING_NOTABLE = { direction: "rising", significance: "notable", current: 12, previous: 6, shareDelta: 0.3 } as const;
