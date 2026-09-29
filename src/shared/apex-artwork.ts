/**
 * Apex 2.0 identity geometry, extracted verbatim from the approved source
 * `docs/design/claude/originals/Wanterest Apex 2.0 Identity System.dc.html`
 * (boards 01 "C · Keystone — selected", 02 and 03). See
 * `docs/design/claude/apex-2/manifest.md` for the source-to-asset mapping.
 *
 * Pure data and string builders only: no React, no DOM, no member data. The same
 * values feed the React artwork leaves, the server-rendered admission HTML, the
 * static files under `public/identity/apex-2/` and, later, the separate 13B
 * share-card renderer (plain polygons; no masks, filters, gradients or text).
 */

/** Shared 84u square around the Apex (board 02: "69.4 × 82.7u in an 84u square", optical centre x 60 · y 60.65). */
export const APEX_VIEW_BOX = "18 18.65 84 84";

/**
 * Two approved cuts. Board 02: "Cut 3u horizontal · 7u under 24px"; board 03
 * uses the 7u "micro" cut for every glyph rendered below 24px and the 3u
 * "standard" cut from 24px up.
 */
export const APEX_GEOMETRY = {
  standard: {
    peak: "25.3,102 49.2,45 70.8,45 94.7,102 77.3,102 60,60.7 42.7,102",
    keystone: "60,19.3 50.5,42 69.5,42",
  },
  micro: {
    peak: "25.3,102 48.8,46 71.2,46 94.7,102 77.3,102 60,60.7 42.7,102",
    keystone: "60,19.3 51.7,39 68.3,39",
  },
} as const;

export type ApexCut = keyof typeof APEX_GEOMETRY;
export const APEX_MICRO_BELOW_PX = 24;

/** Board 18 colour tokens used by the identity system. */
export const APEX_COLORS = {
  ink: "#111110",
  inkRaised: "#1F1F1C",
  nearBlack: "#0A0A09",
  ivory: "#F7F6F1",
  paper: "#F5F4EE",
  keystone: "#D7FF3D",
  priorityBg: "#EFF9C4",
  priorityFg: "#3D4A0E",
  muted: "#8C8C82",
  mutedDark: "#9C9C92",
  faint: "#A3A399",
  secondary: "#4A4A43",
  sand: "#ECEBE4",
  statusFill: "#F0EFE9",
  hair: "rgba(17,17,16,0.08)",
  hairStrong: "rgba(17,17,16,0.14)",
  hairDark: "rgba(245,244,238,0.14)",
  dividerDark: "rgba(245,244,238,0.24)",
} as const;

/**
 * Approved Apex fills. `founding-*` is the only lime (lit keystone) Apex;
 * Early 100 carries the same geometry in ink on light surfaces and paper on
 * dark surfaces (board 02/03). `muted` is the inactive tab glyph (board 06).
 */
export type ApexFill = "founding-light" | "founding-dark" | "early-light" | "early-dark" | "muted";

export const APEX_FILLS: Record<ApexFill, { peak: string; keystone: string }> = {
  "founding-light": { peak: APEX_COLORS.ink, keystone: APEX_COLORS.keystone },
  "founding-dark": { peak: APEX_COLORS.paper, keystone: APEX_COLORS.keystone },
  "early-light": { peak: APEX_COLORS.ink, keystone: APEX_COLORS.ink },
  "early-dark": { peak: APEX_COLORS.paper, keystone: APEX_COLORS.paper },
  muted: { peak: APEX_COLORS.muted, keystone: APEX_COLORS.muted },
};

export function apexCutForSize(pixels: number): ApexCut {
  return pixels < APEX_MICRO_BELOW_PX ? "micro" : "standard";
}

/** Plate radius: board 18 `radius.plate` = 24% of size (16→4, 20→5, 24→6, 32→8, 48→12, 64→15). */
export function plateRadius(size: number): number {
  return Math.round(size * 0.24);
}

/** Glyph inside a plate: 62.5% of the plate (board 03 scale ladder: 16→10 … 64→40). */
export function plateGlyphSize(size: number): number {
  return Math.floor(size * 0.625);
}

function assertSize(pixels: number): number {
  if (!Number.isFinite(pixels) || pixels <= 0 || pixels > 1024) throw new Error("Apex size must be a positive pixel value.");
  return pixels;
}

/** Inline SVG markup for server HTML (admission reveal) and static exports. */
export function apexSvgMarkup({ size, fill, cut, title }: { size: number; fill: ApexFill; cut?: ApexCut; title?: string }): string {
  const pixels = assertSize(size);
  const geometry = APEX_GEOMETRY[cut ?? apexCutForSize(pixels)];
  const colors = APEX_FILLS[fill];
  const a11y = title ? `role="img" aria-label="${escapeAttribute(title)}"` : `aria-hidden="true" focusable="false"`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${APEX_VIEW_BOX}" width="${pixels}" height="${pixels}" ${a11y}><polygon points="${geometry.peak}" fill="${colors.peak}"/><polygon points="${geometry.keystone}" fill="${colors.keystone}"/></svg>`;
}

export type PlateEdition = "founding" | "early";
export type PlateSurface = "light" | "dark";

/**
 * Board 03 plates. Founding: filled ink plate (raised #1F1F1C with hairline on
 * dark surfaces). Early 100: white plate with a 1px strong hairline (transparent
 * with a paper hairline on dark surfaces).
 */
export function plateStyle(edition: PlateEdition, surface: PlateSurface): { background: string; hairline: string | null; fill: ApexFill } {
  if (edition === "founding") {
    return surface === "light"
      ? { background: APEX_COLORS.ink, hairline: null, fill: "founding-dark" }
      : { background: APEX_COLORS.inkRaised, hairline: APEX_COLORS.hairDark, fill: "founding-dark" };
  }
  return surface === "light"
    ? { background: "#FFFFFF", hairline: APEX_COLORS.hairStrong, fill: "early-light" }
    : { background: "transparent", hairline: APEX_COLORS.hairDark, fill: "early-dark" };
}

/** Plate SVG (tile + centred Apex) in a `0 0 size size` viewBox for static export / server HTML. */
export function apexPlateSvgMarkup({ size, edition, surface = "light" }: { size: number; edition: PlateEdition; surface?: PlateSurface }): string {
  const pixels = assertSize(size);
  const style = plateStyle(edition, surface);
  const glyph = plateGlyphSize(pixels);
  const offset = (pixels - glyph) / 2;
  const radius = plateRadius(pixels);
  const geometry = APEX_GEOMETRY[apexCutForSize(glyph)];
  const colors = APEX_FILLS[style.fill];
  const tile = style.background === "transparent" ? "" : `<rect width="${pixels}" height="${pixels}" rx="${radius}" fill="${style.background}"/>`;
  const hair = style.hairline ? `<rect x="0.5" y="0.5" width="${pixels - 1}" height="${pixels - 1}" rx="${radius - 0.5}" fill="none" stroke="${style.hairline}" stroke-width="1"/>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${pixels} ${pixels}" width="${pixels}" height="${pixels}" aria-hidden="true" focusable="false">${tile}${hair}<svg x="${offset}" y="${offset}" width="${glyph}" height="${glyph}" viewBox="${APEX_VIEW_BOX}"><polygon points="${geometry.peak}" fill="${colors.peak}"/><polygon points="${geometry.keystone}" fill="${colors.keystone}"/></svg></svg>`;
}

/**
 * The official Wanterest master logo (`LogoMark`, `nav-icons.tsx`). Reproduced
 * here unchanged, only for server HTML/static contexts that cannot import React;
 * the Apex source uses exactly this geometry and it must not be redrawn.
 */
export const WANTEREST_LOGO = {
  viewBox: "0 0 120 118",
  polyline: "10,32 34,102 60,40 86,102 110,32",
  strokeWidth: 16,
  keystone: "60,19 51,42 69,42",
} as const;

export function wanterestLogoSvgMarkup({ size, stroke = APEX_COLORS.ink }: { size: number; stroke?: string }): string {
  const pixels = assertSize(size);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${WANTEREST_LOGO.viewBox}" width="${pixels}" height="${pixels}" aria-hidden="true" focusable="false"><polyline points="${WANTEREST_LOGO.polyline}" fill="none" stroke="${stroke}" stroke-width="${WANTEREST_LOGO.strokeWidth}" stroke-linejoin="miter" stroke-linecap="butt"/><polygon points="${WANTEREST_LOGO.keystone}" fill="${APEX_COLORS.keystone}"/></svg>`;
}

function escapeAttribute(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}

/** Board 02/13: Priority Access carries a signal dot, never an Apex. */
export function priorityMarkSvgMarkup(size = 14): string {
  const pixels = assertSize(size);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 14 14" width="${pixels}" height="${pixels}" aria-hidden="true" focusable="false"><circle cx="7" cy="7" r="7" fill="${APEX_COLORS.priorityFg}"/></svg>`;
}

/** Board 02/13: Early Access carries a hollow ring (1.5px inset #A3A399), never an Apex. */
export function earlyAccessMarkSvgMarkup(size = 14): string {
  const pixels = assertSize(size);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 14 14" width="${pixels}" height="${pixels}" aria-hidden="true" focusable="false"><circle cx="7" cy="7" r="6.25" fill="none" stroke="${APEX_COLORS.faint}" stroke-width="1.5"/></svg>`;
}

/**
 * Board 04 identity containers (no member data): ink and ivory monogram tiles
 * and the neutral fallback (sand tile + open ring at 30% of size). Monogram
 * characters are live text supplied by the backend, never part of the asset.
 */
export type IdentityContainer = "monogram-ink" | "monogram-ivory" | "neutral";

export function identityContainerSvgMarkup(kind: IdentityContainer, size = 40): string {
  const pixels = assertSize(size);
  const radius = plateRadius(pixels);
  const fill = kind === "monogram-ink" ? APEX_COLORS.ink : kind === "monogram-ivory" ? "#FFFFFF" : APEX_COLORS.sand;
  const hairline = kind === "monogram-ivory" ? APEX_COLORS.hairStrong : kind === "neutral" ? APEX_COLORS.hair : null;
  const hair = hairline ? `<rect x="0.5" y="0.5" width="${pixels - 1}" height="${pixels - 1}" rx="${radius - 0.5}" fill="none" stroke="${hairline}" stroke-width="1"/>` : "";
  const ringDiameter = Math.round(pixels * 0.3);
  const ring = kind === "neutral" ? `<circle cx="${pixels / 2}" cy="${pixels / 2}" r="${(ringDiameter - 1.5) / 2}" fill="none" stroke="${APEX_COLORS.faint}" stroke-width="1.5"/>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${pixels} ${pixels}" width="${pixels}" height="${pixels}" aria-hidden="true" focusable="false"><rect width="${pixels}" height="${pixels}" rx="${radius}" fill="${fill}"/>${hair}${ring}</svg>`;
}

/**
 * Static library written to `public/identity/apex-2/` by
 * `scripts/generate-apex-assets.ts`. Filenames follow board 18's asset library.
 * The three board-18 composition files (founder-pass-artwork, early100-pass-
 * artwork, share-og-founding-artwork) are deliberately absent: the source only
 * references them and does not define their static contents (see manifest).
 */
export const APEX_STATIC_ASSETS: Record<string, () => string> = {
  "apex-2.0.svg": () => apexSvgMarkup({ size: 84, fill: "founding-light", cut: "standard" }),
  "apex-2.0-micro.svg": () => apexSvgMarkup({ size: 84, fill: "founding-light", cut: "micro" }),
  "founding-apex-light.svg": () => apexSvgMarkup({ size: 84, fill: "founding-light", cut: "standard" }),
  "founding-apex-dark.svg": () => apexSvgMarkup({ size: 84, fill: "founding-dark", cut: "standard" }),
  "early100-apex-light.svg": () => apexSvgMarkup({ size: 84, fill: "early-light", cut: "standard" }),
  "early100-apex-dark.svg": () => apexSvgMarkup({ size: 84, fill: "early-dark", cut: "standard" }),
  "founding-plate.svg": () => apexPlateSvgMarkup({ size: 64, edition: "founding" }),
  "early100-plate.svg": () => apexPlateSvgMarkup({ size: 64, edition: "early" }),
  "priority-mark.svg": () => priorityMarkSvgMarkup(14),
  "early-access-mark.svg": () => earlyAccessMarkSvgMarkup(14),
  "monogram-container-ink.svg": () => identityContainerSvgMarkup("monogram-ink", 40),
  "monogram-container-ivory.svg": () => identityContainerSvgMarkup("monogram-ivory", 40),
  "neutral-fallback.svg": () => identityContainerSvgMarkup("neutral", 40),
};
