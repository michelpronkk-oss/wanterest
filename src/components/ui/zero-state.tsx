import Link from "next/link";
import type { ReactNode } from "react";

type Cta = { label: string; href: string };

type Props = {
  eyebrow?: string;
  title: string;
  body: string;
  primaryCta?: Cta;
  secondaryCta?: Cta;
  note?: string;
  align?: "left" | "narrow";
  children?: ReactNode;
};

/**
 * The unboxed page-level "hero" for a zero state: eyebrow, editorial headline,
 * short supporting copy, and actions. Never wrapped in a card border — the
 * page-specific teaser rendered below it (in each page) provides the surface.
 */
export function ZeroState({ eyebrow, title, body, primaryCta, secondaryCta, note, align = "left", children }: Props) {
  return (
    <div className={`zero-hero${align === "narrow" ? " is-narrow" : ""}`}>
      {eyebrow ? <p className="dashboard-eyebrow">{eyebrow}</p> : null}
      <h2 className="zero-hero-title" style={eyebrow ? undefined : { marginTop: 0 }}>{title}</h2>
      <p className="zero-hero-body">{body}</p>

      {primaryCta || secondaryCta ? (
        <div className="zero-hero-actions">
          {primaryCta ? <Link className="dashboard-button dashboard-button-primary" href={primaryCta.href}>{primaryCta.label}</Link> : null}
          {secondaryCta ? <Link className="dashboard-button dashboard-button-secondary" href={secondaryCta.href}>{secondaryCta.label}</Link> : null}
          {note ? <span className="zero-hero-note">{note}</span> : null}
        </div>
      ) : null}

      {children}
    </div>
  );
}
