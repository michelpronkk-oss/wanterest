import { z } from "zod";

import type { IndependenceMetrics } from "./organic-intelligence.schemas";

const episodeObservationSchema = z.object({
  // Opaque upstream conversation/episode identity; content is deliberately absent.
  episodeKey: z.string().trim().min(1).max(160),
  authorKey: z.string().trim().min(1).max(160).nullable(),
  sourceFamily: z.string().trim().min(1).max(80),
  // Month buckets sort chronologically and can be checked against observedAt.
  timeBucket: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  observedAt: z.iso.datetime(),
  duplicate: z.boolean(),
  viralEventKey: z.string().trim().min(1).max(160).nullable(),
  regionKey: z.string().trim().min(1).max(120).nullable(),
  geographyConfidence: z.number().min(0).max(1).nullable(),
}).strict().superRefine((observation, context) => {
  if (observation.timeBucket !== observation.observedAt.slice(0, 7)) {
    context.addIssue({ code: "custom", path: ["timeBucket"], message: "time_bucket_must_match_observed_at" });
  }
});

export type EpisodeObservation = z.infer<typeof episodeObservationSchema>;

export type IndependentEpisodeMeasurement = {
  state: "available" | "unavailable";
  metrics: IndependenceMetrics;
  rawObservationCount: number;
  duplicateObservationCount: number;
  reason: "complete" | "no_observations" | "author_identity_unavailable";
};

type EpisodeGroup = {
  representative: EpisodeObservation;
};

function average(values: number[]): number | null {
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function accelerationByBucket(groups: EpisodeGroup[]): number | null {
  const counts = new Map<string, number>();
  for (const group of groups) {
    const bucket = group.representative.timeBucket;
    counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
  }
  const observedBuckets = [...counts.keys()].sort();
  if (observedBuckets.length === 0) return null;
  const [firstYear, firstMonth] = observedBuckets[0]!.split("-").map(Number);
  const [lastYear, lastMonth] = observedBuckets.at(-1)!.split("-").map(Number);
  const firstIndex = firstYear! * 12 + firstMonth! - 1;
  const lastIndex = lastYear! * 12 + lastMonth! - 1;
  const orderedBuckets: string[] = [];
  for (let index = firstIndex; index <= lastIndex; index += 1) {
    const year = Math.floor(index / 12);
    const month = (index % 12) + 1;
    orderedBuckets.push(`${year}-${String(month).padStart(2, "0")}`);
  }
  if (orderedBuckets.length < 4) return null;
  const midpoint = Math.floor(orderedBuckets.length / 2);
  const baseline = average(orderedBuckets.slice(0, midpoint).map((key) => counts.get(key) ?? 0));
  const recent = average(orderedBuckets.slice(midpoint).map((key) => counts.get(key) ?? 0));
  if (baseline === null || recent === null || baseline === 0) return null;
  return (recent - baseline) / baseline;
}

function unavailable(reason: IndependentEpisodeMeasurement["reason"], rawObservationCount: number, duplicateObservationCount: number): IndependentEpisodeMeasurement {
  return {
    state: "unavailable",
    reason,
    rawObservationCount,
    duplicateObservationCount,
    metrics: {
      independentEpisodeCount: null,
      uniqueAuthorCount: null,
      sourceFamilyCount: null,
      timeBucketCount: null,
      firstObservedAt: null,
      lastObservedAt: null,
      duplicateRatio: null,
      sourceConcentration: null,
      viralEventConcentration: null,
      independentEpisodeAcceleration: null,
      geographyConfidence: null,
      regionalIndependentEpisodeCount: null,
    },
  };
}

/**
 * Measures already-canonicalized evidence episode records. It does not parse
 * comments, count mentions, or infer author/event identities from source text.
 * A viral event is conservatively collapsed to one episode across platforms.
 */
export function measureIndependentEpisodes(input: readonly EpisodeObservation[]): IndependentEpisodeMeasurement {
  const parsed = z.array(episodeObservationSchema).safeParse(input);
  if (!parsed.success) throw new Error("episode_observation_invalid");
  const observations = parsed.data;
  if (observations.length === 0) return unavailable("no_observations", 0, 0);

  const duplicateObservationCount = observations.filter((item) => item.duplicate).length;
  const usable = observations.filter((item) => !item.duplicate);
  if (usable.length === 0) return unavailable("no_observations", observations.length, duplicateObservationCount);
  if (usable.some((item) => item.authorKey === null)) {
    return unavailable("author_identity_unavailable", observations.length, duplicateObservationCount);
  }

  const byIndependentKey = new Map<string, EpisodeObservation[]>();
  for (const item of usable) {
    const key = item.viralEventKey ? `viral:${item.viralEventKey}` : `episode:${item.episodeKey}`;
    const group = byIndependentKey.get(key) ?? [];
    group.push(item);
    byIndependentKey.set(key, group);
  }

  const groups: EpisodeGroup[] = [...byIndependentKey.values()].map((group) => {
    const ordered = [...group].sort((left, right) => {
      const dateOrder = left.observedAt.localeCompare(right.observedAt);
      return dateOrder || left.sourceFamily.localeCompare(right.sourceFamily) || left.episodeKey.localeCompare(right.episodeKey);
    });
    return { representative: ordered[0]! };
  });

  const timeBuckets = new Set(groups.map((group) => group.representative.timeBucket));
  // Count one author per independent episode; replies and reposts inside a
  // single viral event cannot manufacture author breadth.
  const authors = new Set(groups.map((group) => group.representative.authorKey!));
  const sourceFamilies = new Set(groups.map((group) => group.representative.sourceFamily));
  const firstObservedAt = groups.map((group) => group.representative.observedAt).sort()[0] ?? null;
  const lastObservedAt = groups.map((group) => group.representative.observedAt).sort().at(-1) ?? null;
  const sourceVolumes = new Map<string, number>();
  const viralVolumes = new Map<string, number>();
  for (const group of groups) {
    const family = group.representative.sourceFamily;
    sourceVolumes.set(family, (sourceVolumes.get(family) ?? 0) + 1);
  }
  for (const item of observations) {
    if (item.viralEventKey) viralVolumes.set(item.viralEventKey, (viralVolumes.get(item.viralEventKey) ?? 0) + 1);
  }
  const total = observations.length;
  const sourceConcentration = Math.max(...sourceVolumes.values()) / groups.length;
  const viralEventConcentration = viralVolumes.size === 0 ? 0 : Math.max(...viralVolumes.values()) / total;
  const geographicallyKnown = groups.filter((group) => group.representative.regionKey && group.representative.geographyConfidence !== null);
  const highConfidenceRegional = geographicallyKnown.filter((group) => group.representative.geographyConfidence! >= 0.85);

  return {
    state: "available",
    reason: "complete",
    rawObservationCount: total,
    duplicateObservationCount,
    metrics: {
      independentEpisodeCount: groups.length,
      uniqueAuthorCount: authors.size,
      sourceFamilyCount: sourceFamilies.size,
      timeBucketCount: timeBuckets.size,
      firstObservedAt,
      lastObservedAt,
      duplicateRatio: duplicateObservationCount / total,
      sourceConcentration,
      viralEventConcentration,
      independentEpisodeAcceleration: accelerationByBucket(groups),
      geographyConfidence: groups.length === 0 ? null : geographicallyKnown.length / groups.length,
      regionalIndependentEpisodeCount: highConfidenceRegional.length,
    },
  };
}
