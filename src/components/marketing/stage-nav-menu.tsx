"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

type MenuLink = { label: string; href: string };

// Drawn icons, not text glyphs: iOS renders "↗" as a colour emoji.
function ArrowIcon({ direction }: { direction: "up-right" | "right" }) {
  return (
    <svg className="marketing-stage-menu-arrow" viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {direction === "up-right" ? <path d="M6 14 14 6M7.5 6H14v6.5" /> : <path d="M4 10h12M11 5l5 5-5 5" />}
    </svg>
  );
}

/** Accessible full-screen navigation shared by the Hero v2 and standalone marketing header. */
export function StageNavMenu({ links, loginHref, primary, brand, activeHref }: {
  links: MenuLink[];
  loginHref: string;
  primary: { href: string; label: string };
  brand: ReactNode;
  activeHref?: string;
}) {
  const panelId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closingRef = useRef<Animation | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;

    const body = document.body;
    const scrollY = window.scrollY;
    const previous = {
      position: body.style.position,
      top: body.style.top,
      width: body.style.width,
      overflow: body.style.overflow,
    };

    // A fixed body prevents background scrolling in mobile Safari while the native modal is open.
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.width = "100%";
    body.style.overflow = "hidden";

    const desktop = window.matchMedia("(min-width: 861px)");
    const closeOnDesktop = () => {
      if (desktop.matches) {
        closingRef.current?.cancel();
        dialogRef.current?.close();
      }
    };
    desktop.addEventListener("change", closeOnDesktop);

    return () => {
      desktop.removeEventListener("change", closeOnDesktop);
      closingRef.current?.cancel();
      closingRef.current = null;
      Object.assign(body.style, previous);
      window.scrollTo(0, scrollY);
    };
  }, [open]);

  function openMenu() {
    const dialog = dialogRef.current;
    if (!dialog || dialog.open) return;
    dialog.showModal();
    // showModal() focuses the first link (the brand), which iOS rings on touch. Focus the panel
    // itself instead; Tab still reaches every control and keyboard focus rings stay intact.
    dialog.focus();
    setOpen(true);
  }

  function closeMenu(immediate = false) {
    const dialog = dialogRef.current;
    if (!dialog?.open) return;
    if (immediate || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      closingRef.current?.cancel();
      dialog.close();
      return;
    }
    if (closingRef.current) return;

    const animation = dialog.animate([
      { opacity: 1, transform: "translateY(0)" },
      { opacity: 0, transform: "translateY(-20px)" },
    ], { duration: 200, easing: "ease-in", fill: "forwards" });
    closingRef.current = animation;
    void animation.finished.then(() => {
      dialog.close();
      animation.cancel();
      closingRef.current = null;
    }, () => {
      // Navigation, breakpoint changes and unmounts cancel the close animation.
    });
  }

  return (
    <div className="marketing-stage-menu">
      <button
        type="button"
        className="marketing-stage-menu-button"
        aria-label="Open menu"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={openMenu}
      >
        <span aria-hidden="true" />
        <span aria-hidden="true" />
      </button>
      {/* The native modal top layer escapes the rounded hero's overflow and makes the page inert. */}
      <dialog
        ref={dialogRef}
        id={panelId}
        className="marketing-stage-menu-panel"
        aria-label="Main menu"
        tabIndex={-1}
        onCancel={(event) => {
          event.preventDefault();
          closeMenu();
        }}
        onClose={() => setOpen(false)}
        onClick={(event) => {
          if (event.target === event.currentTarget) closeMenu();
        }}
      >
        <div className="marketing-stage-menu-inner">
          <div className="marketing-stage-menu-header">
            <Link href="/" className="marketing-stage-menu-brand" aria-label="Wanterest home" onClick={() => closeMenu(true)}>
              {brand}
            </Link>
            <button type="button" className="marketing-stage-menu-close" aria-label="Close menu" onClick={() => closeMenu()}>
              <svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M5 5l10 10M15 5 5 15" /></svg>
            </button>
          </div>
          <nav className="marketing-stage-menu-links" aria-label="Menu pages">
            {links.map((link) => (
              <Link key={link.href} href={link.href} aria-current={link.href === activeHref ? "page" : undefined} onClick={() => closeMenu(true)}>
                {link.label}<ArrowIcon direction="up-right" />
              </Link>
            ))}
          </nav>
          <div className="marketing-stage-menu-footer">
            <a className="marketing-stage-menu-login" href={loginHref} onClick={() => closeMenu(true)}>Log in</a>
            <a className="marketing-stage-menu-cta" href={primary.href} onClick={() => closeMenu(true)}>
              {primary.label}<ArrowIcon direction="right" />
            </a>
          </div>
        </div>
      </dialog>
    </div>
  );
}
