"use client";

import { useEffect, useRef, useState } from "react";

import { getScanProgressAction, type ScanProgressState } from "@/app/app/actions";
import { scanCoverageCopy, scanResultDestination, scanStatusLabel, scanSteps } from "./scan-progress.view-model";
import { scanResultEmptyBody } from "./scan-status.view-model";

type Props = {
  open: boolean;
  onClose: () => void;
  productName: string;
  jobRunId: string | null;
  idempotencyKey: string | null;
  workspaceId: string;
  productId: string;
  errorMessage?: string | null;
  onRetry?: () => void;
};

const POLL_INTERVAL_MS = 2500;

export function ScanProgressModal({ open, onClose, productName, jobRunId, idempotencyKey, workspaceId, productId, errorMessage, onRetry }: Props) {
  const [state, setState] = useState<ScanProgressState | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!open || !jobRunId || !idempotencyKey) return;

    let cancelled = false;
    async function poll() {
      try {
        const next = await getScanProgressAction({ workspaceId, productId, jobRunId, idempotencyKey });
        if (!cancelled) {
          setState(next);
          if (next && ["succeeded", "completed_with_warnings", "failed", "failed_terminal", "cancelled"].includes(next.status) && intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
          }
        }
      } catch {
        // transient poll failure — next tick will retry
      }
    }
    void poll();
    intervalRef.current = setInterval(() => void poll(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [open, jobRunId, idempotencyKey, workspaceId, productId]);

  if (!open) return null;

  const steps = scanSteps(state?.progress);
  const stage = state?.progress?.stage;
  const displayedError = errorMessage ?? state?.errorMessage;
  const failed = state?.status === "failed" || Boolean(errorMessage);
  const terminal = Boolean(state && ["succeeded", "completed_with_warnings", "failed", "failed_terminal", "cancelled"].includes(state.status));
  const signalCount = state?.result?.signals ?? 0;
  const resultPath = scanResultDestination(state?.result ?? null);

  return (
    <div className="ui-modal-scrim" role="presentation" onClick={onClose}>
      <div className="ui-modal" role="dialog" aria-modal="true" aria-label="Rescan progress" onClick={(event) => event.stopPropagation()}>
        <p className="scan-progress-title">Rescanning {productName}</p>
        <p className="scan-progress-subtitle">{scanStatusLabel(stage, idempotencyKey?.startsWith("manual-scan:") ?? false)}</p>
        <div>
          {steps.map((step) => (
            <div className="scan-progress-step" key={step.key}>
              <span className={`scan-progress-dot${step.done ? " is-done" : ""}${step.failed ? " is-failed" : ""}`}>{step.done ? "✓" : ""}</span>
              <span style={{ color: step.done ? "var(--color-ink)" : "var(--color-ink-faint)" }}>{step.label}</span>
            </div>
          ))}
        </div>
        {terminal && !failed && state?.result ? (
          <p className="scan-progress-summary">{scanCoverageCopy(state.result, stage === "partial_failure")}</p>
        ) : null}
        {terminal && !failed && state?.result && signalCount === 0 ? <p className="scan-progress-warning">{scanResultEmptyBody(state.result)}</p> : null}
        {displayedError ? <p className="scan-progress-warning">{displayedError}</p> : null}
        {resultPath ? (
          <button className="dashboard-button dashboard-button-primary" type="button" style={{ marginTop: 20 }} onClick={() => {
            window.location.assign(resultPath);
          }}>
            View results →
          </button>
        ) : failed && onRetry ? (
          <button className="dashboard-button dashboard-button-primary" type="button" style={{ marginTop: 20 }} onClick={onRetry}>
            Retry rescan
          </button>
        ) : terminal && !failed ? (
          <button className="dashboard-button dashboard-button-primary" type="button" style={{ marginTop: 20 }} onClick={onClose}>
            Close
          </button>
        ) : null}
        {!(terminal && !failed && !resultPath) ? (
          <button className="dashboard-button dashboard-button-secondary" type="button" style={{ marginTop: 20 }} onClick={onClose}>
            Close
          </button>
        ) : null}
      </div>
    </div>
  );
}
