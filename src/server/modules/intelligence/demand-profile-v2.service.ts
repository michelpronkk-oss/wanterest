import type { Json } from "../../db/database.helpers";
import type { ProductSnapshotRow } from "../../db/database.helpers";
import type { BusinessClassification } from "./business-classification.schemas";
import { demandProfileV2Schema, type DemandProfileV2 } from "./demand-profile-v2.schemas";
import { demandProfileV2Version } from "./demand-profile-v2.schemas";
import { normalizeDemandProfileV2 } from "./demand-profile-v2.normalizer";
import { FixtureDemandProfileV2Engine, type DemandProfileV2Engine, type DemandProfileV2Input, type DemandProfileV2Hints } from "./demand-profile-v2.engines";

export type BuildDemandProfileV2Input = Omit<DemandProfileV2Input, "snapshotText"> & {
  snapshot: Pick<ProductSnapshotRow, "id" | "normalized_text" | "source_url" | "metadata" | "page_type">;
  hints?: DemandProfileV2Hints;
};

export type DemandProfileV2RoutingModel = Pick<DemandProfileV2["identity"], "product_name" | "business_type" | "business_model" | "delivery_model" | "market_scope" | "technical_orientation" | "primary_category"> & Pick<DemandProfileV2["audience"], "target_customer_types" | "buyer_roles" | "end_user_types"> & {
  pains: DemandProfileV2["problems"];
  desired_outcomes: DemandProfileV2["desired_outcomes"];
  jobs_to_be_done: DemandProfileV2["jobs_to_be_done"];
  switching_triggers: DemandProfileV2["switching_triggers"];
  buying_intents: DemandProfileV2["buying_intents"];
  feature_demands: DemandProfileV2["feature_demands"];
  objections: DemandProfileV2["objections"];
  known_competitors: DemandProfileV2["competitors"]["known_competitors"];
  detected_competitor_candidates: DemandProfileV2["competitors"]["detected_competitor_candidates"];
  alternative_solutions: DemandProfileV2["alternatives"];
  comparison_terms: DemandProfileV2["comparison_terms"];
  language: DemandProfileV2["language"];
  geography: DemandProfileV2["geography"];
  location_dependency: number;
  profile_confidence: number;
};

export type DemandProfileV2QualificationProjection = {
  relevant_pains: DemandProfileV2["problems"];
  relevant_outcomes: DemandProfileV2["desired_outcomes"];
  relevant_intents: DemandProfileV2["buying_intents"];
  relevant_jtbd: DemandProfileV2["jobs_to_be_done"];
  relevant_features: DemandProfileV2["feature_demands"];
  buyer_roles: string[];
  competitors: DemandProfileV2["competitors"]["known_competitors"];
  alternatives: DemandProfileV2["alternatives"];
  geography: DemandProfileV2["geography"];
  profile_confidence: number;
  primary_category: string;
  market_scope: DemandProfileV2["identity"]["market_scope"];
};

function metadataObject(value: Json): Record<string, Json> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, Json> : {};
}

export async function buildDemandProfileV2(
  input: BuildDemandProfileV2Input,
  engine: DemandProfileV2Engine = new FixtureDemandProfileV2Engine(),
  engineVersionId?: string | null,
): Promise<DemandProfileV2> {
  const generated = await engine.generate({
    productName: input.productName,
    companyName: input.companyName ?? null,
    websiteUrl: input.websiteUrl ?? input.snapshot.source_url,
    snapshotText: input.snapshot.normalized_text,
    sourceReference: input.sourceReference,
    businessClassification: input.businessClassification ?? null,
    hints: input.hints,
  });
  const profile = normalizeDemandProfileV2(generated.output, {
    version: engine.version,
    engineVersionId,
    provider: generated.provider,
    model: generated.model,
    promptVersion: generated.promptVersion,
    productName: input.productName,
    companyName: input.companyName,
    businessClassification: input.businessClassification,
  });
  if (!profile.evidence.length && !profile.problems.length && !profile.desired_outcomes.length && !profile.jobs_to_be_done.length) {
    throw new Error("Demand Profile v2 returned no inspectable evidence.");
  }
  return profile;
}

export async function tryBuildDemandProfileV2(input: BuildDemandProfileV2Input, engine: DemandProfileV2Engine = new FixtureDemandProfileV2Engine(), engineVersionId?: string | null): Promise<DemandProfileV2 | null> {
  try {
    return await buildDemandProfileV2(input, engine, engineVersionId);
  } catch {
    return null;
  }
}

export function readDemandProfileV2(snapshot: Pick<ProductSnapshotRow, "metadata">): DemandProfileV2 | null {
  const metadata = metadataObject(snapshot.metadata);
  const result = demandProfileV2Schema.safeParse(metadata.demand_profile_v2);
  return result.success ? result.data : null;
}

export function readDemandProfileV2RoutingModel(profile: DemandProfileV2): DemandProfileV2RoutingModel {
  return {
    product_name: profile.identity.product_name,
    business_type: profile.identity.business_type,
    business_model: profile.identity.business_model,
    delivery_model: profile.identity.delivery_model,
    market_scope: profile.identity.market_scope,
    technical_orientation: profile.identity.technical_orientation,
    primary_category: profile.identity.primary_category,
    target_customer_types: profile.audience.target_customer_types,
    buyer_roles: profile.audience.buyer_roles,
    end_user_types: profile.audience.end_user_types,
    pains: profile.problems,
    desired_outcomes: profile.desired_outcomes,
    jobs_to_be_done: profile.jobs_to_be_done,
    switching_triggers: profile.switching_triggers,
    buying_intents: profile.buying_intents,
    feature_demands: profile.feature_demands,
    objections: profile.objections,
    known_competitors: profile.competitors.known_competitors,
    detected_competitor_candidates: profile.competitors.detected_competitor_candidates,
    alternative_solutions: profile.alternatives,
    comparison_terms: profile.comparison_terms,
    language: profile.language,
    geography: profile.geography,
    location_dependency: profile.geography.location_dependency,
    profile_confidence: profile.confidence.overall_profile_confidence,
  };
}

export function projectDemandProfileV2ForQualification(profile: DemandProfileV2): DemandProfileV2QualificationProjection {
  return {
    relevant_pains: profile.problems,
    relevant_outcomes: profile.desired_outcomes,
    relevant_intents: profile.buying_intents,
    relevant_jtbd: profile.jobs_to_be_done,
    relevant_features: profile.feature_demands,
    buyer_roles: profile.audience.buyer_roles,
    competitors: profile.competitors.known_competitors,
    alternatives: profile.alternatives,
    geography: profile.geography,
    profile_confidence: profile.confidence.overall_profile_confidence,
    primary_category: profile.identity.primary_category,
    market_scope: profile.identity.market_scope,
  };
}

export function demandProfileV2VersionOf(profile: DemandProfileV2 | null): string | null {
  return profile?.version === demandProfileV2Version ? profile.version : null;
}

export type { BusinessClassification };
