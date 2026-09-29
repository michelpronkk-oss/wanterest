"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { triggerRescanAction, type RescanUpgradeDetails } from "@/app/app/actions";
import type { ProductDemandScanHandle } from "@/server/modules/operations/product-demand-scan.schemas";
import { InboxIcon, SearchIcon } from "./nav-icons";
import { ScanProgressModal } from "./scan-progress-modal";
import { IntelligenceInbox } from "./intelligence-inbox";
import type { InboxItem } from "./inbox";
import { CohortBadge } from "@/components/members/member-identity-slots";
import type { AdmittedCohort } from "@/shared/member-presentation";

type Props = {
  workspaceId: string;
  productId: string;
  productName: string;
  productDomain: string | null;
  userInitial: string;
  currentPlan: "free" | "pro" | "growth";
  inboxItems: InboxItem[];
  /** Private, server-authorized permanent cohort of the current workspace (Apex board 16 topbar). */
  cohortIdentity?: { cohort: AdmittedCohort; number: number } | null;
};

export function TopBar({ workspaceId, productId, productName, productDomain, userInitial, currentPlan, inboxItems, cohortIdentity }: Props) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [scanOpen, setScanOpen] = useState(false);
  const [scanHandle, setScanHandle] = useState<ProductDemandScanHandle | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanUpgrade, setScanUpgrade] = useState<RescanUpgradeDetails | null>(null);
  const [inboxOpen, setInboxOpen] = useState(false);

  async function handleRescan(allowOpenModal = false) {
    if (scanning || (scanOpen && !allowOpenModal)) return;
    setScanOpen(true);
    setScanError(null);
    setScanUpgrade(null);
    setScanHandle(null);
    setScanning(true);
    try {
      const result = await triggerRescanAction({ workspaceId, productId });
      if (!result.ok) {
        setScanError(result.error);
        setScanUpgrade(result.upgrade ?? null);
        return;
      }
      setScanHandle(result.handle);
      // One refresh publishes the new active job to the server-rendered
      // dashboard banner. Subsequent progress comes from its narrow poll.
      router.refresh();
    } catch {
      setScanError("We could not start the rescan. Please try again.");
    } finally {
      setScanning(false);
    }
  }

  function handleRetry() {
    setScanError(null);
    setScanUpgrade(null);
    void handleRescan(true);
  }

  function handleSearchSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = query.trim();
    router.push(trimmed ? `/app/signals?q=${encodeURIComponent(trimmed)}` : "/app/signals");
  }

  return (
    <div className="dashboard-topbar">
      <form className="dashboard-search" onSubmit={handleSearchSubmit} role="search">
        <SearchIcon />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search signals, themes, competitors..."
          aria-label="Search signals"
        />
      </form>
      <div className="dashboard-topbar-actions">
        <span className="dashboard-context-chip">
          <strong>{productName}</strong>
          {productDomain ? ` · ${productDomain}` : null}
        </span>
        <button className="dashboard-rescan" type="button" onClick={() => void handleRescan()} disabled={scanning || scanOpen}>
          <span className="dashboard-rescan-dot" aria-hidden="true" />
          Rescan
        </button>
        <button className="dashboard-icon-button" type="button" onClick={() => setInboxOpen(true)} aria-label="Open Intelligence Inbox">
          <InboxIcon />
          {inboxItems.length > 0 ? <span className="dashboard-icon-badge">{inboxItems.length}</span> : null}
        </button>
        {cohortIdentity ? <CohortBadge cohort={cohortIdentity.cohort} number={cohortIdentity.number} size="micro" className="dashboard-topbar-cohort" /> : null}
        <span className="dashboard-avatar" aria-hidden="true">{userInitial}</span>
      </div>

      <ScanProgressModal
        key={scanHandle?.jobRunId ?? "no-scan"}
        open={scanOpen}
        onClose={() => {
          setScanOpen(false);
          setScanError(null);
          setScanUpgrade(null);
        }}
        productName={productName}
        jobRunId={scanHandle?.jobRunId ?? null}
        idempotencyKey={scanHandle?.idempotencyKey ?? null}
        workspaceId={workspaceId}
        productId={productId}
        errorMessage={scanError}
        upgrade={scanUpgrade ? { ...scanUpgrade, workspaceId, currentPlan } : undefined}
        onRetry={handleRetry}
      />
      <IntelligenceInbox
        open={inboxOpen}
        onClose={() => setInboxOpen(false)}
        items={inboxItems}
        onGoToNotificationPrefs={() => {
          setInboxOpen(false);
          router.push("/app/settings?tab=general");
        }}
      />
    </div>
  );
}
