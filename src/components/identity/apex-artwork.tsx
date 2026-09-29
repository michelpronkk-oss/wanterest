import type { CSSProperties } from "react";

import {
  APEX_FILLS,
  APEX_GEOMETRY,
  APEX_VIEW_BOX,
  apexCutForSize,
  plateGlyphSize,
  plateRadius,
  plateStyle,
  type ApexCut,
  type ApexFill,
  type PlateEdition,
  type PlateSurface,
} from "@/shared/apex-artwork";

/**
 * Pure, hook-free Apex 2.0 artwork leaves. Server- and client-safe; they render
 * only approved geometry from `@/shared/apex-artwork` and never carry member data.
 * Decorative by default: the surrounding badge/pass supplies the accessible text.
 */
export function ApexMark({ size, fill, cut, title, className }: { size: number; fill: ApexFill; cut?: ApexCut; title?: string; className?: string }) {
  const geometry = APEX_GEOMETRY[cut ?? apexCutForSize(size)];
  const colors = APEX_FILLS[fill];
  const a11y = title ? { role: "img" as const, "aria-label": title } : { "aria-hidden": true as const, focusable: "false" as const };
  return (
    <svg viewBox={APEX_VIEW_BOX} width={size} height={size} className={className} style={{ display: "block", flexShrink: 0 }} data-apex-cut={cut ?? apexCutForSize(size)} {...a11y}>
      <polygon points={geometry.peak} fill={colors.peak} />
      <polygon points={geometry.keystone} fill={colors.keystone} />
    </svg>
  );
}

/** Board 03 plate: the tier is the plate (filled Founding, outlined Early 100). */
export function ApexPlate({ size, edition, surface = "light", className }: { size: number; edition: PlateEdition; surface?: PlateSurface; className?: string }) {
  const style = plateStyle(edition, surface);
  const css: CSSProperties = {
    width: size,
    height: size,
    borderRadius: plateRadius(size),
    background: style.background,
    boxShadow: style.hairline ? `inset 0 0 0 1px ${style.hairline}` : undefined,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  };
  return (
    <span className={className} style={css} data-apex-plate={edition} data-surface={surface} aria-hidden="true">
      <ApexMark size={plateGlyphSize(size)} fill={style.fill} />
    </span>
  );
}
