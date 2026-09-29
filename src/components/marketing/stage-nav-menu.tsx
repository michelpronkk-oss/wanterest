"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

type MenuLink = { label: string; href: string };

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
              <span aria-hidden="true">×</span>
            </button>
          </div>
          <nav className="marketing-stage-menu-links" aria-label="Menu pages">
            {links.map((link) => (
              <Link key={link.href} href={link.href} aria-current={link.href === activeHref ? "page" : undefined} onClick={() => closeMenu(true)}>
                {link.label}<span aria-hidden="true">↗</span>
              </Link>
            ))}
          </nav>
          <div className="marketing-stage-menu-footer">
            <a className="marketing-stage-menu-login" href={loginHref} onClick={() => closeMenu(true)}>Log in</a>
            <a className="marketing-stage-menu-cta" href={primary.href} onClick={() => closeMenu(true)}>
              {primary.label}<span aria-hidden="true">→</span>
            </a>
          </div>
        </div>
      </dialog>
    </div>
  );
}
