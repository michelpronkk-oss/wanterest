# Apex 2.0 asset manifest

Source of truth: `docs/design/claude/originals/Wanterest Apex 2.0 Identity System.dc.html`
(added in `7451ede1a5b43c8cdf74dafaf71923ee6624f9cb`, left byte-for-byte unchanged). 19 boards,
216 inline SVG elements, 24 unique `(viewBox, geometry)` combinations.

Single geometry module: `src/shared/apex-artwork.ts`. Every static file below is generated from it
by `npx vite-node scripts/generate-apex-assets.ts`; `tests/components/apex-artwork.test.tsx` fails if
a committed file drifts from the module, if the module drifts from the source HTML, or if a file
contains scripts, event handlers, `foreignObject`, `href`/`url()` references, `<image>`, `<text>`
or member data.

## Classification key

- **A** — exact SVG geometry present in the source and extracted verbatim.
- **B** — reproducible exactly from explicit approved geometry/specs in the source (no new shapes).
- **C** — referenced or specified visually, but the source lacks the geometry/content for an exact export.
- **D** — completely missing from the source.

## Extracted geometry (category A)

| Element | Source boards | viewBox | Exact geometry |
| --- | --- | --- | --- |
| Apex, standard (3u) cut — glyphs ≥ 24px | 01 C · Keystone (selected), 02, 03 (48/64px), 08 | `18 18.65 84 84` | peak `25.3,102 49.2,45 70.8,45 94.7,102 77.3,102 60,60.7 42.7,102`; keystone `60,19.3 50.5,42 69.5,42` |
| Apex, micro (7u) cut — glyphs < 24px | 00, 03 (16–32px plates), 05, 06–17 | `18 18.65 84 84` | peak `25.3,102 48.8,46 71.2,46 94.7,102 77.3,102 60,60.7 42.7,102`; keystone `60,19.3 51.7,39 68.3,39` |
| Wanterest master logo (unchanged) | 00, 06–12, 15–16 | `0 0 120 118` | polyline `10,32 34,102 60,40 86,102 110,32` stroke 16; keystone `60,19 51,42 69,42` |
| Fills | 02, 03, 06 | — | Founding: peak ink `#111110` / paper `#F5F4EE` + lit keystone `#D7FF3D`. Early 100: ink/ink on light, paper/paper on dark. Inactive tab: `#8C8C82`/`#8C8C82` |

Not extracted (exploration only, rejected on board 01): Apex 1.0 stroked peak, "A · Split signal",
"B · Offset terminal", and the board 02 construction grid (dashed red guides are annotations).

The master logo is **not** redrawn: `LogoMark` in `src/components/dashboard/nav-icons.tsx` is
untouched; `WANTEREST_LOGO` only mirrors it for server-string contexts and a test asserts both
match the source.

## Static library — `public/identity/apex-2/`

Filenames follow board 18 "Asset library · assets/identity/". The source references these files as
`<img src="assets/identity/*.svg">` but **none of the files are in the repository** (they render as
broken images in the source itself). Where the board also supplies explicit geometry, the file is
reproduced exactly (category B); it is not an "original export".

| File | Class | viewBox / size | Variant | Min size / usage |
| --- | --- | --- | --- | --- |
| `apex-2.0.svg` | B (A geometry) | `18 18.65 84 84` | standard cut, ink + lit keystone | ≥ 24px |
| `apex-2.0-micro.svg` | B (A geometry) | `18 18.65 84 84` | micro cut, ink + lit keystone | < 24px (source ladder down to 10px glyph) |
| `founding-apex-light.svg` | B | `18 18.65 84 84` | Founding on light surface | ≥ 24px |
| `founding-apex-dark.svg` | B | `18 18.65 84 84` | Founding on dark surface (paper + lime) | ≥ 24px |
| `early100-apex-light.svg` | B | `18 18.65 84 84` | Early 100 on light (ink/ink) | ≥ 24px |
| `early100-apex-dark.svg` | B | `18 18.65 84 84` | Early 100 on dark (paper/paper) | ≥ 24px |
| `founding-plate.svg` | B | `0 0 64 64` | filled ink plate, radius 15 (24%), glyph 40 (62.5%) | plate ladder 16–64 |
| `early100-plate.svg` | B | `0 0 64 64` | white plate + 1px `rgba(17,17,16,.14)` hairline | plate ladder 16–64 |
| `priority-mark.svg` | B | `0 0 14 14` | signal dot `#3D4A0E` (board 02) | 6–14px |
| `early-access-mark.svg` | B | `0 0 14 14` | hollow ring, 1.5px `#A3A399` (board 02) | 14px |
| `monogram-container-ink.svg` | B | `0 0 40 40` | ink tile, radius 10 (board 04) | 20–96px; characters are live text |
| `monogram-container-ivory.svg` | B | `0 0 40 40` | white tile + strong hairline | 20–96px |
| `neutral-fallback.svg` | B | `0 0 40 40` | sand `#ECEBE4` tile + hairline + open ring 30% | 20–96px |

Safe area: the Apex sits in an 84u square (bounds 69.4 × 82.7u, optical centre x 60 · y 60.65);
plates keep a 18.75% inset on every side (glyph = 62.5% of the plate).

Light/dark: "dark" means a dark *surface* (board 03 deep ink / near-black), not an app dark mode —
Wanterest has no dark theme and none was invented. Early 100 on dark uses the source's paper fill;
no colour was inverted arbitrarily.

## Not extractable

| Referenced asset | Class | What is missing |
| --- | --- | --- |
| `founder-pass-artwork.svg` | C | The source never defines the file's contents (plate only? label? wordmark?). The **composition** is fully specified as HTML/CSS on boards 09/11/12 and is implemented as `FounderPassArtwork`; no static SVG was invented. |
| `early100-pass-artwork.svg` | C | Same, boards 10/12. |
| `share-og-founding-artwork.svg` | C | Board 15 shows share compositions as HTML; the static export's contents and its Early 100/Priority/Early Access siblings are not defined. 13B share cards are out of scope. |
| Licensed/outlined typography | D | Archivo 800 / Sora 600 / Inter are loaded via `next/font/google` (app) and Google Fonts CSS (server admission HTML). No outlined lettering or font files for Satori/13B were supplied. |

## Source → component map

| Source | React / server artwork | Pure data |
| --- | --- | --- |
| Apex glyph | `ApexMark` (`src/components/identity/apex-artwork.tsx`) | `APEX_GEOMETRY`, `APEX_FILLS`, `apexSvgMarkup` |
| Plate | `ApexPlate` | `plateStyle`, `plateRadius`, `plateGlyphSize`, `apexPlateSvgMarkup` |
| Cohort pill / micro badge (boards 03, 17) | `CohortBadge` (`member-identity-slots.tsx`) | `admittedCohortPresentation` |
| Identity tiles / fallbacks (board 04) | `IdentityFallback`, `IdentityImageFrame`, client `MemberIdentity` | `monogramFontSize`, `monogramTone`, `identityContainerSvgMarkup` |
| Early Access / Priority (boards 02, 13) | `EarlyAccessPill`, `PriorityPill`, `EarlyAccessNumber` | existing `earlyAccessLabel` |
| Status / publication / activity (board 03) | `AccessStatusChip`, `PublicationChip`, `WorkspaceActivity` | — |
| Member card (board 05 A) | `MemberWallCard` | — |
| Founder Pass / Early 100 Pass (boards 09, 10) | `FounderPassArtwork` (`founder-pass.tsx`) | — |
| Admission reveal (board 14) | `admissionHtml` (`src/app/invite/complete/admission-html.ts`) | `apexSvgMarkup`, `wanterestLogoSvgMarkup` |

## Tokens used (board 18)

ink `#111110`, ink.raised `#1F1F1C`, nearblack `#0A0A09`, ivory `#F7F6F1`, paper `#F5F4EE`,
keystone `#D7FF3D`, priority.bg `#EFF9C4`, priority.fg `#3D4A0E`, muted `#8C8C82`, muted.dark
`#9C9C92`, hair `rgba(17,17,16,.08)`, hair.strong `rgba(17,17,16,.14)`, hair.dark
`rgba(245,244,238,.14)`; serial Archivo 800 −0.045em (total 24% of serial), label Inter 700
10.5px .14em, names Sora 600; radius plate 24% / pill 999 / status 6 / card 14 / pass 20;
pill heights 22/28; motion 160/240/800/1200ms, `cubic-bezier(.2,0,0,1)`.

## Accessibility

Artwork leaves are `aria-hidden`; badges carry visually hidden text (`Founding 25 #07`), passes an
`aria-label` (`Name, Early 100 #042 public pass`), status chips visible text. Motion is opacity +
8px rise only and disabled under `prefers-reduced-motion`.

## Future 13B reuse

`src/shared/apex-artwork.ts` is dependency-free and emits only `<svg>`, `<polygon>`, `<polyline>`,
`<rect>` and `<circle>` with literal fills — the subset Satori supports (not yet render-tested
inside `ImageResponse`). 13B's existing DTO carries variant, display name, headline and identity
number; board 15 compositions also show logo/avatar and admission month, which 13B does **not**
currently provide. Adding them needs a separate reviewed publication DTO; nothing here adds public
fields or image permissions.
