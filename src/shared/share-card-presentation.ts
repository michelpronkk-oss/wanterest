/**
 * Board 15 ("Wanterest Apex 2.0 Identity System.dc.html") copy and number formatting for share
 * cards. Pure and dependency-free so the private preview, the public page, the OG/download PNGs
 * and the OG metadata all present one card identically. Every value is injected; nothing baked.
 */

export type ShareCardVariantKey = "EARLY_ACCESS" | "PRIORITY_ACCESS" | "FOUNDING_25" | "EARLY_100";

export type ShareCardFormat = "landscape" | "portrait" | "square";

export const SHARE_CARD_DIMENSIONS: Record<ShareCardFormat, { width: number; height: number }> = {
  landscape: { width: 1200, height: 630 },
  portrait: { width: 1080, height: 1350 },
  square: { width: 1080, height: 1080 },
};

/** Early Access numbers read "#0184" (board 15). */
export function formatEarlyAccessNumber(value: number | null): string | null {
  return value ? `#${String(value).padStart(4, "0")}` : null;
}

/** Cohort seats keep their namespace width: Founding "07", Early 100 "042". */
export function formatCohortSeat(variant: "FOUNDING_25" | "EARLY_100", value: number): string {
  return String(value).padStart(variant === "FOUNDING_25" ? 2 : 3, "0");
}

/** "2026-03-14" → "Admitted March 2026" (UTC, never the viewer's timezone). */
export function formatAdmitted(admittedOn: string | null): string | null {
  if (!admittedOn || !/^\d{4}-\d{2}-\d{2}$/.test(admittedOn)) return null;
  const date = new Date(`${admittedOn}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  return `Admitted ${date.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })}`;
}

/** The small caps label in each card's top-left corner. */
export function shareCardKicker(variant: ShareCardVariantKey): string {
  switch (variant) {
    case "FOUNDING_25": return "FOUNDING MEMBER";
    case "EARLY_100": return "EARLY 100 MEMBER";
    case "PRIORITY_ACCESS": return "WANTEREST WAITLIST";
    default: return "EARLY ACCESS";
  }
}

/** The one line of supporting copy each card carries. */
export function shareCardLine(variant: ShareCardVariantKey, identityNumber: number | null): string {
  switch (variant) {
    case "FOUNDING_25": return "One of the first 25 workspaces on Wanterest.";
    case "EARLY_100": return "Among the first 125 workspaces on Wanterest.";
    case "PRIORITY_ACCESS": {
      const number = formatEarlyAccessNumber(identityNumber);
      return number ? `Early access ${number} · moved up the queue.` : "Moved up the Wanterest queue.";
    }
    default: return "On the list for Wanterest.";
  }
}

/** Title used for OG metadata, the public page heading and share intents. */
export function shareCardTitle(variant: ShareCardVariantKey, identityNumber: number | null): string {
  if (variant === "FOUNDING_25" && identityNumber) return `Founding Member ${formatCohortSeat(variant, identityNumber)}/25`;
  if (variant === "EARLY_100" && identityNumber) return `Early 100 Member ${formatCohortSeat(variant, identityNumber)}/100`;
  if (variant === "PRIORITY_ACCESS") return "Priority on the Wanterest waitlist";
  const number = formatEarlyAccessNumber(identityNumber);
  return number ? `Early Access ${number}` : "Early Access";
}

export function shareCardShareText(variant: ShareCardVariantKey, identityNumber: number | null): { ogTitle: string; ogDescription: string } {
  return {
    ogTitle: `${shareCardTitle(variant, identityNumber)} · Wanterest`,
    ogDescription: shareCardLine(variant, identityNumber),
  };
}
