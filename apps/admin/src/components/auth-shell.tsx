import type { ReactNode } from "react";
import Link from "next/link";
import { LogoMark } from "@wanterest/brand/logo-mark";

export function AuthShell({ eyebrow, title, description, children, footer }: {
  eyebrow: string; title: string; description: string; children: ReactNode; footer?: ReactNode;
}) {
  return (
    <main className="auth-layout">
      <aside className="auth-aside" aria-label="Wanterest Admin">
        <Link className="wordmark" href="/login" aria-label="Wanterest Admin sign in"><span className="wordmark-mark"><LogoMark size={22} /></span><span className="wordmark-name">wanterest<span>ADMIN</span></span></Link>
        <div className="aside-copy"><span className="aside-kicker">A quieter view of what matters.</span><p>Insight, stewardship<br />and a little more clarity.</p><span className="aside-rule" /></div>
        <p className="aside-caption">PRIVATE CONTROL CENTER <span>·</span> EST. 2024</p>
      </aside>
      <section className="auth-main">
        <div className="auth-mobile-brand"><Link className="wordmark" href="/login" aria-label="Wanterest Admin sign in"><span className="wordmark-mark"><LogoMark size={20} /></span><span className="wordmark-name">wanterest<span>ADMIN</span></span></Link></div>
        <div className="auth-content"><header className="auth-heading"><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p className="auth-description">{description}</p></header>{children}{footer && <footer className="auth-footer">{footer}</footer>}</div>
        <p className="auth-main-caption">WANTEREST <span>·</span> PRIVATE ACCESS</p>
      </section>
    </main>
  );
}
