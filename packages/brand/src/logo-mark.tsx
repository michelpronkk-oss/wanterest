export type LogoMarkProps = { size?: number };

/** The approved Wanterest master mark. Keep its SVG geometry identical across apps. */
export function LogoMark({ size = 19 }: LogoMarkProps) {
  return (
    <svg viewBox="0 0 120 118" width={size} height={size} aria-hidden="true">
      <polyline points="10,32 34,102 60,40 86,102 110,32" fill="none" stroke="currentColor" strokeWidth={16} strokeLinejoin="miter" strokeLinecap="butt" />
    </svg>
  );
}
