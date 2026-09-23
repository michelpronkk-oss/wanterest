"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useState } from "react";

export type SettingsTabKey = "general" | "product" | "sources" | "plan" | "billing" | "team";
type SettingsContentKey = Exclude<SettingsTabKey, "billing">;

const TABS: Array<{ key: SettingsTabKey; label: string }> = [
  { key: "general", label: "General" },
  { key: "product", label: "Product" },
  { key: "sources", label: "Sources" },
  { key: "plan", label: "Plan & Usage" },
  { key: "billing", label: "Billing" },
  { key: "team", label: "Team" },
];

export function SettingsTabs({ sections }: { sections: Record<SettingsContentKey, React.ReactNode> }) {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const billingActive = pathname.startsWith("/app/settings/billing");
  const initial = (searchParams.get("tab") as SettingsContentKey | null) ?? "product";
  const [active, setActive] = useState<SettingsContentKey>(["general", "product", "sources", "plan", "team"].includes(initial) ? initial : "product");

  return (
    <div className="settings-layout">
      <nav className="settings-nav" aria-label="Settings sections">
        {TABS.map((tab) => tab.key === "billing" ? (
          <Link key={tab.key} href="/app/settings/billing" className={billingActive ? "is-active" : ""} aria-current={billingActive ? "page" : undefined}>{tab.label}</Link>
        ) : (
          <button key={tab.key} type="button" className={!billingActive && active === tab.key ? "is-active" : ""} onClick={() => setActive(tab.key as SettingsContentKey)} aria-current={!billingActive && active === tab.key ? "page" : undefined}>
            {tab.label}
          </button>
        ))}
      </nav>
      <div className="settings-section">{billingActive ? null : sections[active]}</div>
    </div>
  );
}
