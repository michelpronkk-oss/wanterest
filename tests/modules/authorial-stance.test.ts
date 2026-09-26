import { describe, expect, it } from "vitest";

import { AUTHORIAL_STANCE_VERSION, classifyAuthorialStance } from "../../src/server/modules/intelligence/authorial-stance";

describe("authorial stance (authorial_stance_v1)", () => {
  it("is versioned", () => {
    expect(AUTHORIAL_STANCE_VERSION).toBe("authorial_stance_v1");
  });

  it("classifies a launch post naming a competitor as vendor marketing, not buyer demand", () => {
    const result = classifyAuthorialStance({ text: "We just launched Foo, a better alternative to Jira.", hasCompetitorOrAlternativeClaim: true });
    expect(result.stance).toBe("vendor_marketing");
  });

  it("classifies Show HN launch posts as vendor marketing", () => {
    const result = classifyAuthorialStance({ text: "Show HN: Foo - a simpler alternative to Jira", hasCompetitorOrAlternativeClaim: true });
    expect(result.stance).toBe("vendor_marketing");
  });

  it("does not classify a launch pattern as vendor marketing without a competitor/alternative claim", () => {
    const result = classifyAuthorialStance({ text: "We just launched a new feature for our internal team.", hasCompetitorOrAlternativeClaim: false });
    expect(result.stance).not.toBe("vendor_marketing");
  });

  it("classifies independent buyer switching language as buyer", () => {
    const result = classifyAuthorialStance({ text: "We are evaluating alternatives to Jira for our engineering team.", hasCompetitorOrAlternativeClaim: true });
    expect(result.stance).toBe("buyer");
  });

  it("prefers buyer when both buyer and vendor-pitch patterns are present", () => {
    const result = classifyAuthorialStance({ text: "We built our own internal tool, but we are evaluating alternatives to Jira instead.", hasCompetitorOrAlternativeClaim: true });
    expect(result.stance).toBe("buyer");
  });

  it("classifies text with no first-person language as third-party technical discussion", () => {
    const result = classifyAuthorialStance({ text: "The team migrated their issue tracker from Jira to Linear last quarter.", hasCompetitorOrAlternativeClaim: true });
    expect(result.stance).toBe("third_party_technical_discussion");
  });

  it("classifies ambiguous first-person text with no clear pitch or buyer pattern as unknown", () => {
    const result = classifyAuthorialStance({ text: "I think our workflow could be better someday.", hasCompetitorOrAlternativeClaim: false });
    expect(result.stance).toBe("unknown");
  });
});
