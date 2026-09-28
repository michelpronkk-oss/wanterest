"use client";

import { useEffect, useState } from "react";

function record(publicSlug: string, eventType: "opened" | "shared", source: "page" | "x" | "linkedin" | "copy") {
  void fetch("/api/share-cards/event", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ publicSlug, eventType, source }),
    keepalive: true,
  });
}

export function ShareCardOpenTracker({ publicSlug }: { publicSlug: string }) {
  useEffect(() => { record(publicSlug, "opened", "page"); }, [publicSlug]);
  return null;
}

export function ShareCardPublicActions({ publicSlug, canonicalUrl, title }: { publicSlug: string; canonicalUrl: string; title: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(canonicalUrl);
      setCopied(true);
      record(publicSlug, "shared", "copy");
      window.setTimeout(() => setCopied(false), 2200);
    } catch {
      setCopied(false);
    }
  }
  const encodedUrl = encodeURIComponent(canonicalUrl);
  const encodedTitle = encodeURIComponent(title);
  return (
    <div className="share-card-public-actions" aria-label="Share this card">
      <button type="button" className="dashboard-button dashboard-button-secondary" onClick={() => void copy()}>{copied ? "Link copied" : "Copy link"}</button>
      <a className="dashboard-button dashboard-button-secondary" href={`https://twitter.com/intent/tweet?url=${encodedUrl}&text=${encodedTitle}`} target="_blank" rel="noreferrer" onClick={() => record(publicSlug, "shared", "x")}>Share on X</a>
      <a className="dashboard-button dashboard-button-secondary" href={`https://www.linkedin.com/sharing/share-offsite/?url=${encodedUrl}`} target="_blank" rel="noreferrer" onClick={() => record(publicSlug, "shared", "linkedin")}>LinkedIn</a>
    </div>
  );
}
