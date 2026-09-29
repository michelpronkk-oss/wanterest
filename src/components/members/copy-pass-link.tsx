"use client";

import { useState } from "react";

/** Board 11/12 "Copy link": copies the canonical public URL already rendered on the page. */
export function CopyPassLink({ url, className }: { url: string; className?: string }) {
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
    <>
      <button type="button" className={className} onClick={() => void copy()} aria-live="polite">
        {state === "copied" ? "Link copied" : state === "failed" ? "Copy unavailable" : "Copy link"}
      </button>
    </>
  );
}
