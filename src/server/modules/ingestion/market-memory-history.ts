/** Minimal history model derived from existing global identity and private retrieval telemetry. */
export type MarketMemoryObservation = {
  observedAt: string;
  executionId: string;
  rawSnapshotInserted: boolean | null;
};

export type MarketMemoryHistory = {
  /** Persisted canonical identity timestamp; never replaced with evaluation time. */
  firstSeenAt: string;
  firstRetrievedAt: string | null;
  lastRetrievedAt: string | null;
  lastSeenAt: string | null;
  retrievalCount: number | null;
  distinctExecutionCount: number | null;
  rawSnapshotReuseCount: number | null;
  coverage: "observed" | "partial" | "unavailable";
};

export function marketMemoryHistory(input: {
  firstSeenAt: string;
  observations: MarketMemoryObservation[] | null;
  observationSetComplete?: boolean;
}): MarketMemoryHistory {
  const observations = input.observations;
  if (observations === null) {
    return {
      firstSeenAt: input.firstSeenAt,
      firstRetrievedAt: null,
      lastRetrievedAt: null,
      lastSeenAt: null,
      retrievalCount: null,
      distinctExecutionCount: null,
      rawSnapshotReuseCount: null,
      coverage: "unavailable",
    };
  }

  if (!observations.length) {
    return {
      firstSeenAt: input.firstSeenAt,
      firstRetrievedAt: null,
      lastRetrievedAt: null,
      lastSeenAt: null,
      retrievalCount: null,
      distinctExecutionCount: null,
      rawSnapshotReuseCount: null,
      coverage: "partial",
    };
  }

  const chronological = [...observations].sort((left, right) =>
    Date.parse(left.observedAt) - Date.parse(right.observedAt) || left.observedAt.localeCompare(right.observedAt));
  const firstRetrievedAt = chronological[0]?.observedAt ?? null;
  const lastRetrievedAt = chronological.at(-1)?.observedAt ?? null;
  const knownReuseCount = observations.filter((observation) => observation.rawSnapshotInserted === false).length;
  const unknownReuseCount = observations.some((observation) => observation.rawSnapshotInserted === null);
  return {
    firstSeenAt: input.firstSeenAt,
    firstRetrievedAt,
    lastRetrievedAt,
    lastSeenAt: lastRetrievedAt,
    retrievalCount: observations.length,
    distinctExecutionCount: new Set(observations.map((observation) => observation.executionId)).size,
    rawSnapshotReuseCount: unknownReuseCount ? null : knownReuseCount,
    coverage: input.observationSetComplete === false || unknownReuseCount ? "partial" : "observed",
  };
}
