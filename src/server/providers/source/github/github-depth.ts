export const GITHUB_DEPTH_VERSION = "github_depth_v1" as const;

export const GITHUB_DEPTH_MAX_THREADS_PER_PAGE = 3;
export const GITHUB_DEPTH_MAX_COMMENTS_PER_THREAD = 12;
export const GITHUB_DEPTH_MAX_COMMENT_PAGES = 2;

const DEMAND_LANGUAGE = [
  "need",
  "looking for",
  "struggling",
  "wish",
  "would like",
  "please add",
  "feature request",
  "alternative",
  "replace",
  "migrat",
  "workaround",
  "can't",
  "cannot",
  "unable",
  "missing",
  "slow",
  "manual",
  "support",
  "should",
] as const;

const AUTOMATION_LABELS = [
  "automated",
  "bot",
  "chore",
  "dependencies",
  "dependency",
  "release",
  "security",
  "maintenance",
] as const;

export type GitHubDepthEligibilityReason =
  | "eligible"
  | "automation"
  | "no_comments"
  | "not_demand_like";

export type GitHubDepthRoot = {
  title: string;
  body?: string | null;
  authorType?: string | null;
  labels?: readonly string[];
  commentsAvailable: boolean;
};

export type GitHubDepthEligibility = {
  eligible: boolean;
  reason: GitHubDepthEligibilityReason;
  matchedLanguage: string | null;
};

function normalized(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

export function isGitHubAutomatedAuthor(authorType: string | null | undefined): boolean {
  const value = normalized(authorType);
  return value === "bot" || value === "app" || value === "automation";
}

export function evaluateGitHubDepth(root: GitHubDepthRoot): GitHubDepthEligibility {
  const title = normalized(root.title);
  const body = normalized(root.body);
  const text = `${title}\n${body}`;
  const labels = (root.labels ?? []).map(normalized);
  const automated = isGitHubAutomatedAuthor(root.authorType)
    || labels.some((label) => AUTOMATION_LABELS.some((term) => label === term || label.includes(`${term}/`) || label.includes(`${term}-`)));
  if (automated) return { eligible: false, reason: "automation", matchedLanguage: null };
  if (!root.commentsAvailable) return { eligible: false, reason: "no_comments", matchedLanguage: null };
  const matchedLanguage = DEMAND_LANGUAGE.find((term) => text.includes(term)) ?? null;
  if (!matchedLanguage) return { eligible: false, reason: "not_demand_like", matchedLanguage: null };
  return { eligible: true, reason: "eligible", matchedLanguage };
}

export function githubUpdatedQualifier(windowStart: string | undefined): string | null {
  if (!windowStart) return null;
  const parsed = new Date(windowStart);
  if (!Number.isFinite(parsed.getTime())) return null;
  return `updated:>=${parsed.toISOString().slice(0, 10)}`;
}

export function isGitHubWithinWindow(input: {
  updatedAt?: string | null;
  windowStart?: string;
  windowEnd?: string;
}): boolean {
  if (!input.windowStart && !input.windowEnd) return true;
  if (!input.updatedAt) return false;
  const updatedAt = new Date(input.updatedAt).getTime();
  if (!Number.isFinite(updatedAt)) return false;
  if (input.windowStart) {
    const start = new Date(input.windowStart).getTime();
    if (!Number.isFinite(start) || updatedAt < start) return false;
  }
  if (input.windowEnd) {
    const end = new Date(input.windowEnd).getTime();
    if (!Number.isFinite(end) || updatedAt > end) return false;
  }
  return true;
}

export type GitHubDepthMetrics = {
  policyVersion: typeof GITHUB_DEPTH_VERSION;
  rootsSeen: number;
  eligibleRoots: number;
  ineligibleRoots: number;
  expandedRoots: number;
  expansionCapSkips: number;
  commentRequests: number;
  commentsReturned: number;
  commentsPersisted: number;
  duplicateCommentsSkipped: number;
  commentsDroppedFromIneligibleRoots: number;
  rootsOutsideRefreshWindow: number;
};

export function createGitHubDepthMetrics(): GitHubDepthMetrics {
  return {
    policyVersion: GITHUB_DEPTH_VERSION,
    rootsSeen: 0,
    eligibleRoots: 0,
    ineligibleRoots: 0,
    expandedRoots: 0,
    expansionCapSkips: 0,
    commentRequests: 0,
    commentsReturned: 0,
    commentsPersisted: 0,
    duplicateCommentsSkipped: 0,
    commentsDroppedFromIneligibleRoots: 0,
    rootsOutsideRefreshWindow: 0,
  };
}
