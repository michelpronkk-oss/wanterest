import type { ReactNode } from "react";

import { MarketingFooter } from "./marketing-footer";
import { MarketingNav } from "./marketing-nav";

/** Shared chrome for every marketing page other than the homepage, which renders its own nav/footer directly. */
export function MarketingPageShell({ children, activeHref }: { children: ReactNode; activeHref?: string }) {
  return (
    <div className="marketing-page">
      <MarketingNav activeHref={activeHref} />
      {children}
      <MarketingFooter />
    </div>
  );
}
