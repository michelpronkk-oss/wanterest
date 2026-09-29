import type { ReactNode } from "react";

import { MarketingFooter } from "./marketing-footer";
import { SiteHeader } from "./site-header";

/** Shared chrome for every marketing page other than the homepage, which renders the same nav in its hero. */
export function MarketingPageShell({ children, activeHref }: { children: ReactNode; activeHref?: string }) {
  return (
    <div className="marketing-page">
      <SiteHeader activeHref={activeHref} />
      {children}
      <MarketingFooter />
    </div>
  );
}
