"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { getScanProgressAction, triggerRescanAction } from "@/app/app/actions";
import { StatusBanner } from "@/components/ui/status-banner";

import type { ProductScanState } from "./scan-state";
import { dashboardScanStateFromProgress } from "./scan-status.view-model";
import { scanCoverageCopy } from "./scan-progress.view-model";

const DASHBOARD_SCAN_POLL_MS = 2500;
const COMPLETION_NOTICE_MS = 2800;

function StageProgress({ completed, total }: { completed: number; total: number }) {
  const completedCount = Math.max(0, Math.min(completed, total));
  return (
    <span className="dashboard-scan-stage-progress" aria-label={`${completedCount} of ${total} scan stages complete`}>
      <span className="dashboard-scan-stage-track" aria-hidden="true">
        {Array.from({ length: total }, (_, index) => <span className={index < completedCount ? "is-complete" : undefined} key={index} />)}
      </span>
      <span>{completedCount}/{total}</span>
    </span>
  );
}

type Props = {
  state: ProductScanState;
  workspaceId: string;
  productId: string;
  retryHref?: string;
};

export function ScanStatusBanner({ state, workspaceId, productId, retryHref = "/app/setup/scan" }: Props) {
  const router = useRouter();
  const [polledState, setPolledState] = useState<ProductScanState | null>(null);
  const currentState = polledState ?? state;
  const [showCompletionNotice, setShowCompletionNotice] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const wasRunningRef = useRef(state.kind === "running");
  const refreshedJobsRef = useRef(new Set<string>());

  // Reuses the exact same server action the top-right "Rescan" button and its
  // "Retry rescan" flow already call (triggerRescanAction), so an already-onboarded
  // product's stale/failed latest scan never routes into the onboarding setup wizard.
  // Once dispatched, the handle feeds the banner's own existing poll loop below —
  // no separate scan orchestration logic is introduced.
  async function handleDashboardRetry() {
    if (retrying) return;
    setRetrying(true);
    setRetryError(null);
    try {
      const result = await triggerRescanAction({ workspaceId, productId });
      if (!result.ok) {
        setRetryError(result.traceId ? `${result.error} (ref: ${result.traceId})` : result.error);
        return;
      }
      setPolledState(dashboardScanStateFromProgress({
        jobRunId: result.handle.jobRunId,
        idempotencyKey: result.handle.idempotencyKey,
        status: "pending",
        progress: null,
        errorMessage: null,
        result: null,
      }));
    } catch {
      setRetryError("We could not start the rescan. Please try again.");
    } finally {
      setRetrying(false);
    }
  }

  const activeJobRunId = currentState.kind === "running" ? currentState.jobRunId : null;
  const activeIdempotencyKey = currentState.kind === "running" ? currentState.idempotencyKey : null;

  useEffect(() => {
    if (!activeJobRunId || !activeIdempotencyKey) return;

    const jobRunId = activeJobRunId;
    const idempotencyKey = activeIdempotencyKey;
    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | null = null;

    const stop = () => {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
    };

    const poll = async () => {
      try {
        const next = await getScanProgressAction({ workspaceId, productId, jobRunId, idempotencyKey });
        if (cancelled || !next) return;

        const nextState = dashboardScanStateFromProgress({ jobRunId, idempotencyKey, ...next });
        setPolledState(nextState);
        if (nextState.kind !== "running") {
          stop();
          if (next.status === "succeeded" || next.status === "completed_with_warnings") {
            // A single terminal refresh lets the dashboard render newly-created
            // intelligence. It is deliberately not part of the polling loop.
            if (!refreshedJobsRef.current.has(jobRunId)) {
              refreshedJobsRef.current.add(jobRunId);
              router.refresh();
            }
          }
        }
      } catch {
        // Keep the last persisted state visible. The next narrow status poll
        // retries without refreshing the authenticated dashboard tree.
      }
    };

    const pollWhenVisible = () => {
      if (document.visibilityState === "visible") void poll();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") void poll();
    };

    pollWhenVisible();
    interval = setInterval(pollWhenVisible, DASHBOARD_SCAN_POLL_MS);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      cancelled = true;
      stop();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [activeIdempotencyKey, activeJobRunId, productId, router, workspaceId]);

  const isManual = currentState.kind !== "no_scan" && currentState.kind !== "failed" ? currentState.manual : false;

  useEffect(() => {
    if (currentState.kind === "running") {
      wasRunningRef.current = true;
      return;
    }

    const completedFirstScan = wasRunningRef.current && !isManual && (currentState.kind === "completed_with_signals" || currentState.kind === "completed_no_signals");
    wasRunningRef.current = false;
    if (!completedFirstScan) {
      setShowCompletionNotice(false);
      return;
    }

    setShowCompletionNotice(true);
    const hide = window.setTimeout(() => setShowCompletionNotice(false), COMPLETION_NOTICE_MS);
    return () => window.clearTimeout(hide);
  }, [currentState.kind, isManual]);

  if (showCompletionNotice) {
    return <StatusBanner tone="neutral">Your first scan is ready</StatusBanner>;
  }

  if (currentState.kind === "running") {
    return (
      <StatusBanner tone="running" pulse>
        <div className="dashboard-scan-status-content">
          <span>{currentState.label}&hellip;</span>
          <StageProgress completed={currentState.completedStages} total={currentState.totalStages} />
        </div>
      </StatusBanner>
    );
  }
  if (currentState.kind === "partial_failure") {
    return (
      <StatusBanner tone="warning">
        <div className="dashboard-scan-status-content">
          <span>{currentState.summary ? scanCoverageCopy(currentState.summary, true) : "The latest scan finished with limited source coverage."}</span>
          <button className="dashboard-scan-retry" type="button" onClick={() => void handleDashboardRetry()} disabled={retrying}>
            Run another scan
          </button>
        </div>
        {retryError ? <p className="dashboard-scan-retry-error" role="alert">{retryError}</p> : null}
      </StatusBanner>
    );
  }
  if (currentState.kind === "failed") {
    const { firstScan } = currentState;
    return (
      <StatusBanner tone="warning">
        <div className="dashboard-scan-status-content">
          <span>{firstScan ? "Your first scan couldn't finish." : "The latest scan couldn't finish."}</span>
          {firstScan ? (
            <Link className="dashboard-scan-retry" href={retryHref}>Retry</Link>
          ) : (
            <button className="dashboard-scan-retry" type="button" onClick={() => void handleDashboardRetry()} disabled={retrying}>
              Retry
            </button>
          )}
        </div>
        {retryError ? <p className="dashboard-scan-retry-error" role="alert">{retryError}</p> : null}
      </StatusBanner>
    );
  }
  return null;
}
