import Link from "next/link";

import { LogoMark } from "@/components/dashboard/nav-icons";
import { X_PROFILE_URL } from "@/shared/config/site";

type FooterLink = { label: string; href: string; external?: boolean };
type FooterGroup = { heading: string; links: FooterLink[] };

const FOOTER_GROUPS: FooterGroup[] = [
  {
    heading: "Product",
    links: [
      { label: "Product", href: "/product" },
      { label: "Pricing", href: "/pricing" },
    ],
  },
  {
    heading: "Company",
    links: [
      { label: "About", href: "/about" },
      { label: "Contact", href: "/contact" },
      { label: "X", href: X_PROFILE_URL, external: true },
    ],
  },
  {
    heading: "Legal",
    links: [
      { label: "Privacy", href: "/privacy" },
      { label: "Terms", href: "/terms" },
      { label: "Cookies", href: "/cookies" },
    ],
  },
];

export function MarketingFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="marketing-footer">
      <div className="marketing-footer-inner">
        <div className="marketing-footer-top">
          <div className="marketing-footer-brand">
            <Link href="/" className="marketing-logo">
              <LogoMark size={18} />
              <span className="marketing-logo-text">wanterest</span>
            </Link>
            <p className="marketing-footer-tagline">Find real demand. Build what matters.</p>
          </div>
          <div className="marketing-footer-groups">
            {FOOTER_GROUPS.map((group) => (
              <div className="marketing-footer-group" key={group.heading}>
                <p className="marketing-footer-group-heading">{group.heading}</p>
                <ul className="marketing-footer-group-links">
                  {group.links.map((link) => (
                    <li key={link.label}>
                      {link.external ? (
                        <a href={link.href} target="_blank" rel="noopener noreferrer">
                          {link.label}
                        </a>
                      ) : (
                        <Link href={link.href}>{link.label}</Link>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
        <div className="marketing-footer-bottom">
          <span>© {year} Wanterest</span>
          <span>All rights reserved.</span>
        </div>
      </div>
    </footer>
  );
}
