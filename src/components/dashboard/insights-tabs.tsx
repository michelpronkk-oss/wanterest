"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  ["Overview", "/app/insights"],
  ["Demand Map", "/app/insights/map"],
  ["Demand Gap", "/app/insights/gap"],
  ["Demand Drift", "/app/insights/drift"],
] as const;

export function InsightsTabs() {
  const pathname = usePathname();
  return (
    <nav className="insights-tabs" aria-label="Insights sections">
      {TABS.map(([label, href]) => {
        const active = href === "/app/insights" ? pathname === href : pathname.startsWith(href);
        return (
          <Link key={href} href={href} className={`insights-tab${active ? " is-active" : ""}`} aria-current={active ? "page" : undefined}>
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
