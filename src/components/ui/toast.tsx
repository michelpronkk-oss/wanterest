"use client";

import { useEffect } from "react";

/** Small, self-dismissing notice. Fixed-position, so it renders correctly regardless of where it is mounted in the tree. */
export function Toast({ message, durationMs = 2500, onDone }: { message: string; durationMs?: number; onDone: () => void }) {
  useEffect(() => {
    const timer = window.setTimeout(onDone, durationMs);
    return () => window.clearTimeout(timer);
  }, [durationMs, onDone]);

  return (
    <div className="ui-toast" role="status">
      {message}
    </div>
  );
}
