import type { CSSProperties, ReactNode } from "react";

/**
 * Centred homepage section with the eyebrow / title / subtitle intro used by the
 * "Wanterest Qualification + Why.dc.html" design (Qualification, Why Wanterest, Daily value,
 * Comparison). `tone` picks the design's alternating stone backgrounds.
 */
export function MarketingBand({
  id,
  tone,
  eyebrow,
  title,
  subtitle,
  subtitleMaxWidth,
  compactFoot = false,
  children,
}: {
  id?: string;
  tone: "stone" | "soft";
  eyebrow: string;
  title: string;
  subtitle: ReactNode;
  subtitleMaxWidth: number;
  compactFoot?: boolean;
  children: ReactNode;
}) {
  const headingId = id ? `${id}-title` : undefined;
  return (
    <section
      id={id}
      aria-labelledby={headingId}
      className={`marketing-band is-${tone}${compactFoot ? " is-compact-foot" : ""}`}
    >
      <div className="marketing-band-inner">
        <p className="marketing-band-eyebrow">{eyebrow}</p>
        <h2 id={headingId} className="marketing-band-title">{title}</h2>
        <p className="marketing-band-subtitle" style={{ "--marketing-band-subtitle-max": `${subtitleMaxWidth}px` } as CSSProperties}>
          {subtitle}
        </p>
        {children}
      </div>
    </section>
  );
}

/**
 * Small rounded chip. Every tone except `tint` and `lime` sits on the stone track colour and
 * only changes the text: `note` (muted, regular), `muted`, `secondary` and `ink` (semibold).
 */
export function MarketingPill({
  tone = "note",
  size = "sm",
  children,
}: {
  tone?: "note" | "muted" | "secondary" | "ink" | "tint" | "lime";
  size?: "sm" | "md";
  children: ReactNode;
}) {
  return <span className={`marketing-pill is-${tone} is-${size}`}>{children}</span>;
}
