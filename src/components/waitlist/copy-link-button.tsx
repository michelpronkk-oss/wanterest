"use client";

import { useState } from "react";

export function CopyLinkButton({ url }: { url: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setState("copied");
      window.setTimeout(() => setState("idle"), 2200);
    } catch {
      setState("failed");
    }
  }
  return (
    <div className="ea-copy-link">
      <code>{url}</code>
      <button type="button" className="dashboard-button dashboard-button-secondary" onClick={() => void copy()}>{state === "copied" ? "Link copied" : "Copy link"}</button>
      {state === "failed" ? <span className="ea-field-error">Copying isn&rsquo;t available in this browser — select the link above instead.</span> : null}
    </div>
  );
}
