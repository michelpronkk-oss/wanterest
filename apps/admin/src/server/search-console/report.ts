import "server-only";

import { classifySearchQuery, getBrandBreakdown } from "./brand";
import type { SearchConsoleReadySnapshot, SearchConsoleRow } from "./model";

export type SearchConsoleOpportunityType =
  | "high_impressions_weak_ctr"
  | "near_page_one"
  | "rising_query"
  | "declining_page";

export type SearchConsoleOpportunity = {
  id: string;
  type: SearchConsoleOpportunityType;
  entity: string;
  entityKind: "query" | "page";
  current: SearchConsoleRow;
  previous: SearchConsoleRow | null;
  reason: string;
  suggestedReview: string;
  confidence: "sufficient_sample";
};

export type SearchConsoleOpportunityReport = {
  generatedAt: string;
  period: SearchConsoleReadySnapshot["period"];
  comparison: SearchConsoleReadySnapshot["comparison"];
  opportunities: SearchConsoleOpportunity[];
};

const MAX_OPPORTUNITIES = 8;

function previousByKey(rows: SearchConsoleRow[]): Map<string, SearchConsoleRow> {
  return new Map(rows.map((row) => [row.key, row]));
}

function stableId(type: SearchConsoleOpportunityType, kind: "query" | "page", entity: string): string {
  return [type, kind, entity.trim().toLocaleLowerCase("en-US")].join(":");
}

export function buildSearchConsoleOpportunityReport(snapshot: SearchConsoleReadySnapshot): SearchConsoleOpportunityReport {
  const previousQueries = previousByKey(snapshot.previousQueries);
  const previousPages = previousByKey(snapshot.previousPages);
  const opportunities = new Map<string, SearchConsoleOpportunity>();

  function add(opportunity: Omit<SearchConsoleOpportunity, "id" | "confidence">) {
    const id = stableId(opportunity.type, opportunity.entityKind, opportunity.entity);
    if (!opportunities.has(id)) opportunities.set(id, { ...opportunity, id, confidence: "sufficient_sample" });
  }

  for (const current of snapshot.queries) {
    const previous = previousQueries.get(current.key) ?? null;
    const branded = classifySearchQuery(current.key) === "branded";
    if (current.impressions >= 200 && current.ctr <= 0.015) {
      add({
        type: "high_impressions_weak_ctr",
        entity: current.key,
        entityKind: "query",
        current,
        previous,
        reason: "At least 200 returned impressions and a click-through rate at or below 1.5%.",
        suggestedReview: "Review whether the existing canonical page title and description match this query.",
      });
    }
    if (!branded && current.impressions >= 100 && current.position > 10 && current.position <= 20) {
      add({
        type: "near_page_one",
        entity: current.key,
        entityKind: "query",
        current,
        previous,
        reason: "A non-branded query has at least 100 returned impressions and an average position between 10 and 20.",
        suggestedReview: "Review the existing page that serves this query before considering content changes.",
      });
    }
    if (!branded && previous && current.impressions >= 100 && previous.impressions >= 50) {
      const increase = current.impressions - previous.impressions;
      const rate = increase / previous.impressions;
      if (increase >= 25 && rate >= 0.3) {
        add({
          type: "rising_query",
          entity: current.key,
          entityKind: "query",
          current,
          previous,
          reason: "Returned impressions increased by at least 25 and 30% versus the comparable period.",
          suggestedReview: "Review the existing canonical page and preserve the query as an observed demand signal.",
        });
      }
    }
  }

  for (const current of snapshot.pages) {
    if (current.impressions >= 200 && current.ctr <= 0.015) {
      add({
        type: "high_impressions_weak_ctr",
        entity: current.key,
        entityKind: "page",
        current,
        previous: previousPages.get(current.key) ?? null,
        reason: "A canonical page has at least 200 returned impressions and a click-through rate at or below 1.5%.",
        suggestedReview: "Review the existing canonical page title and description against its returned queries.",
      });
    }
  }
  for (const current of snapshot.pages) {
    const previous = previousPages.get(current.key) ?? null;
    if (previous && previous.impressions >= 100) {
      const decline = previous.impressions - current.impressions;
      if (decline >= 30 && decline / previous.impressions >= 0.3) {
        add({
          type: "declining_page",
          entity: current.key,
          entityKind: "page",
          current,
          previous,
          reason: "Returned page impressions fell by at least 30 and 30% versus the comparable period.",
          suggestedReview: "Review this canonical page and the matching query rows for a technical or relevance change.",
        });
      }
    }
  }

  const ranked = [...opportunities.values()].sort((left, right) => {
    const evidenceDifference = right.current.impressions - left.current.impressions;
    if (evidenceDifference !== 0) return evidenceDifference;
    return left.id.localeCompare(right.id);
  });

  return {
    generatedAt: snapshot.checkedAt ?? new Date().toISOString(),
    period: snapshot.period,
    comparison: snapshot.comparison,
    opportunities: ranked.slice(0, MAX_OPPORTUNITIES),
  };
}

export { getBrandBreakdown };
