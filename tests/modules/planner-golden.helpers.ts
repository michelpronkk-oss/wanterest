import { createHash } from "node:crypto";

import { businessClassificationFixtures } from "../../src/server/modules/intelligence/business-classification.fixtures";
import { classifyProductBusiness } from "../../src/server/modules/intelligence/business-classification.service";
import { demandProfileV2Fixtures } from "../../src/server/modules/intelligence/demand-profile-v2.fixtures";
import { buildDemandProfileV2, readDemandProfileV2RoutingModel } from "../../src/server/modules/intelligence/demand-profile-v2.service";
import { buildSourceRoutingPlan, type QueryPlanningInput, type SourceRoutingSourceState } from "../../src/server/modules/operations";

/** Layer 12A.2: deterministic planner inputs used to prove query_planning_v7 output is unchanged. */
const sources = (): SourceRoutingSourceState[] => ["hacker-news", "bluesky", "reddit", "github", "x", "stack-exchange", "youtube", "product-hunt"].map((sourceKey) => ({ sourceKey, configured: true, controlState: "enabled", healthStatus: "healthy" }));
const modes = ["onboarding", "manual", "monitoring", "intelligence_cycle"] as const;

export async function plannerGoldenInputs(): Promise<Array<{ name: string; input: QueryPlanningInput }>> {
  const inputs: Array<{ name: string; input: QueryPlanningInput }> = [];
  for (const profileFixture of demandProfileV2Fixtures) {
    const classificationFixture = businessClassificationFixtures[inputs.length % businessClassificationFixtures.length];
    const classification = await classifyProductBusiness(classificationFixture.input);
    const profile = await buildDemandProfileV2({
      ...profileFixture.input,
      snapshot: { id: "44444444-4444-4444-8444-444444444444", normalized_text: profileFixture.input.snapshotText, source_url: profileFixture.input.websiteUrl ?? null, metadata: {}, page_type: "manual" },
      businessClassification: classification,
    });
    const model = readDemandProfileV2RoutingModel(profile);
    for (const scanMode of modes) {
      const routing = buildSourceRoutingPlan({ productId: `golden-${profileFixture.name}`, classification, demandProfile: model, sourceStates: sources(), scanMode, totalCandidateBudget: 40, maxSources: 6 });
      for (const maxQueries of [undefined, 6]) {
        inputs.push({ name: `${profileFixture.name}/${scanMode}/${maxQueries ?? "none"}`, input: { classification, demandProfile: model, sourceRoutingPlan: routing, scanMode, maxQueries } });
      }
    }
  }
  return inputs;
}

export function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
