import Link from "next/link";

import { LogoMark } from "@/components/dashboard/nav-icons";
import type { AccessMode } from "@/server/modules/access";
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

export function MarketingNav({ links = MARKETING_NAV_LINKS, activeHref, accessMode = "invite_only" }: { links?: NavLink[]; activeHref?: string; accessMode?: AccessMode }) {
  const primaryHref = accessMode === "open" ? APP_START_URL : `${APP_ORIGIN}/waitlist`;
  const primaryLabel = accessMode === "open" ? "Start free" : "Request access";
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
