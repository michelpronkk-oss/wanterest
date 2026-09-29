import "server-only";

const projectId = process.env.VERCEL_PROJECT_ID ?? "prj_sNTTM87CHOT6h5gLNz5g9r8fducu";
const teamId = process.env.VERCEL_TEAM_ID ?? "team_tM3JXep1ZWAuR2rAcvuTtXAf";

export type WebAnalyticsSnapshot = {
  state: "available" | "unavailable";
  pageviews: number | null;
  visitors: number | null;
  source: string;
  range: string;
  refreshedAt: string | null;
  detail: string;
};

export async function getWebAnalyticsSnapshot(now = new Date()): Promise<WebAnalyticsSnapshot> {
  const token = process.env.VERCEL_API_TOKEN;
  const since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const until = now.toISOString();
  if (!token || !projectId || !teamId) return {
    state: "unavailable", pageviews: null, visitors: null, source: "Vercel Web Analytics · production project wanterest",
    range: "Trailing 30 days (UTC)", refreshedAt: null, detail: "Server-side Vercel API access is not configured. Visitor traffic is separate from Supabase lifecycle conversions.",
  };
  try {
    const url = new URL("https://api.vercel.com/v1/query/web-analytics/visits/count");
    url.searchParams.set("projectId", projectId);
    url.searchParams.set("teamId", teamId);
    url.searchParams.set("since", since);
    url.searchParams.set("until", until);
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error("analytics request unavailable");
    const payload: unknown = await response.json();
    if (!payload || typeof payload !== "object" || !("data" in payload)) throw new Error("analytics response unavailable");
    const data = (payload as { data?: unknown }).data;
    if (!data || typeof data !== "object") throw new Error("analytics response unavailable");
    const result = data as { pageviews?: unknown; visitors?: unknown };
    if (typeof result.pageviews !== "number" || typeof result.visitors !== "number") throw new Error("analytics response unavailable");
    return { state: "available", pageviews: result.pageviews, visitors: result.visitors, source: "Vercel Web Analytics · production project wanterest", range: "Trailing 30 days (UTC)", refreshedAt: now.toISOString(), detail: "Visitor traffic only. Lifecycle conversion counts are measured independently from Supabase records." };
  } catch {
    return { state: "unavailable", pageviews: null, visitors: null, source: "Vercel Web Analytics · production project wanterest", range: "Trailing 30 days (UTC)", refreshedAt: null, detail: "The Vercel Web Analytics count could not be verified. No visitor or conversion values are inferred." };
  }
}
