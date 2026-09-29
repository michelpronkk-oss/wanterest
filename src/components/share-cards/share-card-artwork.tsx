import type { CSSProperties, ReactNode } from "react";

import { APEX_COLORS, APEX_GEOMETRY, APEX_VIEW_BOX, WANTEREST_LOGO } from "@/shared/apex-artwork";
import { monogramTone } from "@/shared/member-presentation";
import {
  SHARE_CARD_DIMENSIONS,
  formatAdmitted,
  formatCohortSeat,
  formatEarlyAccessNumber,
  shareCardKicker,
  shareCardLine,
  type ShareCardFormat,
  type ShareCardVariantKey,
} from "@/shared/share-card-presentation";

/*
 * Board 15 "Social sharing cards" (docs/design/claude/originals/Wanterest Apex 2.0 Identity
 * System.dc.html), one composition for every variant and format. Everything is inline styles on
 * flex boxes so the same tree renders in the browser preview and in next/og (Satori), which
 * supports only flexbox and a CSS subset. Every value is injected; nothing is baked.
 * Departures from the board: the Wanterest wordmark is the all-ink W (brand update), and the
 * workspace tile shows the persisted monogram — company logo URLs are never fetched server-side.
 */

export type ShareCardArtworkData = {
  variant: ShareCardVariantKey;
  identityNumber: number | null;
  displayName: string | null;
  monogram?: string | null;
  admittedOn?: string | null;
};

export type ShareCardFonts = { display: string; heading: string; body: string };

/** Family names registered with ImageResponse (see share-card-image.tsx). */
export const SHARE_CARD_IMAGE_FONTS: ShareCardFonts = { display: "Archivo", heading: "Sora", body: "Inter" };
/** The site's next/font variables, for the in-page preview. */
export const SHARE_CARD_PAGE_FONTS: ShareCardFonts = {
  display: "var(--font-archivo), sans-serif",
  heading: "var(--font-sora), sans-serif",
  body: "var(--font-inter), sans-serif",
};

type Palette = { bg: string; fg: string; muted: string; rule: string; url: string; apexPeak?: string; apexKeystone?: string };

const PALETTES: Record<ShareCardVariantKey, Palette> = {
  FOUNDING_25: { bg: APEX_COLORS.ink, fg: APEX_COLORS.paper, muted: APEX_COLORS.mutedDark, rule: APEX_COLORS.hairDark, url: APEX_COLORS.mutedDark, apexPeak: APEX_COLORS.paper, apexKeystone: APEX_COLORS.keystone },
  EARLY_100: { bg: "#FFFFFF", fg: APEX_COLORS.ink, muted: APEX_COLORS.muted, rule: APEX_COLORS.hairStrong, url: APEX_COLORS.muted, apexPeak: APEX_COLORS.ink, apexKeystone: APEX_COLORS.ink },
  PRIORITY_ACCESS: { bg: APEX_COLORS.priorityBg, fg: APEX_COLORS.priorityFg, muted: APEX_COLORS.priorityFg, rule: "rgba(61,74,14,0.18)", url: "#6B7A2C" },
  EARLY_ACCESS: { bg: APEX_COLORS.ivory, fg: APEX_COLORS.ink, muted: APEX_COLORS.muted, rule: APEX_COLORS.hairStrong, url: APEX_COLORS.muted },
};

/** Board 15 type scale per format (px). Portrait for Priority/Early Access follows the square cut. */
const SCALE = {
  landscape: { pad: 72, kicker: 18, apex: 40, logo: 24, logoText: 20, tile: 64, tileRadius: 15, name: 30, admitted: 18, line: 26 },
  portrait: { pad: 88, kicker: 22, apex: 48, logo: 30, logoText: 25, tile: 76, tileRadius: 18, name: 36, admitted: 21, line: 30 },
  square: { pad: 88, kicker: 22, apex: 48, logo: 30, logoText: 25, tile: 76, tileRadius: 18, name: 36, admitted: 21, line: 30 },
} as const;

const COHORT_NUMERALS: Record<"FOUNDING_25" | "EARLY_100", Record<ShareCardFormat, { size: number; total: number; gap: number; line: number }>> = {
  FOUNDING_25: { landscape: { size: 300, total: 72, gap: 18, line: 0 }, portrait: { size: 400, total: 96, gap: 24, line: 24 }, square: { size: 340, total: 82, gap: 20, line: 22 } },
  EARLY_100: { landscape: { size: 240, total: 58, gap: 14, line: 0 }, portrait: { size: 320, total: 77, gap: 19, line: 24 }, square: { size: 270, total: 65, gap: 16, line: 22 } },
};

const STATUS_WORD: Record<"PRIORITY_ACCESS" | "EARLY_ACCESS", Record<ShareCardFormat, number>> = {
  PRIORITY_ACCESS: { landscape: 150, portrait: 210, square: 180 },
  EARLY_ACCESS: { landscape: 200, portrait: 280, square: 240 },
};

/** Satori needs px letter-spacing; the board specifies em. */
const tracking = (size: number, em: number) => `${Math.round(size * em * 100) / 100}px`;

function ApexMark({ size, peak, keystone }: { size: number; peak: string; keystone: string }) {
  return (
    <svg viewBox={APEX_VIEW_BOX} width={size} height={size} style={{ display: "flex", flexShrink: 0 }}>
      <polygon points={APEX_GEOMETRY.standard.peak} fill={peak} />
      <polygon points={APEX_GEOMETRY.standard.keystone} fill={keystone} />
    </svg>
  );
}

function Wordmark({ size, textSize, gap, color, fonts }: { size: number; textSize: number; gap: number; color: string; fonts: ShareCardFonts }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap }}>
      <svg viewBox={WANTEREST_LOGO.viewBox} width={size} height={size} style={{ display: "flex", flexShrink: 0 }}>
        <polyline points={WANTEREST_LOGO.polyline} fill="none" stroke={color} strokeWidth={WANTEREST_LOGO.strokeWidth} strokeLinejoin="miter" strokeLinecap="butt" />
      </svg>
      <span style={{ fontFamily: fonts.heading, fontWeight: 600, fontSize: textSize, letterSpacing: tracking(textSize, -0.01), color }}>wanterest</span>
    </div>
  );
}

const MONOGRAM_TILES = {
  ink: { background: APEX_COLORS.ink, color: APEX_COLORS.paper },
  ivory: { background: "#FFFFFF", color: APEX_COLORS.ink },
  neutral: { background: APEX_COLORS.sand, color: APEX_COLORS.secondary },
} as const;

function IdentityTile({ monogram, size, radius, dark, fonts }: { monogram: string | null; size: number; radius: number; dark: boolean; fonts: ShareCardFonts }) {
  const tone = monogram ? MONOGRAM_TILES[monogramTone(monogram)] : { background: "#EFEEE8", color: APEX_COLORS.muted };
  const ratio = !monogram ? 0 : monogram.length <= 1 ? 0.44 : monogram.length === 2 ? 0.36 : 0.28;
  return (
    <div style={{ width: size, height: size, borderRadius: radius, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: tone.background, border: `1px solid ${dark ? APEX_COLORS.hairDark : APEX_COLORS.hair}` }}>
      {monogram ? <span style={{ fontFamily: fonts.heading, fontWeight: 600, fontSize: Math.round(size * ratio), color: tone.color, letterSpacing: tracking(size * ratio, -0.02) }}>{monogram}</span> : null}
    </div>
  );
}

function Identity({ data, format, palette, fonts }: { data: ShareCardArtworkData; format: ShareCardFormat; palette: Palette; fonts: ShareCardFonts }) {
  const s = SCALE[format];
  const admitted = formatAdmitted(data.admittedOn ?? null);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
      <IdentityTile monogram={data.monogram ?? null} size={s.tile} radius={s.tileRadius} dark={data.variant === "FOUNDING_25"} fonts={fonts} />
      <div style={{ display: "flex", flexDirection: "column" }}>
        <span style={{ fontFamily: fonts.heading, fontWeight: 600, fontSize: s.name, letterSpacing: tracking(s.name, -0.01), color: palette.fg }}>{data.displayName ?? "Wanterest member"}</span>
        {admitted ? <span style={{ fontFamily: fonts.body, fontSize: s.admitted, color: palette.muted, marginTop: 4 }}>{admitted}</span> : null}
      </div>
    </div>
  );
}

function BigNumber({ data, format, palette, fonts }: { data: ShareCardArtworkData; format: ShareCardFormat; palette: Palette; fonts: ShareCardFonts }) {
  if (data.variant === "FOUNDING_25" || data.variant === "EARLY_100") {
    const n = COHORT_NUMERALS[data.variant][format];
    return (
      <div style={{ display: "flex", alignItems: "baseline", gap: n.gap }}>
        <span style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: n.size, lineHeight: 0.8, letterSpacing: tracking(n.size, -0.045), color: palette.fg }}>{formatCohortSeat(data.variant, data.identityNumber ?? 0)}</span>
        <span style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: n.total, letterSpacing: tracking(n.total, -0.02), color: palette.muted }}>{data.variant === "FOUNDING_25" ? "/25" : "/100"}</span>
      </div>
    );
  }
  const size = STATUS_WORD[data.variant][format];
  if (data.variant === "PRIORITY_ACCESS") {
    return <span style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: size, lineHeight: 0.86, letterSpacing: tracking(size, -0.045), color: palette.fg }}>Priority</span>;
  }
  const digits = (formatEarlyAccessNumber(data.identityNumber) ?? "#0000").slice(1);
  return (
    <div style={{ display: "flex", fontFamily: fonts.display, fontWeight: 800, fontSize: size, lineHeight: 0.8, letterSpacing: tracking(size, -0.045), color: palette.fg }}>
      <span style={{ color: palette.muted, fontWeight: 700 }}>#</span>
      <span>{digits}</span>
    </div>
  );
}

function Kicker({ data, format, palette, fonts }: { data: ShareCardArtworkData; format: ShareCardFormat; palette: Palette; fonts: ShareCardFonts }) {
  const s = SCALE[format];
  let mark: ReactNode = null;
  if (palette.apexPeak && palette.apexKeystone) mark = <ApexMark size={s.apex} peak={palette.apexPeak} keystone={palette.apexKeystone} />;
  else if (data.variant === "PRIORITY_ACCESS") mark = <span style={{ width: 14, height: 14, borderRadius: 7, background: palette.fg, display: "flex" }} />;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
      {mark}
      <span style={{ fontFamily: fonts.body, fontWeight: 700, fontSize: s.kicker, letterSpacing: tracking(s.kicker, 0.16), color: palette.fg }}>{shareCardKicker(data.variant)}</span>
    </div>
  );
}

export function ShareCardArtwork({ data, format = "landscape", fonts = SHARE_CARD_IMAGE_FONTS, footerUrl = "wanterest.com/members" }: { data: ShareCardArtworkData; format?: ShareCardFormat; fonts?: ShareCardFonts; footerUrl?: string }) {
  const palette = PALETTES[data.variant];
  const s = SCALE[format];
  const { width, height } = SHARE_CARD_DIMENSIONS[format];
  const cohort = data.variant === "FOUNDING_25" || data.variant === "EARLY_100";
  const frame: CSSProperties = { width, height, display: "flex", flexDirection: "column", justifyContent: "space-between", padding: s.pad, background: palette.bg, color: palette.fg, fontFamily: fonts.body };

  const top = (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <Kicker data={data} format={format} palette={palette} fonts={fonts} />
      {format === "landscape" ? <Wordmark size={s.logo} textSize={s.logoText} gap={10} color={palette.fg} fonts={fonts} /> : null}
    </div>
  );
  const line = shareCardLine(data.variant, data.identityNumber);

  if (format === "landscape") {
    if (cohort) {
      return (
        <div style={frame}>
          {top}
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 40 }}>
            <BigNumber data={data} format={format} palette={palette} fonts={fonts} />
            <div style={{ display: "flex", paddingBottom: 10 }}><Identity data={data} format={format} palette={palette} fonts={fonts} /></div>
          </div>
        </div>
      );
    }
    return (
      <div style={frame}>
        {top}
        <div style={{ display: "flex" }}><BigNumber data={data} format={format} palette={palette} fonts={fonts} /></div>
        <span style={{ fontFamily: fonts.body, fontSize: s.line, lineHeight: 1.35, maxWidth: 640, color: palette.fg }}>{line}</span>
      </div>
    );
  }

  const cohortLine = cohort ? COHORT_NUMERALS[data.variant as "FOUNDING_25" | "EARLY_100"][format].line : s.line;
  return (
    <div style={frame}>
      {top}
      <div style={{ display: "flex" }}><BigNumber data={data} format={format} palette={palette} fonts={fonts} /></div>
      <div style={{ display: "flex", flexDirection: "column", gap: 36 }}>
        <div style={{ display: "flex", height: 2, background: palette.rule }} />
        {cohort ? <Identity data={data} format={format} palette={palette} fonts={fonts} /> : null}
        {/* Satori rejects `undefined` style values, so the cohort and status lines are separate literals. */}
        {cohort
          ? <span style={{ fontFamily: fonts.body, fontSize: cohortLine, lineHeight: 1.4, color: palette.muted }}>{line}</span>
          : <span style={{ fontFamily: fonts.body, fontSize: cohortLine, lineHeight: 1.35, maxWidth: 640, color: palette.fg }}>{line}</span>}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <Wordmark size={s.logo} textSize={s.logoText} gap={13} color={palette.fg} fonts={fonts} />
          <span style={{ fontFamily: fonts.body, fontSize: 20, color: palette.url }}>{footerUrl}</span>
        </div>
      </div>
    </div>
  );
}
