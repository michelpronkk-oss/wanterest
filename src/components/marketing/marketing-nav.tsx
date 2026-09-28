import Link from "next/link";

import { LogoMark } from "@/components/dashboard/nav-icons";
import type { AccessMode } from "@/server/modules/access";
import { getHomepageAccessState, type HomepageAccessState } from "@/server/modules/access";
import { APP_ORIGIN } from "@/shared/config/site";
import { APP_LOGIN_URL, APP_START_URL } from "./links";

type NavLink = { label: string; href: string };

/** The one nav link set used on every marketing page, including the homepage. */
export const MARKETING_NAV_LINKS: NavLink[] = [
  { label: "Product", href: "/product" },
  { label: "Pricing", href: "/pricing" },
  { label: "About", href: "/about" },
  { label: "Contact", href: "/contact" },
];

export function MarketingNav({ links = MARKETING_NAV_LINKS, activeHref, accessMode = "invite_only", accessState }: { links?: NavLink[]; activeHref?: string; accessMode?: AccessMode; accessState?: HomepageAccessState }) {
  const state = accessState ?? getHomepageAccessState(accessMode);
  const primaryHref = state.primaryAction === "START_FREE"
    ? APP_START_URL
    : `${APP_ORIGIN}${state.primaryActionHref}`;
  const primaryLabel = {
    REQUEST_ACCESS: "Request access",
    START_FREE: "Start free",
    CHECK_EMAIL: "Check your email",
    VIEW_STATUS: "View status",
    VIEW_PRIORITY_STATUS: "View Priority status",
    ACCEPT_INVITATION: "Accept invitation",
    OPEN_WANTEREST: "Open Wanterest",
  }[state.primaryAction];
  return (
    <nav className="marketing-nav">
      <div className="marketing-nav-inner">
        <Link href="/" className="marketing-logo">
          <LogoMark size={20} />
          <span className="marketing-logo-text">wanterest</span>
        </Link>
        <div className="marketing-nav-links">
          {links.map((link) => (
            <Link key={link.href} href={link.href} className={link.href === activeHref ? "is-active" : undefined}>
              {link.label}
            </Link>
          ))}
        </div>
        <div className="marketing-nav-actions">
          <a className="marketing-nav-signin" href={APP_LOGIN_URL}>Log in</a>
          <a className="marketing-cta-nav" href={primaryHref}>{primaryLabel}</a>
        </div>
      </div>
    </nav>
  );
}
