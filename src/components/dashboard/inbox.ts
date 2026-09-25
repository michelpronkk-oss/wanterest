import "server-only";

import { listSignalsQuery } from "@/server/modules/intelligence/commands";
import { getDemandDriftQuery, getDemandGapQuery } from "@/server/modules/demand-intelligence/commands";
import { listActionsQuery } from "@/server/modules/actions/commands";
import { listExperimentsQuery } from "@/server/modules/experiments/commands";
import { formatPercent, formatRelativeTime, themeLabel } from "./dashboard-utils";

export type InboxItemType = "signal" | "gap" | "drift" | "action" | "experiment";

export type InboxItem = {
  id: string;
  type: InboxItemType;
  label: string;
  headline: string;
  context: string;
  meta: string;
  cta: { label: string; href: string };
  timestamp: string | null;
  confidence: number;
};

/**
 * Assembles Intelligence Inbox items from data that already exists elsewhere in the product
 * (top signal, top gap, top rising drift, top proposed action, latest completed experiment).
 * There is no notifications table — this recomputes a snapshot on every read, and read/unread
 * state is tracked client-side only (see intelligence-inbox.tsx).
 */
export async function getInboxItems(workspaceId: string, productId: string): Promise<InboxItem[]> {
  const items: InboxItem[] = [];

  const results = await Promise.allSettled([
    listSignalsQuery(workspaceId, productId, { limit: 1, minimumScore: 0.75 }),
    getDemandGapQuery(workspaceId, productId),
    getDemandDriftQuery(workspaceId, productId),
    listActionsQuery(workspaceId, productId, { status: "proposed", limit: 1 }),
    listExperimentsQuery(workspaceId, productId),
  ]);

  const [signalsResult, gapResult, driftResult, actionsResult, experimentsResult] = results;

  if (signalsResult.status === "fulfilled" && signalsResult.value[0]) {
    const signal = signalsResult.value[0];
    items.push({
      id: `signal:${signal.signalId}`,
      type: "signal",
      label: "High confidence signal",
      headline: `"${signal.excerpt.slice(0, 100)}${signal.excerpt.length > 100 ? "…" : ""}"`,
      context: `${signal.intentType.replaceAll("_", " ")} · ${signal.matchPercent}% match`,
      meta: `${signal.source} · ${formatRelativeTime(signal.publishedAt ?? signal.createdAt)}`,
      cta: { label: "View signal", href: "/app/signals" },
      timestamp: signal.publishedAt ?? signal.createdAt,
      confidence: signal.qualification?.confidence ?? signal.matchPercent / 100,
    });
  }

  if (gapResult.status === "fulfilled" && gapResult.value.gaps.length) {
    const top = [...gapResult.value.gaps].sort((a, b) => b.gap_score - a.gap_score)[0];
    items.push({
      id: `gap:${top.id}`,
      type: "gap",
      label: "Demand gap",
      headline: `${themeLabel(top.concept_key)} is underrepresented in your positioning`,
      context: `${formatPercent(top.market_share)} market share · ${formatPercent(top.gap_score)} gap score`,
      meta: "From latest demand snapshot",
      cta: { label: "View gap", href: "/app/insights/gap" },
      timestamp: null,
      confidence: top.confidence,
    });
  }

  if (driftResult.status === "fulfilled" && driftResult.value.drifts.length) {
    const rising = driftResult.value.drifts
      .filter((row) => row.drift_direction === "rising")
      .sort((a, b) => b.share_delta - a.share_delta)[0];
    if (rising) {
      items.push({
        id: `drift:${rising.id}`,
        type: "drift",
        label: "Rising theme",
        headline: `${themeLabel(rising.concept_key)} demand is rising`,
        context: `${formatPercent(rising.share_delta)} share shift · ${rising.significance} significance`,
        meta: "From latest drift comparison",
        cta: { label: "View drift", href: "/app/insights/drift" },
        timestamp: null,
        confidence: rising.confidence,
      });
    }
  }

  if (actionsResult.status === "fulfilled" && actionsResult.value.length) {
    const top = [...actionsResult.value].sort((a, b) => b.action.priority_score - a.action.priority_score)[0];
    items.push({
      id: `action:${top.action.id}`,
      type: "action",
      label: "Action ready",
      headline: top.action.title,
      context: top.action.why.slice(0, 140),
      meta: `${top.action.action_type.replaceAll("_", " ")}`,
      cta: { label: "View action", href: "/app/actions" },
      timestamp: top.action.valid_from,
      confidence: top.action.confidence,
    });
  }

  if (experimentsResult.status === "fulfilled") {
    const completed = experimentsResult.value
      .filter((entry) => entry.experiment.status === "completed" && entry.latestResult)
      .sort((a, b) => (b.latestResult?.calculated_at ?? "").localeCompare(a.latestResult?.calculated_at ?? ""))[0];
    if (completed?.latestResult) {
      const result = completed.latestResult;
      // Layer 11: the stored outcome summary is the only headline; legacy rows stay descriptive.
      const headline = result.summary ?? `${completed.experiment.name} finished collecting results (descriptive only)`;
      items.push({
        id: `experiment:${completed.experiment.id}`,
        type: "experiment",
        label: "Experiment result",
        headline,
        context: result.outcome ? `${result.outcome} · ${result.attribution_class?.replaceAll("_", " ") ?? "descriptive"}` : `${result.result_state} · ${result.total_exposed_subjects} exposed`,
        meta: formatRelativeTime(result.calculated_at),
        cta: { label: "View result", href: "/app/experiments" },
        timestamp: result.calculated_at,
        confidence: result.outcome && result.outcome !== "inconclusive" && result.outcome !== "invalid" ? 1 : 0.6,
      });
    }
  }

  return items;
}
