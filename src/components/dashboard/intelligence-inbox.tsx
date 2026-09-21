"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import type { InboxItem, InboxItemType } from "./inbox";

const SEEN_STORAGE_KEY = "wanterest.inbox.seen";
const TYPE_FILTERS: Array<{ key: "all" | InboxItemType; label: string }> = [
  { key: "all", label: "All" },
  { key: "signal", label: "Signals" },
  { key: "gap", label: "Gaps" },
  { key: "drift", label: "Drift" },
  { key: "action", label: "Actions" },
  { key: "experiment", label: "Experiments" },
];

function readSeenIds(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(SEEN_STORAGE_KEY);
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
  } catch {
    return new Set();
  }
}

function writeSeenIds(ids: Set<string>) {
  try {
    window.localStorage.setItem(SEEN_STORAGE_KEY, JSON.stringify([...ids]));
  } catch {
    // localStorage unavailable (private browsing, etc.) — read state just won't persist
  }
}

export function IntelligenceInbox({ open, onClose, items, onGoToNotificationPrefs }: { open: boolean; onClose: () => void; items: InboxItem[]; onGoToNotificationPrefs: () => void }) {
  const [seenIds, setSeenIds] = useState<Set<string>>(() => readSeenIds());
  const [typeFilter, setTypeFilter] = useState<"all" | InboxItemType>("all");
  const [typeDropdownOpen, setTypeDropdownOpen] = useState(false);
  const [highConfidenceOnly, setHighConfidenceOnly] = useState(false);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    if (open) document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  const filtered = useMemo(() => {
    return items.filter((item) => (typeFilter === "all" || item.type === typeFilter) && (!highConfidenceOnly || item.confidence >= 0.85));
  }, [items, typeFilter, highConfidenceOnly]);

  const unreadCount = items.filter((item) => !seenIds.has(item.id)).length;

  function markAllRead() {
    const next = new Set(seenIds);
    for (const item of items) next.add(item.id);
    setSeenIds(next);
    writeSeenIds(next);
  }

  if (!open) return null;

  return (
    <>
      <button className="ui-scrim" aria-label="Close Intelligence Inbox" onClick={onClose} />
      <div className="ui-drawer is-dark" role="dialog" aria-modal="true" aria-label="Intelligence Inbox">
        <div className="ui-drawer-header">
          <div>
            <p className="ui-drawer-title">Intelligence Inbox</p>
            <p style={{ margin: "4px 0 0", fontSize: 12.5, color: "#9c9c92" }}>Important changes across your market.</p>
          </div>
          <button className="ui-drawer-close" type="button" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="ui-drawer-body">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 12.5 }}>
            <span>{unreadCount} unread</span>
            <button className="inbox-footer-link" type="button" onClick={markAllRead} style={{ cursor: "pointer" }}>
              Mark all read
            </button>
          </div>
          <div className="inbox-filter-row">
            <button className="inbox-toggle" type="button" onClick={() => setTypeDropdownOpen((value) => !value)}>
              Type: {TYPE_FILTERS.find((filter) => filter.key === typeFilter)?.label} ▾
            </button>
            <button className="inbox-toggle" type="button" onClick={() => setHighConfidenceOnly((value) => !value)} aria-pressed={highConfidenceOnly}>
              <span className={`inbox-toggle-track${highConfidenceOnly ? " is-on" : ""}`}>
                <span className="inbox-toggle-thumb" />
              </span>
              High confidence only
            </button>
            {typeDropdownOpen ? (
              <div style={{ position: "absolute", top: "100%", left: 0, marginTop: 6, background: "#1a1a17", border: "1px solid rgba(255,255,255,0.09)", borderRadius: 10, padding: 6, zIndex: 1, minWidth: 140 }}>
                {TYPE_FILTERS.map((filter) => (
                  <button
                    key={filter.key}
                    type="button"
                    onClick={() => {
                      setTypeFilter(filter.key);
                      setTypeDropdownOpen(false);
                    }}
                    style={{ display: "block", width: "100%", textAlign: "left", padding: "6px 10px", borderRadius: 6, border: 0, background: filter.key === typeFilter ? "#26261f" : "transparent", color: "#f5f4ee", cursor: "pointer", fontSize: 12.5 }}
                  >
                    {filter.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          {filtered.length === 0 ? (
            <div style={{ padding: "40px 0", textAlign: "center", color: "#9c9c92", fontSize: 13 }}>
              <p style={{ margin: 0, fontWeight: 600, color: "#f5f4ee" }}>No important updates yet.</p>
              <p style={{ margin: "6px 0 0" }}>Wanterest will surface meaningful market changes here as new demand is found.</p>
            </div>
          ) : (
            <div>
              <p className="inbox-group-label">Today</p>
              {filtered.map((item) => (
                <div className="inbox-item" key={item.id}>
                  <div className="inbox-item-top">
                    {!seenIds.has(item.id) ? <span className="inbox-unread-dot" /> : null}
                    <span className="inbox-item-label">{item.label}</span>
                  </div>
                  <p className="inbox-item-headline">{item.headline}</p>
                  <p className="inbox-item-context">{item.context}</p>
                  <div className="inbox-item-footer">
                    <span>{item.meta}</span>
                    <Link href={item.cta.href} onClick={onClose}>
                      {item.cta.label} →
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="ui-drawer-footer">
          <button className="inbox-footer-link" type="button" style={{ cursor: "pointer" }} onClick={onGoToNotificationPrefs}>
            Notification preferences →
          </button>
        </div>
      </div>
    </>
  );
}
