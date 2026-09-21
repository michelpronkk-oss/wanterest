"use client";

import { useMemo, useState } from "react";

import type { SignalReadModel } from "@/server/modules/intelligence";
import { SignalCard } from "./signal-card";
import { SignalDetailDrawer } from "./signal-detail-drawer";

export function SignalList({ signals, workspaceId, showNote = false }: { signals: SignalReadModel[]; workspaceId: string; showNote?: boolean }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const openSignal = useMemo(() => signals.find((signal) => signal.signalId === openId) ?? null, [signals, openId]);

  return (
    <div className="signal-list" aria-label="Signals">
      {signals.map((signal) => (
        <SignalCard key={signal.signalId} signal={signal} workspaceId={workspaceId} onOpen={setOpenId} showNote={showNote} />
      ))}
      <SignalDetailDrawer signal={openSignal} open={openId !== null} onClose={() => setOpenId(null)} />
    </div>
  );
}
