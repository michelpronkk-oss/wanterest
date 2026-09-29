import Link from "next/link";
import type { ReactNode } from "react";

import { SiteHeader } from "@/components/marketing/site-header";

/** Journey pages share the site header (the same one as every public page) and a compact legal footer. */
export function JourneyShell({ children }: { children: ReactNode }) {
  const year = new Date().getFullYear();
  return (
    <div className="marketing-page ea-shell">
      <SiteHeader />
      {children}
      <footer className="ea-shell-footer">
        <span>© {year} Wanterest</span>
        <nav aria-label="Legal"><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link><Link href="/cookies">Cookies</Link></nav>
      </footer>
    </div>
  );
}
