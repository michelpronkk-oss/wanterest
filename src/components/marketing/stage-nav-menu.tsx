"use client";

import Link from "next/link";
import { useEffect, useId, useState } from "react";

type MenuLink = { label: string; href: string };

/** Mobile (<641px) disclosure for the hero stage nav: the design's two-line menu button. */
export function StageNavMenu({ links, loginHref, primary }: { links: MenuLink[]; loginHref: string; primary: { href: string; label: string } }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="marketing-stage-menu">
      <button type="button" className="marketing-stage-menu-button" aria-expanded={open} aria-controls={panelId} aria-label={open ? "Close menu" : "Open menu"} onClick={() => setOpen((value) => !value)}>
        <span aria-hidden="true" />
        <span aria-hidden="true" />
      </button>
      <div id={panelId} className="marketing-stage-menu-panel" hidden={!open}>
        {links.map((link) => <Link key={link.href} href={link.href} onClick={() => setOpen(false)}>{link.label}</Link>)}
        <a href={loginHref}>Log in</a>
        <a className="marketing-stage-menu-cta" href={primary.href}>{primary.label}</a>
      </div>
    </div>
  );
}
