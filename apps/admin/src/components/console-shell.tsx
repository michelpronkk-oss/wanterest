import Link from "next/link";
import { LogoMark } from "@wanterest/brand/logo-mark";
import { signOut } from "@admin/server/actions";
import { adminCan, type AdminContext } from "@admin/server/auth";

const navigation = [
  { href: "/", label: "Overview", icon: "◫", permission: "operations.read" },
  { href: "/early-access", label: "Early Access", icon: "◎", permission: "lifecycle.read" },
  { href: "/operations", label: "Operations", icon: "↗", permission: "operations.read" },
  { href: "/search-console", label: "Search Console", icon: "⌕", permission: "analytics.read" },
  { href: "/system-map", label: "System map", icon: "⌘", permission: "operations.summary.read" },
] as const;

export function ConsoleShell({ context, active, children }: {
  context: AdminContext;
  active: (typeof navigation)[number]["href"];
  children: React.ReactNode;
}) {
  const label = navigation.find((item) => item.href === active)?.label ?? "Overview";
  return (
    <main className="admin-shell">
      <aside className="sidebar">
        <Link className="brand" href="/" aria-label="Wanterest Admin home">
          <span className="brand-mark"><LogoMark size={19} /></span>
          <span>wanterest<span className="brand-sub">ADMIN</span></span>
        </Link>
        <nav aria-label="Admin navigation">
          {navigation.filter((item) => adminCan(context, item.permission)).map((item) => (
            <Link key={item.href} className={`nav-item${active === item.href ? " active" : ""}`} href={item.href} aria-current={active === item.href ? "page" : undefined}>
              <span className="nav-icon" aria-hidden="true">{item.icon}</span>{item.label}
            </Link>
          ))}
        </nav>
        <div className="sidebar-footer"><span className="status-dot" />Private console <span className="env-label">READ ONLY</span></div>
      </aside>
      <section className="main-column">
        <header className="topbar">
          <div className="crumb">Control center <span>/</span> {label}</div>
          <div className="user-menu"><span className="user-role">{context.roleLabel}</span><span className="avatar">{context.initials}</span><form action={signOut}><button className="signout-button" type="submit">Sign out</button></form></div>
        </header>
        <div className="content">{children}</div>
      </section>
    </main>
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
