import type { DemandDriftRow, DemandSnapshotRow } from "../../db/database.helpers";

/**
 * Drift comparability v1 (Wanterest 1B Demand Drift foundation).
 *
 * Drift is only a trend when it compares a window with the immediately
 * preceding, non-overlapping window of equal length, and only when Wanterest
 * was already observing the product's market for the whole previous window.
 * Otherwise a young evidence index makes everything look "rising" simply
 * because coverage grew, and two scans a few hours apart compare ~identical
 * windows. Pure and deterministic.
 */
export const DRIFT_COMPARABILITY_VERSION = "drift_comparability_v1" as const;

const WINDOW_MS: Record<string, number> = { "7d": 7 * 86_400_000, "30d": 30 * 86_400_000, "90d": 90 * 86_400_000 };
const TOLERANCE_MS = 60_000;

export type DriftSkipReason = "insufficient_history" | "unknown_window";

export function windowMs(window: string): number | null {
  return WINDOW_MS[window] ?? null;
}

/** UTC-midnight anchor so drift snapshots are day-aligned, replayable and deduplicated per day. */
export function driftAnchor(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

/**
 * Plans the (current, previous) period ends for one window, or explains why
 * no honest comparison exists yet. `monitoringStartedAt` is when Wanterest
 * first persisted demand intelligence for the product.
 */
export function planDriftComparison(input: { window: string; now: Date; monitoringStartedAt: string | null }):
  | { comparable: true; currentPeriodEnd: string; previousPeriodEnd: string; previousPeriodStart: string }
  | { comparable: false; reason: DriftSkipReason } {
  const length = windowMs(input.window);
  if (!length) return { comparable: false, reason: "unknown_window" };
  const currentPeriodEnd = driftAnchor(input.now);
  const previousPeriodEnd = new Date(Date.parse(currentPeriodEnd) - length).toISOString();
  const previousPeriodStart = new Date(Date.parse(currentPeriodEnd) - 2 * length).toISOString();
  if (!input.monitoringStartedAt || Date.parse(input.monitoringStartedAt) > Date.parse(previousPeriodStart)) {
    return { comparable: false, reason: "insufficient_history" };
  }
  return { comparable: true, currentPeriodEnd, previousPeriodEnd, previousPeriodStart };
}

/** Adjacent, equal-length, same-window, same-product snapshots. */
export function isComparableSnapshotPair(current: DemandSnapshotRow, previous: DemandSnapshotRow): boolean {
  if (current.workspace_id !== previous.workspace_id || current.product_id !== previous.product_id || current.window_type !== previous.window_type) return false;
  const currentLength = Date.parse(current.period_end) - Date.parse(current.period_start);
  const previousLength = Date.parse(previous.period_end) - Date.parse(previous.period_start);
  if (Math.abs(currentLength - previousLength) > TOLERANCE_MS) return false;
  return Math.abs(Date.parse(previous.period_end) - Date.parse(current.period_start)) <= TOLERANCE_MS;
}

/**
 * Selects the newest drift comparison whose snapshots are comparable. Legacy
 * drift rows computed between overlapping snapshots stay in history but are
 * never surfaced as a trend.
 */
export function selectComparableDrifts(snapshots: DemandSnapshotRow[], drifts: DemandDriftRow[], window?: string):
  | { current: DemandSnapshotRow; previous: DemandSnapshotRow; drifts: DemandDriftRow[] }
  | null {
  const byId = new Map(snapshots.map((snapshot) => [snapshot.id, snapshot]));
  const pairs = new Map<string, { current: DemandSnapshotRow; previous: DemandSnapshotRow; drifts: DemandDriftRow[] }>();
  for (const drift of drifts) {
    const current = byId.get(drift.current_snapshot_id);
    const previous = byId.get(drift.previous_snapshot_id);
    if (!current || !previous || (window && current.window_type !== window)) continue;
    if (!isComparableSnapshotPair(current, previous)) continue;
    const key = `${current.id}:${previous.id}`;
    const pair = pairs.get(key) ?? { current, previous, drifts: [] };
    pair.drifts.push(drift);
    pairs.set(key, pair);
  }
  const ordered = [...pairs.values()].sort((a, b) => b.current.period_end.localeCompare(a.current.period_end) || b.current.created_at.localeCompare(a.current.created_at));
  return ordered[0] ?? null;
}

export function isComparableDriftRow(drift: DemandDriftRow, snapshotsById: Map<string, DemandSnapshotRow>): boolean {
  const current = snapshotsById.get(drift.current_snapshot_id);
  const previous = snapshotsById.get(drift.previous_snapshot_id);
  return Boolean(current && previous && isComparableSnapshotPair(current, previous));
}
