type IconProps = { color: string };

export function LogoMark({ size = 19 }: { size?: number }) {
  return (
    <svg viewBox="0 0 120 118" width={size} height={size} aria-hidden="true">
      <polyline points="10,32 34,102 60,40 86,102 110,32" fill="none" stroke="currentColor" strokeWidth={16} strokeLinejoin="miter" strokeLinecap="butt" />
      <polygon points="60,19 51,42 69,42" fill="var(--color-accent)" />
    </svg>
  );
}

export function HomeIcon({ color }: IconProps) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2 7L8 2L14 7V13.5C14 13.78 13.78 14 13.5 14H9.5V9.5H6.5V14H2.5C2.22 14 2 13.78 2 13.5V7Z" stroke={color} strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  );
}

export function SignalsIcon({ color }: IconProps) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2 11L5.5 5.5L8.5 9L14 2.5" stroke={color} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10.5 2.5H14V6" stroke={color} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function SavedIcon({ color }: IconProps) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M4 2.5H12V14L8 11L4 14V2.5Z" stroke={color} strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  );
}

export function InsightsIcon({ color }: IconProps) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="2.5" y="8.5" width="2.6" height="5" rx="0.5" stroke={color} strokeWidth="1.2" />
      <rect x="6.7" y="4.5" width="2.6" height="9" rx="0.5" stroke={color} strokeWidth="1.2" />
      <rect x="10.9" y="6.5" width="2.6" height="7" rx="0.5" stroke={color} strokeWidth="1.2" />
    </svg>
  );
}

export function ActionsIcon({ color }: IconProps) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8.6 1.6L3.4 9.2H7.2L6.6 14.4L12.6 6.4H8.6L8.6 1.6Z" stroke={color} strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}

export function ExperimentsIcon({ color }: IconProps) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M6.2 2H9.8" stroke={color} strokeWidth="1.2" strokeLinecap="round" />
      <path d="M6.8 2V6.3L3.3 12.4C3 12.9 3.4 13.6 4 13.6H12C12.6 13.6 13 12.9 12.7 12.4L9.2 6.3V2" stroke={color} strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}

export function SettingsIcon({ color }: IconProps) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="2.2" stroke={color} strokeWidth="1.2" />
      <path d="M8 1.6V3.2M8 12.8V14.4M14.4 8H12.8M3.2 8H1.6M12.5 3.5L11.4 4.6M4.6 11.4L3.5 12.5M12.5 12.5L11.4 11.4M4.6 4.6L3.5 3.5" stroke={color} strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

export function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 15 15" fill="none" aria-hidden="true">
      <circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" strokeWidth="1.3" />
      <path d="M13 13L9.8 9.8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

export function InboxIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2 5.5L8 9.5L14 5.5" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <rect x="2" y="3.5" width="12" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}
