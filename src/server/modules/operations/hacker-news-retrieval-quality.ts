export const hackerNewsPainLaunchMismatchReason = "hn_show_hn_launch_mismatch" as const;

export type HackerNewsPainLaunchSuppressedCandidate = {
  conversationId: string;
  queryPlanId: string;
  titleMatchedShowHn: true;
};

export type HackerNewsPainLaunchFilterDiagnostics = {
  inspectedCount: number;
  suppressedCount: number;
  passedCount: number;
  suppressionReason: typeof hackerNewsPainLaunchMismatchReason;
  suppressed: HackerNewsPainLaunchSuppressedCandidate[];
};

export function emptyHackerNewsPainLaunchFilterDiagnostics(): HackerNewsPainLaunchFilterDiagnostics {
  return {
    inspectedCount: 0,
    suppressedCount: 0,
    passedCount: 0,
    suppressionReason: hackerNewsPainLaunchMismatchReason,
    suppressed: [],
  };
}

/** Exact, deterministic retained-title check; intentionally not a promotion classifier. */
export function titleMatchesExplicitShowHnLaunch(title: string | null | undefined): boolean {
  const normalized = (title ?? "").replace(/\s+/g, " ").trim();
  return /^show\s+hn\s*:/i.test(normalized);
}
