import Link from "next/link";
import { LogoMark } from "@wanterest/brand/logo-mark";
import { signOut } from "@admin/server/actions";
import { adminCan, type AdminContext } from "@admin/server/auth";

const navigation = [
  { href: "/", label: "Overview", icon: "overview", permission: "operations.read" },
  { href: "/early-access", label: "Early Access", icon: "people", permission: "lifecycle.read" },
  { href: "/operations", label: "Operations", icon: "activity", permission: "operations.read" },
  { href: "/search-console", label: "Search Console", icon: "search", permission: "analytics.read" },
  { href: "/publication-readiness", label: "Organic readiness", icon: "search", permission: "operations.summary.read" },
  { href: "/system-map", label: "System map", icon: "map", permission: "operations.summary.read" },
] as const;

function NavigationIcon({ name }: { name: (typeof navigation)[number]["icon"] }) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {name === "overview" && <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 10h18M10 10v11" /></>}
    {name === "people" && <><circle cx="9" cy="8" r="3" /><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6M18 15a5 5 0 0 1 3 5" /></>}
    {name === "activity" && <path d="M2 12h5l3-8 4 16 3-8h5" />}
    {name === "search" && <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></>}
    {name === "map" && <><rect x="9" y="2" width="6" height="6" rx="1" /><rect x="2" y="16" width="6" height="6" rx="1" /><rect x="16" y="16" width="6" height="6" rx="1" /><path d="M12 8v4M5 16v-4h14v4" /></>}
  </svg>;
}

function NavigationLinks({ context, active }: { context: AdminContext; active: string }) {
  return navigation.filter((item) => adminCan(context, item.permission)).map((item) => (
    <Link key={item.href} className={`nav-item${active === item.href ? " active" : ""}`} href={item.href} aria-current={active === item.href ? "page" : undefined}>
      <span className="nav-icon"><NavigationIcon name={item.icon} /></span>{item.label}
    </Link>
  ));
}

export function ConsoleShell({ context, active, children }: {
  context: AdminContext;
  active: (typeof navigation)[number]["href"];
  children: React.ReactNode;
}) {
  const label = navigation.find((item) => item.href === active)?.label ?? "Overview";
  return (
    <div className="admin-shell">
      <a className="skip-link" href="#admin-content">Skip to content</a>
      <aside className="sidebar">
        <Link className="brand" href="/" aria-label="Wanterest Admin home">
          <span className="brand-mark"><LogoMark size={26} /></span>
          <span>wanterest<span className="brand-sub">ADMIN</span></span>
        </Link>
        <p className="nav-section">CONTROL CENTER</p>
        <nav className="desktop-navigation" aria-label="Admin navigation">
          <NavigationLinks context={context} active={active} />
        </nav>
        <details className="mobile-navigation">
          <summary><span>Navigate</span><strong>{label}</strong><span className="menu-chevron" aria-hidden="true">⌄</span></summary>
          <nav aria-label="Mobile Admin navigation"><NavigationLinks context={context} active={active} /></nav>
        </details>
        <div className="sidebar-footer"><span className="env-label">READ-ONLY WORKSPACE</span><p>A clear view.<br />A considered next move.</p><span className="sidebar-private">Wanterest · Private console</span></div>
      </aside>
      <section className="main-column">
        <header className="topbar">
          <div className="crumb">Control center <span>/</span> <strong>{label}</strong></div>
          <div className="user-menu"><span className="user-role">{context.roleLabel}<small>Private access</small></span><form action={signOut}><button className="signout-button" type="submit">Sign out <span aria-hidden="true">↗</span></button></form></div>
        </header>
        <main className="content" id="admin-content" tabIndex={-1}>{children}</main>
      </section>
    </div>
  );
}

export function PageHeading({ eyebrow, title, detail, aside }: { eyebrow: string; title: string; detail: string; aside?: React.ReactNode }) {
  return <div className="page-heading"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p className="lede">{detail}</p></div>{aside}</div>;
}

export function DataState({ state, detail }: { state: "unavailable" | "stale" | "empty"; detail: string }) {
  return <div className={`data-state ${state}`} role="status"><span className="data-state-mark" aria-hidden="true">{state === "empty" ? "—" : state === "stale" ? "◷" : "○"}</span><p><strong>{state === "empty" ? "No records in this period" : state === "stale" ? "Last observation is stale" : "Source unavailable"}</strong><span>{detail}</span></p></div>;
}

export function SourceStamp({ source, range, refreshedAt }: { source: string; range: string; refreshedAt: string | null }) {
  const refreshLabel = refreshedAt ? `Refreshed ${new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(refreshedAt))} UTC` : "Refresh time unavailable";
  return <p className="source-stamp"><span>{source}</span><span>{range}</span><time>{refreshLabel}</time></p>;
}
