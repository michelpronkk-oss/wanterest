export const ENTITY_DISAMBIGUATION_VERSION = "entity_disambiguation_v1" as const;

/**
 * Per-entity collocation guards, keyed by lowercased entity name. A mention that
 * satisfies its entry's pattern in the surrounding text is a common-word usage,
 * not a reference to the product/company of the same name. Extend this map for
 * any other entity whose name is also an ordinary English word or phrase -
 * nothing here is specific to a single hardcoded name.
 */
const NON_ENTITY_COLLOCATIONS: Record<string, RegExp> = {
  linear: /\blinear\s+(?:regression|regressions|algebra|model|models|equation|equations|function|functions|scale|scaling|time|fashion|programming|search|interpolation|map|mapping|gradient|gradients|layer|layers|unit|units|transformation|transformations|combination|combinations|system|systems|approximation|approximations)\b/i,
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Whether a name match at `matchIndex` in `text` is a plausible reference to the
 * named entity, versus a common-word/technical-term collocation that happens to
 * contain the same word. Only rules out matches; a name with no configured
 * collocation guard is always treated as a likely entity mention.
 */
export function isLikelyEntityMention(name: string, text: string, matchIndex: number): boolean {
  const guard = NON_ENTITY_COLLOCATIONS[name.trim().toLowerCase()];
  if (!guard) return true;
  const windowStart = Math.max(0, matchIndex - 10);
  const window = text.slice(windowStart, matchIndex + name.length + 40);
  return !guard.test(window);
}

/**
 * Filters a list of candidate name mentions in `text` down to likely entity
 * references. A name is kept if ANY of its occurrences in `text` is a likely
 * entity mention - a text with both a false-positive collocation ("linear
 * regression") and a genuine mention ("switch to Linear") must not reject the
 * name outright because of the first occurrence alone.
 */
export function filterLikelyEntityMentions(names: string[], text: string): string[] {
  return names.filter((name) => {
    const matches = [...text.matchAll(new RegExp(`\\b${escapeRegExp(name)}\\b`, "gi"))];
    if (!matches.length) return true;
    return matches.some((match) => isLikelyEntityMention(name, text, match.index ?? 0));
  });
}
