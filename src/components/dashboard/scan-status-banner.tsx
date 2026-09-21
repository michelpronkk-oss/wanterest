"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { getScanProgressAction } from "@/app/app/actions";
import { StatusBanner } from "@/components/ui/status-banner";

import type { ProductScanState } from "./scan-state";
import { dashboardScanStateFromProgress } from "./scan-status.view-model";

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
  const wasRunningRef = useRef(state.kind === "running");
  const refreshedJobsRef = useRef(new Set<string>());

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

    void poll();
    interval = setInterval(() => void poll(), DASHBOARD_SCAN_POLL_MS);
    return () => {
      cancelled = true;
      stop();
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
    return <StatusBanner tone="warning">Scan completed with limited source coverage</StatusBanner>;
  }
  if (currentState.kind === "failed") {
    return (
      <StatusBanner tone="warning">
        <div className="dashboard-scan-status-content">
          <span>Your first scan couldn&apos;t finish</span>
          <Link className="dashboard-scan-retry" href={retryHref}>Retry</Link>
        </div>
      </StatusBanner>
    );
  }
  return null;
}
