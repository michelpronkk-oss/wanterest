import { describe, expect, it } from "vitest";

import { buildConversationMarketReasoning } from "../../src/server/modules/intelligence/conversation-market-reasoning";
import { deriveDirectionalDemand } from "../../src/server/modules/intelligence/directional-demand";
import { marketContextCalibrationFixtures } from "../../src/server/modules/intelligence/market-context.fixtures";
import { fallbackMarketContext } from "../../src/server/modules/intelligence/market-context";

describe("market-context calibration harness", () => {
  it("replays representative directional and safety cases", () => {
    const context = fallbackMarketContext({ productName: "Linear", category: "issue tracking", capabilities: ["feature X"], jobs: ["manage engineering work"], pains: [], buyerRoles: ["engineering team"], competitors: ["Jira"], alternatives: [] });
    for (const fixture of marketContextCalibrationFixtures) {
      const repository = "repository" in fixture ? fixture.repository : undefined;
      const metadata = repository ? { repository, repositoryName: repository.split("/").at(-1) } : {};
      const demand = deriveDirectionalDemand({ productName: "Linear", title: null, body: fixture.body, sourceKey: "github", sourceMetadata: metadata, knownProducts: context.relationships.map((item) => item.entity_name), category: "issue tracking" });
      const reasoning = buildConversationMarketReasoning({ productName: "Linear", context, demand, title: null, body: fixture.body, analysis: { pain_themes: [], desired_outcomes: [], buyer_language: [], confidence: 0.8 } });
      if ("expectedDirection" in fixture) expect(demand.demand_direction, fixture.name).toBe(fixture.expectedDirection);
      if ("expectedTarget" in fixture) expect(demand.demand_target_name, fixture.name).toBe(fixture.expectedTarget);
      if ("expectedTargetType" in fixture) expect(demand.demand_target_type, fixture.name).toBe(fixture.expectedTargetType);
      if ("promotional" in fixture && fixture.promotional) expect(reasoning.promotional_content, fixture.name).toBe(true);
    }
  });
});
