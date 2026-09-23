"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { triggerRescanAction } from "@/app/app/actions";

type Props = {
  workspaceId: string;
  productId: string;
  label: string;
};

/**
 * Reuses the same triggerRescanAction the top-right Rescan button already calls.
 * Used anywhere an empty state previously offered a "try again" / "run another
 * scan" link into the onboarding setup wizard (/app/setup/scan) for a product
 * that has already completed a scan — that route is only correct when a scan has
 * genuinely never finished yet.
 */
export function RescanRetryLink({ workspaceId, productId, label }: Props) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const result = await triggerRescanAction({ workspaceId, productId });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    } catch {
      setError("We could not start the rescan. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="rescan-retry-link">
      <button type="button" className="dashboard-button dashboard-button-primary" onClick={() => void handleClick()} disabled={pending}>
        {pending ? "Starting…" : label}
      </button>
      {error ? <p className="dashboard-scan-retry-error" role="alert">{error}</p> : null}
    </div>
  );
}
