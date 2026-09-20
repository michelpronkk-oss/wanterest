import type { JobRunRow, SourceHealthRow } from "@/server/db/database.helpers";
import { getJobHealth } from "./job-health.service";
import { initialSourceAvailability } from "./source-control.service";

export function getSystemHealth(input: { database: "ok" | "error"; now?: string }) { return { status: input.database === "ok" ? "ok" : "degraded", liveness: "ok", readiness: input.database === "ok" ? "ok" : "error", checkedAt: input.now ?? new Date().toISOString(), optionalProviders: initialSourceAvailability.map((source) => ({ sourceKey: source.sourceKey, configured: source.configured, state: source.state })) }; }
export function getSourceHealthReadModel(rows: SourceHealthRow[]) { return rows.map((row) => ({ sourceKey: row.source_key, environment: row.environment, degradationState: row.degradation_state, lastSuccessAt: row.last_success_at, lastFailureAt: row.last_failure_at, latestErrorCode: row.latest_error_code, latestErrorSummary: row.latest_error_summary })); }
export function getJobHealthReadModel(rows: JobRunRow[], now = new Date()) { return getJobHealth(rows, now); }
export function getRecentFailures(rows: JobRunRow[], limit = 50) { return rows.filter((row) => row.status === "failed" || row.status === "failed_terminal").sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, limit); }
export function getJobRunDetail(rows: JobRunRow[], jobRunId: string) { return rows.find((row) => row.id === jobRunId) ?? null; }
export function getExperimentDiagnostics(input: { status: string; assignments: number; exposures: number; outcomes: number; latestResultState?: string | null }) { return { ...input, dataQuality: input.exposures <= input.assignments && input.outcomes <= input.exposures ? "ok" : "invalid" }; }
export function getBillingReconciliationReadModel(input: { normalizedPlan: string; entitlementPlan: string; subscriptionStatus: string | null }) { return { ...input, consistent: input.normalizedPlan === input.entitlementPlan || input.subscriptionStatus === "past_due" }; }

export type ProvenanceEdge = { derivedEvidenceNodeId: string; sourceEvidenceNodeId: string; relationType: string; ordinal?: number; weight?: number; span?: unknown };
export function traceEvidencePath(startEvidenceNodeId: string, edges: ProvenanceEdge[], maxDepth = 32) {
  const byDerived = new Map<string, ProvenanceEdge[]>();
  for (const edge of edges) byDerived.set(edge.derivedEvidenceNodeId, [...(byDerived.get(edge.derivedEvidenceNodeId) ?? []), edge]);
  const path: ProvenanceEdge[] = [];
  let frontier = [startEvidenceNodeId];
  const seen = new Set(frontier);
  for (let depth = 0; depth < maxDepth && frontier.length; depth += 1) {
    const next: string[] = [];
    for (const node of frontier) for (const edge of byDerived.get(node) ?? []) { path.push(edge); if (!seen.has(edge.sourceEvidenceNodeId)) { seen.add(edge.sourceEvidenceNodeId); next.push(edge.sourceEvidenceNodeId); } }
    frontier = next;
  }
  return path;
}
export const getActionProvenance = traceEvidencePath;
export const getConversationProvenance = traceEvidencePath;
export const getSignalProvenance = traceEvidencePath;
