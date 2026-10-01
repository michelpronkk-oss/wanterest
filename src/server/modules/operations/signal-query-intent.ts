import type { QueryIntentFamily, QueryPlanQuery } from "./query-planning.schemas";
import type { QueryPlanningInput } from "./query-planning.schemas";

const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Classifies only existing plan candidates, using their structured profile evidence. */
export function queryIntentFamilyForCandidate(input: QueryPlanningInput, query: QueryPlanQuery): QueryIntentFamily {
  const profile = input.demandProfile;
  const keys = new Set(query.concept_keys);
  const pains = (profile?.pains ?? []).filter((item) => keys.has(item.key));
  const features = (profile?.feature_demands ?? []).filter((item) => keys.has(item.key));
  const jobs = (profile?.jobs_to_be_done ?? []).filter((item) => keys.has(item.key));
  const objections = (profile?.objections ?? []).filter((item) => keys.has(item.key));
  const outcomes = (profile?.desired_outcomes ?? []).filter((item) => keys.has(item.key));
  const alternatives = (profile?.alternative_solutions ?? []).filter((item) => keys.has(item.key));
  const switching = (profile?.switching_triggers ?? []).filter((item) => keys.has(item.key));
  const competitors = [
    ...(profile?.known_competitors ?? []).filter((item) => keys.has(item.key)).map((item) => item.reason),
    ...(profile?.detected_competitor_candidates ?? []).filter((item) => keys.has(item.key)).map((item) => item.reason),
  ];
  const evidenceText = normalize([
    ...pains.flatMap((item) => [item.label, item.description]),
    ...features.map((item) => item.feature),
    ...jobs.flatMap((item) => [item.job, item.desired_result, item.context ?? ""]),
    ...objections.flatMap((item) => [item.objection, item.description]),
    ...outcomes.flatMap((item) => [item.label, item.description]),
    ...alternatives.flatMap((item) => [item.label, item.reason, item.alternative_type]),
    ...switching.flatMap((item) => [item.trigger, item.description]),
    ...competitors,
  ].join(" "));

  if (/\b(cancel|cancellation|cancelling|abandon|abandonment|churn|unsubscribe|renewal)\b/.test(evidenceText)) return "cancellation_abandonment";
  if ((features.length || pains.length || objections.length) && /\b(integration|integrate|connect|sync|api)\b/.test(evidenceText)) return "missing_integration";
  if (/\b(pricing|price|cost|expensive|afford|budget|willingness to pay|roi)\b/.test(evidenceText)) return "pricing_wtp_friction";
  if (alternatives.some((item) => ["manual_process", "status_quo"].includes(item.alternative_type)) || /\b(workaround|manual workflow|spreadsheet|manual process)\b/.test(evidenceText)) return "workaround_manual_workflow";
  if (query.competitor_refs.length && /\b(frustrat|broken|unreliable|complaint|poor support|bad support)\w*\b/.test(evidenceText)) return "competitor_complaint";
  if (/\b(dissatisf|unreliable|overwhelming|frustrat)\w*\b/.test(evidenceText) && (pains.length || objections.length)) return "category_dissatisfaction";
  if (/\b(inefficien|slow|time consuming|repetitive|duplicate work|bottleneck)\w*\b/.test(evidenceText) && (pains.length || jobs.length)) return "workflow_inefficiency";

  switch (query.query_family) {
    case "pain": return pains.length ? "pain_frustration" : "unclassified";
    case "feature_requirement": return features.length ? "feature_request" : "unclassified";
    case "jtbd": return jobs.length ? "job_to_be_done" : "unclassified";
    case "switching": return profile?.switching_triggers.some((item) => keys.has(item.key)) ? "switching_intent" : "unclassified";
    case "comparison": return query.competitor_refs.length || profile?.comparison_terms.some((item) => keys.has(item.key)) ? "comparison_versus" : "unclassified";
    case "alternative_search": {
      if (alternatives.some((item) => item.alternative_type === "competitor_product")) return "alternative_search";
      if (alternatives.some((item) => ["internal_build", "service_provider", "generic_tool", "status_quo"].includes(item.alternative_type))) return "replacement_substitute";
      return query.alternative_refs.length ? "alternative_search" : "unclassified";
    }
    case "recommendation":
      return profile?.buying_intents.some((item) => ["recommendation_request", "purchase_research"].includes(item.intent_type) && item.relevance >= 0.35)
        ? "purchase_adoption" : "unclassified";
    case "desired_outcome": return outcomes.length ? "unmet_need" : "unclassified";
    case "objection": return objections.length ? "unmet_need" : "unclassified";
    case "category_discovery": return "unclassified";
  }
}
