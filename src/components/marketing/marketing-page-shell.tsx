import type { ReactNode } from "react";

import { MarketingFooter } from "./marketing-footer";
import type { AccessMode } from "@/server/modules/access";
import { SiteHeader } from "./site-header";

/** Shared chrome for every marketing page other than the homepage, which renders the same nav in its hero. */
export async function MarketingPageShell({ children, activeHref, accessMode }: { children: ReactNode; activeHref?: string; accessMode?: AccessMode }) {
  return (
    <div className="marketing-page">
      <SiteHeader activeHref={activeHref} accessMode={accessMode} />
      {children}
      <MarketingFooter />
    </div>
  );
}
