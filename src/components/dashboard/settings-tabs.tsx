"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";

export type SettingsTabKey = "general" | "product" | "sources" | "plan" | "team";

const TABS: Array<{ key: SettingsTabKey; label: string }> = [
  { key: "general", label: "General" },
  { key: "product", label: "Product" },
  { key: "sources", label: "Sources" },
  { key: "plan", label: "Plan & Usage" },
  { key: "team", label: "Team" },
];

export function SettingsTabs({ sections }: { sections: Record<SettingsTabKey, React.ReactNode> }) {
  const searchParams = useSearchParams();
  const initial = (searchParams.get("tab") as SettingsTabKey | null) ?? "product";
  const [active, setActive] = useState<SettingsTabKey>(TABS.some((tab) => tab.key === initial) ? initial : "product");

  return (
    <div className="settings-layout">
      <nav className="settings-nav" aria-label="Settings sections">
        {TABS.map((tab) => (
          <button key={tab.key} type="button" className={active === tab.key ? "is-active" : ""} onClick={() => setActive(tab.key)} aria-current={active === tab.key ? "page" : undefined}>
            {tab.label}
          </button>
        ))}
      </nav>
      <div className="settings-section">{sections[active]}</div>
    </div>
  );
}
