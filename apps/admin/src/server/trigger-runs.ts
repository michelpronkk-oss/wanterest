import "server-only";

export type TriggerRun = { id: string; taskIdentifier: string; status: string; createdAt: string; finishedAt: string | null; durationMs: number | null; version: string | null };
export type TriggerRunsSnapshot = { state: "available" | "unavailable"; checkedAt: string | null; runs: TriggerRun[] | null; routingRuns: TriggerRun[] | null; source: string };

export async function getTriggerRunsSnapshot(): Promise<TriggerRunsSnapshot> {
  const secret = process.env.TRIGGER_SECRET_KEY;
  const unavailable = { state: "unavailable" as const, checkedAt: null, runs: null, routingRuns: null, source: "Trigger.dev · production environment" };
  if (!secret || !/^tr_prod_/.test(secret)) return unavailable;
  try {
    const readRuns = async (limit: string, task?: string) => {
      const url = new URL("https://api.trigger.dev/api/v1/runs");
      url.searchParams.set("page[limit]", limit);
      url.searchParams.set("filter[createdAt][period]", "1d");
      if (task) url.searchParams.set("filter[taskIdentifier]", task);
      const response = await fetch(url, { headers: { Authorization: `Bearer ${secret}`, Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error("Trigger run read unavailable");
      const body: unknown = await response.json();
      if (!body || typeof body !== "object" || !("data" in body) || !Array.isArray((body as { data?: unknown }).data)) throw new Error("Trigger run response unavailable");
      return ((body as { data: Array<Record<string, unknown>> }).data).slice(0, Number(limit)).flatMap((row) => {
      if (typeof row.id !== "string" || typeof row.taskIdentifier !== "string" || typeof row.status !== "string" || typeof row.createdAt !== "string") return [];
      return [{ id: row.id, taskIdentifier: row.taskIdentifier, status: row.status, createdAt: row.createdAt, finishedAt: typeof row.finishedAt === "string" ? row.finishedAt : null, durationMs: typeof row.durationMs === "number" ? row.durationMs : null, version: typeof row.version === "string" ? row.version : null }];
      });
    };
    const [runs, routingRuns] = await Promise.all([readRuns("30"), readRuns("20", "match-refreshed-partition")]);
    return { state: "available", checkedAt: new Date().toISOString(), runs, routingRuns, source: "Trigger.dev · production · trailing 24 hours" };
  } catch {
    return unavailable;
  }
}
