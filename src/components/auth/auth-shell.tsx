import type { ReactNode } from "react";

import { LogoMark } from "@/components/dashboard/nav-icons";

/**
 * Shared two-panel layout for /login, /signup, and /forgot-password: a 40% dark brand
 * panel (hidden below 860px) and a 60% light panel centering the form card. `children`
 * renders inside the card, after the mobile-only logo header.
 */
export function AuthShell({ eyebrow, children }: { eyebrow: string; children: ReactNode }) {
  return (
    <div className="auth-shell">
      <div className="auth-brand">
        <div className="auth-brand-grid" aria-hidden="true" />
        <div className="auth-brand-glow" aria-hidden="true" />
        <div className="auth-brand-glow-2" aria-hidden="true" />

        <div className="auth-brand-top">
          <LogoMark size={20} />
          <span className="auth-brand-wordmark">wanterest</span>
        </div>

        <div className="auth-brand-copy">
          <div className="auth-brand-eyebrow">{eyebrow}</div>
          <div className="auth-brand-headline">The demand already exists.</div>
          <div className="auth-brand-sub">Wanterest just finds it.</div>
          <div className="auth-brand-proof">
            <span>REAL CONVERSATIONS</span>
            <span>QUALIFIED INTENT</span>
          </div>
        </div>

        <div className="auth-brand-spacer" aria-hidden="true" />
      </div>

      <div className="auth-panel">
        <div className="auth-card">
          <div className="auth-mobile-header">
            <LogoMark size={20} />
            <span className="auth-brand-wordmark">wanterest</span>
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
