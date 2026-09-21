"use client";

import { useMemo, useState } from "react";

import type { ActionReadModel } from "@/server/modules/actions/action.service";
import { ActionCard } from "./action-card";
import { ActionDetailDrawer } from "./action-detail-drawer";

export function ActionList({ actions, workspaceId }: { actions: ActionReadModel[]; workspaceId: string }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const openItem = useMemo(() => actions.find((item) => item.action.id === openId) ?? null, [actions, openId]);

  return (
    <div className="action-list">
      {actions.map((item) => (
        <ActionCard key={item.action.id} item={item} onOpen={setOpenId} />
      ))}
      <ActionDetailDrawer item={openItem} workspaceId={workspaceId} open={openId !== null} onClose={() => setOpenId(null)} />
    </div>
  );
}
