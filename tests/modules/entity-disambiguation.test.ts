import { describe, expect, it } from "vitest";

import { ENTITY_DISAMBIGUATION_VERSION, filterLikelyEntityMentions, isLikelyEntityMention } from "../../src/server/modules/intelligence/entity-disambiguation";

describe("entity disambiguation (entity_disambiguation_v1)", () => {
  it("is versioned", () => {
    expect(ENTITY_DISAMBIGUATION_VERSION).toBe("entity_disambiguation_v1");
  });

  function indexOfWord(text: string, word: string): number {
    const index = text.toLowerCase().indexOf(word.toLowerCase());
    if (index < 0) throw new Error(`"${word}" not found in fixture text`);
    return index;
  }

  it("rejects 'linear' inside a technical/mathematical collocation", () => {
    const regression = "We need to run a linear regression on this dataset.";
    expect(isLikelyEntityMention("Linear", regression, indexOfWord(regression, "linear"))).toBe(false);
    const time = "The API scales in linear time with input size.";
    expect(isLikelyEntityMention("Linear", time, indexOfWord(time, "linear"))).toBe(false);
    const algebra = "We solved it with linear algebra and a simple model.";
    expect(isLikelyEntityMention("Linear", algebra, indexOfWord(algebra, "linear"))).toBe(false);
  });

  it("keeps a genuine 'Linear' product reference in a switching sentence", () => {
    const text = "We are switching from Jira to Linear because Jira is too slow.";
    expect(isLikelyEntityMention("Linear", text, indexOfWord(text, "Linear"))).toBe(true);
  });

  it("filters a mixed list down to only likely entity mentions", () => {
    const text = "We ran a linear regression, then decided to switch from Jira to Linear.";
    const kept = filterLikelyEntityMentions(["Linear", "Jira"], text);
    expect(kept).toContain("Jira");
    expect(kept).toContain("Linear");
  });

  it("suppresses a lone technical mention with no genuine product reference nearby", () => {
    const text = "Our forecasting model uses linear regression to fit the trend line.";
    expect(filterLikelyEntityMentions(["Linear"], text)).toEqual([]);
  });

  it("has no effect on names without a configured collocation guard", () => {
    expect(isLikelyEntityMention("Notion", "We use Notion for docs.", 7)).toBe(true);
  });

  it("stays permissive when no direct word-boundary match is found (defensive fallback)", () => {
    // mentionPattern-style callers only pass names that already matched some
    // boundary test; a defensive true keeps behavior unchanged if that invariant
    // is ever violated by a caller.
    expect(filterLikelyEntityMentions(["Linear's"], "Something about Linear's roadmap.")).toEqual(["Linear's"]);
  });
});
