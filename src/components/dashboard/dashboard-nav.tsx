"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { ActionsIcon, ExperimentsIcon, HomeIcon, InsightsIcon, SavedIcon, SettingsIcon, SignalsIcon } from "./nav-icons";

const links = [
  ["Home", "/app", HomeIcon],
  ["Signals", "/app/signals", SignalsIcon],
  ["Saved", "/app/saved", SavedIcon],
  ["Insights", "/app/insights", InsightsIcon],
  ["Actions", "/app/actions", ActionsIcon],
  ["Experiments", "/app/experiments", ExperimentsIcon],
  ["Settings", "/app/settings", SettingsIcon],
] as const;

export function DashboardNav() {
  const pathname = usePathname();

  return (
    <nav className="dashboard-nav" aria-label="Primary navigation">
      {links.map(([label, href, Icon]) => {
        const active = href === "/app" ? pathname === href : pathname.startsWith(href);
        const color = active ? "var(--color-ink)" : "var(--color-ink-secondary)";
        return (
          <Link className={active ? "dashboard-nav-link is-active" : "dashboard-nav-link"} href={href} key={href} aria-current={active ? "page" : undefined}>
            <Icon color={color} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
