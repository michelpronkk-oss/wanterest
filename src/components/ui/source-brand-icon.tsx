import Image from "next/image";

const SOURCE_BRANDS = {
  reddit: { src: "/brands/reddit.png", label: "Reddit" },
  "hacker-news": { src: "/brands/hacker-news.png", label: "Hacker News" },
  bluesky: { src: "/brands/bluesky.png", label: "Bluesky" },
  github: { src: "/brands/github.png", label: "GitHub" },
  x: { src: "/brands/x.png", label: "X" },
} as const;

function sourceInitial(sourceKey: string): string {
  return sourceKey.trim().charAt(0).toUpperCase() || "?";
}

export function SourceBrandIcon({
  sourceKey,
  size = 20,
  className,
  label,
  decorative = false,
}: {
  sourceKey: string;
  size?: number;
  className?: string;
  label?: string;
  decorative?: boolean;
}) {
  const brand = SOURCE_BRANDS[sourceKey as keyof typeof SOURCE_BRANDS];
  const accessibleLabel = label ?? brand?.label ?? (sourceKey.trim() || "Source");
  const classes = [brand ? "source-brand-icon" : "source-brand-fallback", className].filter(Boolean).join(" ");

  if (!brand) {
    return (
      <span
        className={classes}
        style={{ width: size, height: size }}
        aria-label={decorative ? undefined : accessibleLabel}
        role={decorative ? undefined : "img"}
        title={decorative ? undefined : accessibleLabel}
      >
        {sourceInitial(sourceKey)}
      </span>
    );
  }

  return (
    <span className={classes} style={{ width: size, height: size }}>
      <Image src={brand.src} alt={decorative ? "" : accessibleLabel} width={size} height={size} />
    </span>
  );
}
