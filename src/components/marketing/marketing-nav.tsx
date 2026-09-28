import Link from "next/link";

import { LogoMark } from "@/components/dashboard/nav-icons";
import type { AccessMode } from "@/server/modules/access";
import { getHomepageAccessState, type HomepageAccessState } from "@/server/modules/access";
import { APP_ORIGIN } from "@/shared/config/site";
import { APP_LOGIN_URL, APP_START_URL } from "./links";
import { StageNavMenu } from "./stage-nav-menu";

export type NavLink = { label: string; href: string };

/** The one nav link set used on every marketing page, including the homepage. */
export const MARKETING_NAV_LINKS: NavLink[] = [
  { label: "Product", href: "/product" },
  { label: "Pricing", href: "/pricing" },
  { label: "About", href: "/about" },
  { label: "Contact", href: "/contact" },
];

export type NavPrimaryAction = { href: string; label: string };

/** The visitor's single state-aware action (Request access, View status, Open Wanterest, …). */
export function navPrimaryAction(state: HomepageAccessState): NavPrimaryAction {
  const href = state.primaryAction === "START_FREE"
    ? APP_START_URL
    : `${APP_ORIGIN}${state.primaryActionHref}`;
  const label = {
    REQUEST_ACCESS: "Request access",
    START_FREE: "Start free",
    CHECK_EMAIL: "Check your email",
    VIEW_STATUS: "View status",
    VIEW_PRIORITY_STATUS: "View Priority status",
    ACCEPT_INVITATION: "Accept invitation",
    OPEN_WANTEREST: "Open Wanterest",
  }[state.primaryAction];
  return { href, label };
}

export function MarketingNav({ links = MARKETING_NAV_LINKS, activeHref, accessMode = "invite_only", accessState }: { links?: NavLink[]; activeHref?: string; accessMode?: AccessMode; accessState?: HomepageAccessState }) {
  const primary = navPrimaryAction(accessState ?? getHomepageAccessState(accessMode));
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
          <a className="marketing-cta-nav" href={primary.href}>{primary.label}</a>
        </div>
      </div>
    </nav>
  );
}

/**
 * Homepage hero nav (Hero v2): lives inside the rounded hero stage instead of the sticky page
 * bar. Same links, same login URL and the same state-aware primary action as MarketingNav;
 * below 641px the links and actions move into StageNavMenu.
 */
export function StageNav({ accessState }: { accessState: HomepageAccessState }) {
  const primary = navPrimaryAction(accessState);
  return (
    <nav className="marketing-stage-nav" aria-label="Main">
      <Link href="/" className="marketing-stage-logo" aria-label="Wanterest home">
        <LogoMark size={21} />
        <span>wanterest</span>
      </Link>
      <div className="marketing-stage-links">
        {MARKETING_NAV_LINKS.map((link, index) => (
          <Link key={link.href} href={link.href} className={index === 0 ? "is-lead" : undefined}>{link.label}</Link>
        ))}
      </div>
      <div className="marketing-stage-actions">
        <a className="marketing-stage-login" href={APP_LOGIN_URL}>Log in</a>
        <a className="marketing-stage-cta" href={primary.href}>{primary.label}</a>
      </div>
      <StageNavMenu links={MARKETING_NAV_LINKS} loginHref={APP_LOGIN_URL} primary={primary} />
    </nav>
  );
}
