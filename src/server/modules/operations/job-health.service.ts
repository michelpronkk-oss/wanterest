import type { JobRunRow } from "@/server/db/database.helpers";

export type JobHealthReadModel = { recent: JobRunRow[]; failed: JobRunRow[]; stuck: JobRunRow[] };
export function getJobHealth(rows: JobRunRow[], now = new Date(), stuckAfterMs = 15 * 60 * 1000, limit = 100): JobHealthReadModel {
  const recent = [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, limit);
  const failed = recent.filter((row) => row.status === "failed" || row.status === "failed_terminal");
  const cutoff = now.getTime() - stuckAfterMs;
  const stuck = recent.filter((row) => row.status === "running" && new Date(row.started_at ?? row.created_at).getTime() < cutoff);
  return { recent, failed, stuck };
}
export function terminalFailurePatch(row: JobRunRow, errorCode: string, errorDetails: JobRunRow["error_details"]): Partial<JobRunRow> { return { status: "failed_terminal", error_code: errorCode, error_details: errorDetails, completed_at: new Date().toISOString() }; }
