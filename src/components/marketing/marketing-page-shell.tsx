import type { ReactNode } from "react";

import { MarketingFooter } from "./marketing-footer";
import { MarketingNav } from "./marketing-nav";
import { getProductAccessState } from "@/server/modules/access";

/** Shared chrome for every marketing page other than the homepage, which renders its own nav/footer directly. */
export async function MarketingPageShell({ children, activeHref }: { children: ReactNode; activeHref?: string }) {
  const access = await getProductAccessState();
  return (
    <div className="marketing-page">
      <MarketingNav activeHref={activeHref} accessMode={access.mode} />
      {children}
      <MarketingFooter />
    </div>
  );
}
