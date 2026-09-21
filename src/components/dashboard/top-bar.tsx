"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { triggerRescanAction } from "@/app/app/actions";
import type { ProductDemandScanHandle } from "@/server/modules/operations/product-demand-scan.schemas";
import { InboxIcon, SearchIcon } from "./nav-icons";
import { ScanProgressModal } from "./scan-progress-modal";
import { IntelligenceInbox } from "./intelligence-inbox";
import type { InboxItem } from "./inbox";

type Props = {
  workspaceId: string;
  productId: string;
  productName: string;
  productDomain: string | null;
  userInitial: string;
  inboxItems: InboxItem[];
};

export function TopBar({ workspaceId, productId, productName, productDomain, userInitial, inboxItems }: Props) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [scanOpen, setScanOpen] = useState(false);
  const [scanHandle, setScanHandle] = useState<ProductDemandScanHandle | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [inboxOpen, setInboxOpen] = useState(false);

  async function handleRescan(allowOpenModal = false) {
    if (scanning || (scanOpen && !allowOpenModal)) return;
    setScanOpen(true);
    setScanError(null);
    setScanHandle(null);
    setScanning(true);
    try {
      const handle = await triggerRescanAction({ workspaceId, productId });
      setScanHandle(handle);
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
        <span className="dashboard-avatar" aria-hidden="true">{userInitial}</span>
      </div>

      <ScanProgressModal
        key={scanHandle?.jobRunId ?? "no-scan"}
        open={scanOpen}
        onClose={() => {
          setScanOpen(false);
          setScanError(null);
        }}
        productName={productName}
        jobRunId={scanHandle?.jobRunId ?? null}
        idempotencyKey={scanHandle?.idempotencyKey ?? null}
        workspaceId={workspaceId}
        productId={productId}
        errorMessage={scanError}
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
