export const SIGNALS_PAGE_SIZE = 25;

export function formatScore(score: number): string {
  return `${Math.round(score * 100)}%`;
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "Date unavailable";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "Date unavailable";
  return new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(date);
}

export function sourceLabel(source: string): string {
  return source
    .split(/[_-]+/u)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ") || "Unknown source";
}

export function safeExternalUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function lifecycleLabel(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
