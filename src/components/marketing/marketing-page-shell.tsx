import type { ReactNode } from "react";

import { MarketingFooter } from "./marketing-footer";
import { MarketingNav } from "./marketing-nav";
import { getProductAccessState, type AccessMode } from "@/server/modules/access";

/** Shared chrome for every marketing page other than the homepage, which renders its own nav/footer directly. */
export async function MarketingPageShell({ children, activeHref, accessMode }: { children: ReactNode; activeHref?: string; accessMode?: AccessMode }) {
  const mode = accessMode ?? (await getProductAccessState()).mode;
  return (
    <div className="marketing-page">
      <MarketingNav activeHref={activeHref} accessMode={mode} />
      {children}
      <MarketingFooter />
    </div>
  );
}
