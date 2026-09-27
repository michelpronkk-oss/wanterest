export type SharedDepthTelemetry = {
  policyVersion: string;
  searchRoots: number;
  depthEligible: number;
  depthExpanded: number;
  depthRequests: number;
  commentsLoaded: number;
  commentsPersisted: number;
  dropped: number;
  deduplicated: number;
  refreshSkips: number;
  quotaSkips: number;
};

export function createSharedDepthTelemetry(policyVersion: string): SharedDepthTelemetry {
  return {
    policyVersion,
    searchRoots: 0,
    depthEligible: 0,
    depthExpanded: 0,
    depthRequests: 0,
    commentsLoaded: 0,
    commentsPersisted: 0,
    dropped: 0,
    deduplicated: 0,
    refreshSkips: 0,
    quotaSkips: 0,
  };
}

export function mergeSharedDepthTelemetry<T extends SharedDepthTelemetry>(target: T, next: T): T {
  return {
    ...target,
    searchRoots: target.searchRoots + next.searchRoots,
    depthEligible: target.depthEligible + next.depthEligible,
    depthExpanded: target.depthExpanded + next.depthExpanded,
    depthRequests: target.depthRequests + next.depthRequests,
    commentsLoaded: target.commentsLoaded + next.commentsLoaded,
    commentsPersisted: target.commentsPersisted + next.commentsPersisted,
    dropped: target.dropped + next.dropped,
    deduplicated: target.deduplicated + next.deduplicated,
    refreshSkips: target.refreshSkips + next.refreshSkips,
    quotaSkips: target.quotaSkips + next.quotaSkips,
  };
}

export function stableDepthIdentity(sourceKey: string, kind: string, externalId: number | string): string {
  return `${sourceKey}:${kind}:${externalId}`;
}
