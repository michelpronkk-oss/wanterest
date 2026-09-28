/** Small icon set shared by the homepage's proof-style cards and feature previews (Process, Beyond Signals). */

export function DocumentIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M4 2h5l3 3v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Z" stroke="var(--color-ink-secondary)" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M5.5 8.5h5M5.5 11h3.5" stroke="var(--color-ink-secondary)" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

export function BarsIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="2" y="8" width="3" height="6" rx="0.8" fill="var(--color-ink-secondary)" />
      <rect x="6.5" y="4.5" width="3" height="9.5" rx="0.8" fill="var(--color-ink-secondary)" />
      <rect x="11" y="1.5" width="3" height="12.5" rx="0.8" fill="var(--color-ink-secondary)" />
    </svg>
  );
}

export function SparkleIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="var(--color-accent)" aria-hidden="true">
      <path d="M8 1.5c.35 2.6 1.4 3.65 4 4a.15.15 0 0 1 0 .3c-2.6.35-3.65 1.4-4 4a.15.15 0 0 1-.3 0c-.35-2.6-1.4-3.65-4-4a.15.15 0 0 1 0-.3c2.6-.35 3.65-1.4 4-4a.15.15 0 0 1 .3 0Z" />
      <path d="M13 10.2c.18 1.3.7 1.83 2 2 .1.02.1.16 0 .18-1.3.17-1.82.7-2 2-.02.1-.16.1-.18 0-.17-1.3-.7-1.83-2-2a.1.1 0 0 1 0-.18c1.3-.17 1.83-.7 2-2 .02-.1.16-.1.18 0Z" />
    </svg>
  );
}
