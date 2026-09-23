import { describe, expect, it } from "vitest";

import { formatSignalCard, type SignalCardSignal } from "../../src/components/dashboard/signal-card.presenter";
import { classifyConversationIntent, detectIntentTarget } from "../../src/server/modules/intelligence/intent-semantics";

describe("intent target semantics", () => {
  it("keeps product alternative search distinct from authentication alternatives", () => {
    expect(classifyConversationIntent("We are looking for an alternative to Jira.")).toBe("alternative_search");
    expect(detectIntentTarget("We are looking for an alternative to Jira.")).toBe("product");
    expect(classifyConversationIntent("We need an alternative OAuth authentication method for Jira.")).not.toBe("alternative_search");
    expect(detectIntentTarget("We need an alternative OAuth authentication method for Jira.")).toBe("authentication");
  });

  it("keeps product switching distinct from implementation switching", () => {
    expect(classifyConversationIntent("We are switching away from Jira.")).toBe("switching_intent");
    expect(classifyConversationIntent("We are switching our Jira integration implementation.")).not.toBe("switching_intent");
    expect(detectIntentTarget("We are switching our Jira integration implementation.")).toBe("implementation");
  });
});

describe("signal card presenter", () => {
  it("keeps the summary, why, and evidence concise and user-facing", () => {
    const signal: SignalCardSignal = {
      excerpt: "We are switching away from Jira because the workflow is too complex for our engineering team. The post includes a long raw markdown explanation that should not make the card grow without bound.",
      whyItMatters: "Qualified because the candidate is actively considering a switch, clears the explicit demand and evidence gates, and is commercially relevant.",
      intentType: "switching_intent",
      tags: [],
      buyerLanguage: [],
      painThemes: ["complex workflow"],
      qualification: null,
    };

    const presentation = formatSignalCard(signal);
    expect(presentation.summary.length).toBeLessThanOrEqual(110);
    expect(presentation.why.length).toBeLessThanOrEqual(140);
    expect(presentation.why.toLowerCase()).not.toMatch(/qualified|candidate|evidence gates|commercially relevant/);
    expect(presentation.evidence.length).toBeLessThanOrEqual(180);
  });

  it("renders directional qualification copy as the WHY", () => {
    const signal: SignalCardSignal = {
      excerpt: "Orbit needs an importer for teams migrating from Jira or Linear.",
      whyItMatters: "Internal qualification rationale should not appear on the card.",
      intentType: "switching_intent",
      tags: [],
      buyerLanguage: [],
      painThemes: [],
      qualification: {
        demand_target_type: "third_party_product",
        qualification_reason: "Conversation wants to move or migrate existing work into Orbit from Jira and Linear.",
        evidence_spans: [],
        matched_profile_concepts: [],
      } as unknown as NonNullable<SignalCardSignal["qualification"]>,
    };

    expect(formatSignalCard(signal).why).toBe("Conversation wants to move or migrate existing work into Orbit from Jira and Linear.");
  });
});
