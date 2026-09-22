"use client";

import { useEffect, useRef } from "react";

const FADE_DISTANCE_PX = 220;

/**
 * Decorative bottom-of-hero transition, mobile only (hidden by CSS at wider viewports).
 * Fades and lifts slightly as the visitor scrolls past it, then stays out of the way —
 * skipped entirely under prefers-reduced-motion so the wave just sits static instead.
 */
export function HeroWave() {
  const ref = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let ticking = false;
    const update = () => {
      const progress = Math.min(1, Math.max(0, window.scrollY / FADE_DISTANCE_PX));
      el.style.opacity = String(1 - progress);
      el.style.transform = `translateY(${progress * 18}px)`;
      ticking = false;
    };
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <svg
      ref={ref}
      className="marketing-hero-wave"
      viewBox="0 0 400 130"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M0,72 C110,110 290,26 400,60 L400,130 L0,130 Z" fill="var(--color-track)" />
      <path d="M0,92 C130,58 270,118 400,82 L400,130 L0,130 Z" fill="var(--color-accent)" opacity="0.08" />
    </svg>
  );
}
