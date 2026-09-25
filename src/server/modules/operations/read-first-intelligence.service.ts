import type { DemandDriftRow, DemandGapRow, DemandSnapshotRow } from "@/server/db/database.helpers";
import type { ProductDemandScanHandle } from "./product-demand-scan.schemas";
import { getReadFirstFreshnessConfig, READ_FIRST_INTELLIGENCE_VERSION, type ReadFirstFreshnessConfig } from "./read-first-intelligence.config";
import type { ReadFirstDemandSnapshot, ReadFirstDemandSummary, ReadFirstFreshnessState, ReadFirstPerformanceTiming, ReadFirstRefreshStatus } from "./read-first-intelligence.schemas";
import type { SignalReadModel } from "@/server/modules/intelligence";

export type ReadFirstProductKey = { workspaceId: string; productId: string };

export type ReadFirstActiveRefresh = {
  jobRunId: string;
  status: "pending" | "running";
};

export type ReadFirstPersistedState = {
  signals: SignalReadModel[];
  snapshot: DemandSnapshotRow | null;
  gaps: DemandGapRow[];
  drifts: DemandDriftRow[];
  activeRefresh: ReadFirstActiveRefresh | null;
  /** Latest completed full product scan. */
  lastSuccessfulRefreshAt: string | null;
  /** Stage 2E: latest completed continuous incremental match for this product. */
  lastIncrementalMatchAt?: string | null;
  /** Stage 2E: latest continuous public-evidence retrieval for this product's partitions. */
  lastEvidenceRetrievedAt?: string | null;
};

export interface ReadFirstIntelligenceRepository {
  loadPersistedState(key: ReadFirstProductKey): Promise<ReadFirstPersistedState>;
}

export type ReadFirstRefreshEnqueuer = (key: ReadFirstProductKey) => Promise<ProductDemandScanHandle>;

export type ReadFirstDependencies = {
  repository: ReadFirstIntelligenceRepository;
  enqueueRefresh?: ReadFirstRefreshEnqueuer;
  now?: () => Date;
  freshness?: ReadFirstFreshnessConfig;
  onTiming?: (timing: ReadFirstPerformanceTiming) => void;
};

export const READ_FIRST_FRESHNESS_POLICY_VERSION = "read_first_freshness_v2" as const;
export type ReadFirstInterpretationState = "fresh" | "recent" | "stale" | "never";

function ageState(timestamp: string | null, now: Date, config: ReadFirstFreshnessConfig): ReadFirstInterpretationState {
  if (!timestamp) return "never";
  const age = Math.max(0, now.getTime() - Date.parse(timestamp));
  if (age <= config.freshMs) return "fresh";
  if (age <= config.recentMs) return "recent";
  return "stale";
}

/**
 * Stage 2E: the product interpretation was last checked by whichever came
 * later - a full product scan or a continuous incremental match. Pure.
 */
export function interpretationCheck(state: Pick<ReadFirstPersistedState, "lastSuccessfulRefreshAt" | "lastIncrementalMatchAt">): { lastCheckedAt: string | null; lastCheckSource: "scan" | "incremental" | null } {
  const scan = state.lastSuccessfulRefreshAt ?? null;
  const incremental = state.lastIncrementalMatchAt ?? null;
  if (!scan && !incremental) return { lastCheckedAt: null, lastCheckSource: null };
  if (!incremental || (scan && Date.parse(scan) >= Date.parse(incremental))) return { lastCheckedAt: scan, lastCheckSource: "scan" };
  return { lastCheckedAt: incremental, lastCheckSource: "incremental" };
}

export type ReadFirstProductIntelligence = {
  version: typeof READ_FIRST_INTELLIGENCE_VERSION;
  productId: string;
  workspaceId: string;
  intelligence: {
    signals: SignalReadModel[];
    demandSummary: ReadFirstDemandSummary;
    demandSnapshot: ReadFirstDemandSnapshot | null;
    lastSuccessfulRefreshAt: string | null;
  };
  freshness: {
    /** v1 semantics, unchanged: age of the newest persisted intelligence evidence. */
    state: ReadFirstFreshnessState;
    freshestEvidenceAt: string | null;
    lastSuccessfulRefreshAt: string | null;
    /** Stage 2E: true only when the product's interpretation (not its evidence) is out of date. */
    refreshDue: boolean;
    policyVersion: typeof READ_FIRST_FRESHNESS_POLICY_VERSION;
    /** How recently public market evidence for this product was retrieved. */
    evidence: { lastRetrievedAt: string | null; newestPublishedAt: string | null };
    /** How recently Wanterest re-evaluated the market for this product (scan or incremental match). */
    interpretation: { state: ReadFirstInterpretationState; lastCheckedAt: string | null; lastCheckSource: "scan" | "incremental" | null };
    /** When persisted product intelligence objects last changed. */
    signalsUpdatedAt: string | null;
    demandViewUpdatedAt: string | null;
  };
  refresh: {
    status: ReadFirstRefreshStatus;
    jobRunId: string | null;
  };
  timings: ReadFirstPerformanceTiming;
};

function elapsed(start: number): number {
  return Math.max(0, Number((performance.now() - start).toFixed(2)));
}

function latestTimestamp(values: Array<string | null | undefined>): string | null {
  const valid = values
    .filter((value): value is string => Boolean(value) && Number.isFinite(Date.parse(value as string)))
    .sort((a, b) => Date.parse(b) - Date.parse(a));
  return valid[0] ?? null;
}

function demandSnapshotReadModel(snapshot: DemandSnapshotRow | null): ReadFirstDemandSnapshot | null {
  if (!snapshot) return null;
  return {
    id: snapshot.id,
    windowType: snapshot.window_type,
    periodStart: snapshot.period_start,
    periodEnd: snapshot.period_end,
    sampleSize: snapshot.sample_size,
    confidence: snapshot.confidence,
    measurementQuality: snapshot.measurement_quality,
  };
}

function demandSummary(snapshot: DemandSnapshotRow | null, gaps: DemandGapRow[], drifts: DemandDriftRow[]): ReadFirstDemandSummary {
  return {
    snapshotId: snapshot?.id ?? null,
    windowType: snapshot?.window_type ?? null,
    gapCount: gaps.length,
    driftCount: drifts.length,
    sampleSize: snapshot?.sample_size ?? 0,
    confidence: snapshot?.confidence ?? null,
    measurementQuality: snapshot?.measurement_quality ?? null,
  };
}

function hasPersistedIntelligence(state: ReadFirstPersistedState): boolean {
  return state.signals.length > 0 || Boolean(state.snapshot) || state.gaps.length > 0 || state.drifts.length > 0;
}

function currentSignals(signals: SignalReadModel[]): SignalReadModel[] {
  return signals.filter((signal) => signal.lifecycleStatus !== "invalidated" && signal.lifecycleStatus !== "retracted");
}

function freshnessState(
  state: ReadFirstPersistedState,
  freshestEvidenceAt: string | null,
  now: Date,
  config: ReadFirstFreshnessConfig,
): ReadFirstFreshnessState {
  if (!hasPersistedIntelligence(state)) return "empty";
  if (!freshestEvidenceAt) return "stale";
  const age = Math.max(0, now.getTime() - Date.parse(freshestEvidenceAt));
  if (age <= config.freshMs) return "fresh";
  if (age <= config.recentMs) return "recent";
  return "stale";
}

function activeRefreshStatus(activeRefresh: ReadFirstActiveRefresh | null): ReadFirstRefreshStatus | null {
  if (!activeRefresh) return null;
  return activeRefresh.status === "pending" ? "queued" : "running";
}

export class ReadFirstIntelligenceService {
  constructor(private readonly dependencies: ReadFirstDependencies) {}

  async read(key: ReadFirstProductKey): Promise<ReadFirstProductIntelligence> {
    const totalStart = performance.now();
    const readStart = performance.now();
    const persisted = await this.dependencies.repository.loadPersistedState(key);
    const currentPersisted = { ...persisted, signals: currentSignals(persisted.signals) };
    const intelligenceReadMs = elapsed(readStart);

    const freshnessStart = performance.now();
    const now = (this.dependencies.now ?? (() => new Date()))();
    const freshestEvidenceAt = latestTimestamp([
      ...currentPersisted.signals.map((signal) => signal.publishedAt ?? signal.createdAt),
      currentPersisted.snapshot?.period_end,
      ...currentPersisted.gaps.map((gap) => gap.created_at),
      ...currentPersisted.drifts.map((drift) => drift.created_at),
    ]);
    const freshnessConfig = this.dependencies.freshness ?? getReadFirstFreshnessConfig();
    const state = freshnessState(currentPersisted, freshestEvidenceAt, now, freshnessConfig);
    const interpretation = interpretationCheck(currentPersisted);
    const interpretationState = ageState(interpretation.lastCheckedAt, now, freshnessConfig);
    // Stage 2E: strictly narrower than v1 (state !== "fresh"). A refresh is
    // not due when the market was re-checked for this product inside the
    // fresh window, even if that check found no new qualifying demand - old
    // evidence alone must not trigger another paid provider scan.
    const refreshDue = state !== "fresh" && interpretationState !== "fresh";
    const evidenceLastRetrievedAt = latestTimestamp([currentPersisted.lastSuccessfulRefreshAt, currentPersisted.lastEvidenceRetrievedAt]);
    const newestPublishedAt = latestTimestamp(currentPersisted.signals.map((signal) => signal.publishedAt));
    const signalsUpdatedAt = latestTimestamp(currentPersisted.signals.map((signal) => signal.createdAt));
    const demandViewUpdatedAt = latestTimestamp([currentPersisted.snapshot?.created_at, ...currentPersisted.gaps.map((gap) => gap.created_at), ...currentPersisted.drifts.map((drift) => drift.created_at)]);
    const freshnessEvaluationMs = elapsed(freshnessStart);

    let refreshStatus = activeRefreshStatus(currentPersisted.activeRefresh) ?? (currentPersisted.lastSuccessfulRefreshAt ? "complete" : "idle");
    let jobRunId = currentPersisted.activeRefresh?.jobRunId ?? null;
    let refreshEnqueueMs = 0;
    if (refreshDue && !currentPersisted.activeRefresh && this.dependencies.enqueueRefresh) {
      const enqueueStart = performance.now();
      try {
        const handle = await this.dependencies.enqueueRefresh(key);
        refreshStatus = "queued";
        jobRunId = handle.jobRunId;
      } catch (error) {
        // Persisted intelligence remains the response authority even when a
        // refresh dispatch is temporarily unavailable. The caller can retry
        // from the refresh status without turning this read into a failure.
        console.warn("[read-first] refresh enqueue unavailable", error instanceof Error ? error.message : "unknown error");
      } finally {
        refreshEnqueueMs = elapsed(enqueueStart);
      }
    }

    const timings: ReadFirstPerformanceTiming = {
      intelligenceReadMs,
      freshnessEvaluationMs,
      refreshEnqueueMs,
      totalReadFirstRequestMs: elapsed(totalStart),
    };
    this.dependencies.onTiming?.(timings);

    return {
      version: READ_FIRST_INTELLIGENCE_VERSION,
      productId: key.productId,
      workspaceId: key.workspaceId,
      intelligence: {
        signals: currentPersisted.signals,
        demandSummary: demandSummary(currentPersisted.snapshot, currentPersisted.gaps, currentPersisted.drifts),
        demandSnapshot: demandSnapshotReadModel(currentPersisted.snapshot),
        lastSuccessfulRefreshAt: currentPersisted.lastSuccessfulRefreshAt,
      },
      freshness: {
        state,
        freshestEvidenceAt,
        lastSuccessfulRefreshAt: currentPersisted.lastSuccessfulRefreshAt,
        refreshDue,
        policyVersion: READ_FIRST_FRESHNESS_POLICY_VERSION,
        evidence: { lastRetrievedAt: evidenceLastRetrievedAt, newestPublishedAt },
        interpretation: { state: interpretationState, ...interpretation },
        signalsUpdatedAt,
        demandViewUpdatedAt,
      },
      refresh: { status: refreshStatus, jobRunId },
      timings,
    };
  }
}
