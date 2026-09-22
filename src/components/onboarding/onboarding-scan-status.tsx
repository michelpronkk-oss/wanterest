"use client";

import { useEffect, useRef, useState } from "react";

import { getOnboardingStatusAction, triggerOnboardingScanAction, type OnboardingStatus } from "@/app/app/setup/actions";

const POLL_INTERVAL_MS = 3000;
const TERMINAL_KINDS: ReadonlySet<OnboardingStatus["scanKind"]> = new Set([
  "completed_with_signals",
  "completed_no_signals",
  "partial_failure",
  "failed",
]);

type Props = {
  workspaceId: string;
  productId: string;
  hasScan: boolean;
  initialStatus: OnboardingStatus;
};

export function OnboardingScanStatus({ workspaceId, productId, hasScan, initialStatus }: Props) {
  const [status, setStatus] = useState(initialStatus);
  const [retrying, setRetrying] = useState(false);
  const triggeredRef = useRef(hasScan);

  useEffect(() => {
    if (triggeredRef.current) return;
    triggeredRef.current = true;
    void triggerOnboardingScanAction({ workspaceId, productId }).then((result) => {
      if (!result.ok) {
        setStatus({ scanKind: "failed", scanLabel: null, errorMessage: result.error, highIntentCount: 0, qualifiedCount: 0 });
      }
    });
  }, [workspaceId, productId]);

  useEffect(() => {
    if (TERMINAL_KINDS.has(status.scanKind)) return;
    let cancelled = false;
    const poll = () => {
      void getOnboardingStatusAction({ workspaceId, productId }).then((next) => {
        if (!cancelled) setStatus(next);
      }).catch(() => {
        if (!cancelled) setStatus({ scanKind: "failed", scanLabel: null, errorMessage: "We could not read the scan status. Refresh to try again.", highIntentCount: 0, qualifiedCount: 0 });
      });
    };
    const pollWhenVisible = () => {
      if (document.visibilityState === "visible") poll();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") poll();
    };
    pollWhenVisible();
    const interval = setInterval(pollWhenVisible, POLL_INTERVAL_MS);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [workspaceId, productId, status.scanKind]);

  async function retryScan() {
    if (retrying) return;
    setRetrying(true);
    setStatus({ scanKind: "running", scanLabel: "Preparing your first scan", errorMessage: null, highIntentCount: 0, qualifiedCount: 0 });
    const result = await triggerOnboardingScanAction({ workspaceId, productId, forceRebuild: true });
    if (!result.ok) {
      setStatus({ scanKind: "failed", scanLabel: null, errorMessage: result.error, highIntentCount: 0, qualifiedCount: 0 });
    } else {
      try {
        setStatus(await getOnboardingStatusAction({ workspaceId, productId }));
      } catch {
        setStatus({ scanKind: "failed", scanLabel: null, errorMessage: "The scan was started, but its status is not available yet. Refresh to continue.", highIntentCount: 0, qualifiedCount: 0 });
      }
    }
    setRetrying(false);
  }

  if (status.scanKind === "completed_with_signals") {
    const count = status.highIntentCount > 0 ? status.highIntentCount : status.qualifiedCount;
    const label = status.highIntentCount > 0 ? "high-intent conversation" : "qualified conversation";
    return (
      <div className="onboarding-highlight tone-accent">
        <div>
          <div className="onboarding-highlight-title">{count} {label}{count === 1 ? "" : "s"} found already</div>
          <div className="onboarding-highlight-note">Wanterest is ready to show you the evidence behind it.</div>
        </div>
        <div className="onboarding-highlight-figure">{count}</div>
      </div>
    );
  }

  if (status.scanKind === "completed_no_signals") {
    return (
      <div className="onboarding-highlight tone-neutral">
        <div>
          <div className="onboarding-highlight-title">No qualified demand found yet</div>
          <div className="onboarding-highlight-note">Wanterest found no qualified conversations in this first scan. It will keep watching.</div>
        </div>
      </div>
    );
  }

  if (status.scanKind === "partial_failure") {
    return (
      <div className="onboarding-highlight tone-neutral">
        <div>
          <div className="onboarding-highlight-title">Scan completed with limited source coverage</div>
          <div className="onboarding-highlight-note">Some sources were unavailable, but Wanterest continued with the remaining sources.</div>
        </div>
      </div>
    );
  }

  if (status.scanKind === "failed") {
    return (
      <div className="onboarding-highlight tone-neutral">
        <div>
          <div className="onboarding-highlight-title">The first scan couldn&rsquo;t finish</div>
          <div className="onboarding-highlight-note">{status.errorMessage ?? "We couldn’t complete the first scan. Retry when you’re ready."}</div>
        </div>
        <button className="onboarding-retry" type="button" onClick={() => void retryScan()} disabled={retrying}>{retrying ? "Retrying…" : "Retry scan"}</button>
      </div>
    );
  }

  return (
    <div className="onboarding-highlight tone-neutral">
      <div>
        <div className="onboarding-highlight-title">{status.scanLabel ?? "Finding qualified demand"}…</div>
        <div className="onboarding-highlight-note">This keeps running even if you leave this page. You can return anytime.</div>
      </div>
    </div>
  );
}
