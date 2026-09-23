"use client";

import { useEffect, useRef, useState } from "react";

const REVEAL_DURATION_MS = 900;
const TRANSITION_DURATION_MS = 500;

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Counts up from 0 the first time it scrolls into view, then animates up or down
 * between values on every later change (e.g. the pricing monthly/annual toggle).
 * Falls back to an instant jump under prefers-reduced-motion.
 */
export function AnimatedNumber({ value, className }: { value: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [display, setDisplay] = useState(0);
  const revealedRef = useRef(false);
  const displayedValueRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  function animateTo(target: number, duration: number) {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (prefersReducedMotion()) {
      setDisplay(target);
      displayedValueRef.current = target;
      return;
    }
    const from = displayedValueRef.current;
    if (from === target) return;
    const start = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = easeOutCubic(progress);
      const current = Math.round(from + (target - from) * eased);
      setDisplay(current);
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        displayedValueRef.current = target;
      }
    };
    rafRef.current = requestAnimationFrame(tick);
  }

  // Reveal-triggered count-up from 0, once, the first time this number scrolls into view.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (revealedRef.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && !revealedRef.current) {
            revealedRef.current = true;
            animateTo(value, REVEAL_DURATION_MS);
            observer.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.3 },
    );
    observer.observe(el);
    return () => observer.disconnect();
    // Only re-runs to set up the observer once; the reveal target value is read live via closure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Value-change-triggered count up/down (e.g. switching Monthly/Annual), but only
  // once the initial scroll-reveal has already happened — otherwise this would race
  // the reveal animation on first mount.
  useEffect(() => {
    if (!revealedRef.current) return;
    animateTo(value, TRANSITION_DURATION_MS);
  }, [value]);

  return (
    <span ref={ref} className={className}>
      {display}
    </span>
  );
}
