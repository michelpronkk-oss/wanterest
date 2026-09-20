"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  ["Overview", "/app"],
  ["Signals", "/app/signals"],
  ["Demand", "/app/demand"],
  ["Map", "/app/map"],
  ["Gap", "/app/gap"],
  ["Drift", "/app/drift"],
  ["Actions", "/app/actions"],
  ["Experiments", "/app/experiments"],
  ["Settings", "/app/settings"],
] as const;

export function DashboardNav() {
  const pathname = usePathname();

  return (
    <nav className="dashboard-nav" aria-label="Primary navigation">
      {links.map(([label, href]) => {
        const active = href === "/app" ? pathname === href : pathname.startsWith(href);
        return (
          <Link className={active ? "dashboard-nav-link is-active" : "dashboard-nav-link"} href={href} key={href} aria-current={active ? "page" : undefined}>
            <span className="dashboard-nav-dot" aria-hidden="true" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
