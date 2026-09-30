import "server-only";

import { createAdminServiceClient } from "./supabase";

export type GrowthPeriod = { startDate: string; endDate: string; label: string; days: number };
export type GrowthCount = { value: number | null; state: "available" | "unavailable"; source: string };
export type GrowthRow = { label: string; visitors: number; pageviews: number };
export type LifecycleDay = {
  date: string; submitted: number; verified: number; priority: number; approved: number; sent: number; accepted: number; admitted: number;
};

export type GrowthSnapshot = {
  refreshedAt: string | null;
  trafficState: "available" | "partial" | "unavailable";
  coverage: string;
  visitors: GrowthCount;
  pageviews: GrowthCount;
  homepagePageviews: GrowthCount;
  applicationStarted: GrowthCount;
  earlyAccessVisitors: GrowthCount;
  sessions: GrowthCount;
  dailyTraffic: Array<{ date: string; visitors: number; pageviews: number }> | null;
  topPages: GrowthRow[] | null;
  referrers: Array<{ label: string; visitors: number; pageviews: number; category: string }> | null;
  utmSource: GrowthRow[] | null;
  utmMedium: GrowthRow[] | null;
  utmCampaign: GrowthRow[] | null;
  utmState: "available" | "unavailable";
  landingPages: null;
  lifecycleDays: LifecycleDay[] | null;
  lifecycleState: "available" | "unavailable";
  lifecycleSource: string;
};

type ApiResult = { data?: unknown };
type AnalyticsRow = Record<string, unknown>;

const projectId = process.env.VERCEL_PROJECT_ID ?? "prj_sNTTM87CHOT6h5gLNz5g9r8fducu";
const teamId = process.env.VERCEL_TEAM_ID ?? "team_tM3JXep1ZWAuR2rAcvuTtXAf";
const source = "Vercel Web Analytics · production project wanterest";

export function parseGrowthPeriod(input: { period?: string; from?: string; to?: string }, now = new Date()): GrowthPeriod {
  const today = now.toISOString().slice(0, 10);
  if (input.period === "today") return { startDate: today, endDate: today, label: "Today · UTC", days: 1 };
  if (input.period === "7d") return rangeDays(now, 7, "Last 7 days · UTC");
  if (input.period === "30d" || !input.period) return rangeDays(now, 30, "Last 30 days · UTC");
  const from = parseDate(input.from);
  const to = parseDate(input.to);
  if (input.period === "custom" && from && to && from <= to && to <= today) {
    const days = Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
    if (days <= 367) return { startDate: from, endDate: to, label: `Custom · ${from} to ${to} UTC`, days };
  }
  return rangeDays(now, 30, "Last 30 days · UTC");
}

function rangeDays(now: Date, count: number, label: string): GrowthPeriod {
  const end = Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
  const startDate = new Date(end - (count - 1) * 86_400_000).toISOString().slice(0, 10);
  return { startDate, endDate: new Date(end).toISOString().slice(0, 10), label, days: count };
}

function parseDate(value?: string): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null;
}

function countValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.trunc(value) : null;
}

function rowsFrom(value: unknown): AnalyticsRow[] | null {
  if (!value || typeof value !== "object" || !Array.isArray((value as ApiResult).data)) return null;
  return (value as { data: unknown[] }).data.filter((row): row is AnalyticsRow => typeof row === "object" && row !== null);
}

function numberOrZero(value: unknown) { return countValue(value) ?? 0; }

async function analyticsRequest(path: "visits/count" | "visits/aggregate" | "events/count", options: { since: string; until: string; by?: string; filter?: string; limit?: number }): Promise<unknown> {
  const token = process.env.VERCEL_API_TOKEN;
  if (!token || !projectId || !teamId) throw new Error("unavailable");
  const url = new URL(`https://api.vercel.com/v1/query/web-analytics/${path}`);
  url.searchParams.set("projectId", projectId);
  url.searchParams.set("teamId", teamId);
  url.searchParams.set("since", options.since);
  url.searchParams.set("until", options.until);
  if (options.by) url.searchParams.set("by", options.by);
  if (options.filter) url.searchParams.set("filter", options.filter);
  if (options.limit) url.searchParams.set("limit", String(options.limit));
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    cache: "no-store", signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error("unavailable");
  return response.json();
}

function countData(value: unknown): { visitors: number; pageviews: number } | null {
  if (!value || typeof value !== "object" || !("data" in value)) return null;
  const data = (value as ApiResult).data;
  if (!data || typeof data !== "object") return null;
  const row = data as Record<string, unknown>;
  const visitors = countValue(row.visitors);
  const pageviews = countValue(row.pageviews);
  return visitors === null || pageviews === null ? null : { visitors, pageviews };
}

function eventCount(value: unknown): number | null {
  if (!value || typeof value !== "object" || !("data" in value)) return null;
  return countValue((value as { data?: Record<string, unknown> }).data?.count);
}

function dimensionRows(rows: AnalyticsRow[] | null, dimension: string): GrowthRow[] | null {
  if (!rows) return null;
  return rows.flatMap((row) => {
    const label = row[dimension];
    const visitors = countValue(row.visitors);
    const pageviews = countValue(row.pageviews);
    return typeof label === "string" && visitors !== null && pageviews !== null
      ? [{ label: label.slice(0, 180), visitors, pageviews }] : [];
  });
}

function classifyReferrer(label: string): string {
  const host = label.toLowerCase().replace(/^www\./, "");
  if (!host || host === "(direct)" || host === "direct") return "Direct";
  if (host === "other" || host === "unknown" || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host)) return "Other / unknown";
  if (/google\.|bing\.|yahoo\.|duckduckgo\.|baidu\.|yandex\./.test(host)) return "Organic search";
  if (/facebook\.|instagram\.|linkedin\.|tiktok\.|twitter\.|x\.com$|youtube\.|reddit\.|pinterest\./.test(host)) return "Social";
  return "Referral";
}

export async function getGrowthSnapshot(period: GrowthPeriod, now = new Date()): Promise<GrowthSnapshot> {
  const trackingStartAt = process.env.VERCEL_WEB_ANALYTICS_START_AT;
  const startAtMs = trackingStartAt ? Date.parse(trackingStartAt) : Number.NaN;
  const startDateConfigured = Number.isFinite(startAtMs);
  const trackingStartDate = startDateConfigured ? new Date(startAtMs).toISOString().slice(0, 10) : null;
  const queriedStart = trackingStartDate && trackingStartDate > period.startDate ? trackingStartDate : period.startDate;
  const partial = !trackingStartDate || trackingStartDate > period.startDate;
  const unavailable = (label: string): GrowthCount => ({ value: null, state: "unavailable", source: label });
  const trafficUnavailable = (): GrowthSnapshot => ({
    refreshedAt: null, trafficState: "unavailable", coverage: "Visitor instrumentation start time is not configured or analytics access is unavailable.",
    visitors: unavailable(source), pageviews: unavailable(source), homepagePageviews: unavailable("Vercel Web Analytics · requestPath /"),
    applicationStarted: unavailable("Vercel Web Analytics · application_started custom event"),
    earlyAccessVisitors: unavailable(source),
    sessions: unavailable("Not exposed by the selected Web Analytics API response"), dailyTraffic: null, topPages: null,
    referrers: null, utmSource: null, utmMedium: null, utmCampaign: null, utmState: "unavailable", landingPages: null,
    lifecycleDays: null, lifecycleState: "unavailable", lifecycleSource: "Supabase · authoritative lifecycle tables",
  });

  if (!trackingStartDate || trackingStartDate > period.endDate || !process.env.VERCEL_API_TOKEN) {
    const snapshot = trafficUnavailable();
    const lifecycle = await getLifecycleDays(period);
    return { ...snapshot, lifecycleDays: lifecycle.rows, lifecycleState: lifecycle.state, lifecycleSource: lifecycle.source,
      coverage: !trackingStartDate ? "No VERCEL_WEB_ANALYTICS_START_AT is configured; pre-instrumentation visitor history is unavailable." : trackingStartDate > period.endDate ? `Analytics begins ${trackingStartDate}; this period predates instrumentation.` : snapshot.coverage };
  }

  const dates = { since: queriedStart, until: period.endDate };
  const [allCounts, homeCounts, earlyCounts, startedEvents, daily, pages, referrers, utmSource, utmMedium, utmCampaign, lifecycle] = await Promise.all([
    analyticsRequest("visits/count", dates).then(countData).catch(() => null),
    analyticsRequest("visits/count", { ...dates, filter: "requestPath eq '/'" }).then(countData).catch(() => null),
    analyticsRequest("visits/count", { ...dates, filter: "requestPath eq '/waitlist'" }).then(countData).catch(() => null),
    analyticsRequest("events/count", { ...dates, filter: "eventName eq 'application_started'" }).then(eventCount).catch(() => null),
    analyticsRequest("visits/aggregate", { ...dates, by: "day", limit: 400 }).then((result) => rowsFrom(result)).catch(() => null),
    analyticsRequest("visits/aggregate", { ...dates, by: "requestPath", limit: 8 }).then((result) => rowsFrom(result)).catch(() => null),
    analyticsRequest("visits/aggregate", { ...dates, by: "referrerHostname", limit: 10 }).then((result) => rowsFrom(result)).catch(() => null),
    analyticsRequest("visits/aggregate", { ...dates, by: "utmSource", limit: 10 }).then((result) => rowsFrom(result)).catch(() => null),
    analyticsRequest("visits/aggregate", { ...dates, by: "utmMedium", limit: 10 }).then((result) => rowsFrom(result)).catch(() => null),
    analyticsRequest("visits/aggregate", { ...dates, by: "utmCampaign", limit: 10 }).then((result) => rowsFrom(result)).catch(() => null),
    getLifecycleDays(period),
  ]);

  const trafficReady = allCounts !== null;
  const dailyTraffic = daily?.flatMap((row) => {
    const date = typeof row.timestamp === "string" ? row.timestamp.slice(0, 10) : typeof row.day === "string" ? row.day.slice(0, 10) : null;
    return date ? [{ date, visitors: numberOrZero(row.visitors), pageviews: numberOrZero(row.pageviews) }] : [];
  }) ?? null;
  const pageRows = dimensionRows(pages, "requestPath");
  const sourceRows = referrers?.map((row) => {
    const host = typeof row.referrerHostname === "string" ? row.referrerHostname : "";
    return { label: host || "Direct / no referrer", visitors: numberOrZero(row.visitors), pageviews: numberOrZero(row.pageviews), category: classifyReferrer(host) };
  }) ?? null;
  const utmSupported = utmSource !== null && utmMedium !== null && utmCampaign !== null;
  return {
    refreshedAt: trafficReady ? now.toISOString() : null,
    trafficState: !trafficReady ? "unavailable" : partial ? "partial" : "available",
    coverage: partial ? trackingStartDate ? `Partial coverage from ${queriedStart} UTC; visitor history before instrumentation is unavailable.` : "Partial coverage; instrumentation start time is unknown." : `Complete coverage from ${queriedStart} UTC.`,
    visitors: { value: allCounts?.visitors ?? null, state: allCounts ? "available" : "unavailable", source },
    pageviews: { value: allCounts?.pageviews ?? null, state: allCounts ? "available" : "unavailable", source },
    homepagePageviews: { value: homeCounts?.pageviews ?? null, state: homeCounts ? "available" : "unavailable", source: "Vercel Web Analytics · requestPath /" },
    applicationStarted: { value: startedEvents, state: startedEvents === null ? "unavailable" : "available", source: "Vercel Web Analytics · application_started custom event" },
    earlyAccessVisitors: { value: earlyCounts?.visitors ?? null, state: earlyCounts ? "available" : "unavailable", source: "Vercel Web Analytics · requestPath /waitlist" },
    sessions: unavailable("The selected API returns visitors and pageviews, not a session count"),
    dailyTraffic, topPages: pageRows,
    referrers: sourceRows,
    utmSource: dimensionRows(utmSource, "utmSource"), utmMedium: dimensionRows(utmMedium, "utmMedium"), utmCampaign: dimensionRows(utmCampaign, "utmCampaign"),
    utmState: utmSupported ? "available" : "unavailable",
    landingPages: null,
    lifecycleDays: lifecycle.rows, lifecycleState: lifecycle.state, lifecycleSource: lifecycle.source,
  };
}

export async function getOverviewGrowth(now = new Date()): Promise<{
  state: "available" | "partial" | "unavailable"; visitors: number | null; pageviews: number | null;
  trend: Array<{ date: string; visitors: number | null; applications: number | null }> | null;
  refreshedAt: string | null; coverage: string;
}> {
  const period = parseGrowthPeriod({ period: "7d" }, now);
  const trackingStart = process.env.VERCEL_WEB_ANALYTICS_START_AT;
  const trackingDate = trackingStart && Number.isFinite(Date.parse(trackingStart)) ? new Date(trackingStart).toISOString().slice(0, 10) : null;
  const partial = !trackingDate || trackingDate > period.startDate;
  const queriedStart = trackingDate && trackingDate > period.startDate ? trackingDate : period.startDate;
  const [traffic, daily, lifecycle] = await Promise.all([
    trackingDate && trackingDate <= period.endDate
      ? analyticsRequest("visits/count", { since: queriedStart, until: period.endDate }).then(countData).catch(() => null)
      : Promise.resolve(null),
    trackingDate && trackingDate <= period.endDate
      ? analyticsRequest("visits/aggregate", { since: queriedStart, until: period.endDate, by: "day", limit: 10 }).then(rowsFrom).catch(() => null)
      : Promise.resolve(null),
    getLifecycleDays(period),
  ]);
  const lifeDays = fillLifecycleDays(period, lifecycle.rows);
  const trafficByDate = new Map((daily ?? []).flatMap((row) => {
    const date = typeof row.timestamp === "string" ? row.timestamp.slice(0, 10) : typeof row.day === "string" ? row.day.slice(0, 10) : null;
    return date ? [[date, numberOrZero(row.visitors)] as const] : [];
  }));
  const ready = traffic !== null;
  return {
    state: !ready ? "unavailable" : partial ? "partial" : "available",
    visitors: traffic?.visitors ?? null, pageviews: traffic?.pageviews ?? null,
    trend: daily === null || lifecycle.state === "unavailable" ? null : (lifeDays ?? []).map((row) => ({
      date: row.date, visitors: trafficByDate.get(row.date) ?? 0, applications: row.submitted,
    })),
    refreshedAt: ready ? now.toISOString() : null,
    coverage: !trackingDate ? "Visitor instrumentation start time is not configured." : partial ? `Partial visitor coverage from ${queriedStart} UTC.` : `Complete visitor coverage from ${queriedStart} UTC.`,
  };
}

async function getLifecycleDays(period: GrowthPeriod): Promise<{ rows: LifecycleDay[] | null; state: "available" | "unavailable"; source: string }> {
  const client = createAdminServiceClient();
  const sourceLabel = "Supabase · waitlist application/admission events + workspace admissions";
  if (!client) return { rows: null, state: "unavailable", source: sourceLabel };
  const { data, error } = await client.rpc("admin_growth_daily_metrics", { p_start_date: period.startDate, p_end_date: period.endDate });
  if (error || !Array.isArray(data)) return { rows: null, state: "unavailable", source: sourceLabel };
  return {
    rows: data.map((row: Record<string, unknown>) => ({
      date: String(row.metric_date).slice(0, 10), submitted: numberOrZero(row.applications_submitted), verified: numberOrZero(row.applications_verified),
      priority: numberOrZero(row.priority_earned), approved: numberOrZero(row.invitations_approved), sent: numberOrZero(row.invitations_sent),
      accepted: numberOrZero(row.invitations_accepted), admitted: numberOrZero(row.workspaces_admitted),
    })), state: "available", source: sourceLabel,
  };
}

export function fillLifecycleDays(period: GrowthPeriod, rows: LifecycleDay[] | null): LifecycleDay[] | null {
  if (!rows) return null;
  const byDate = new Map(rows.map((row) => [row.date, row]));
  return Array.from({ length: period.days }, (_, index) => {
    const date = new Date(Date.parse(`${period.startDate}T00:00:00Z`) + index * 86_400_000).toISOString().slice(0, 10);
    return byDate.get(date) ?? { date, submitted: 0, verified: 0, priority: 0, approved: 0, sent: 0, accepted: 0, admitted: 0 };
  });
}
