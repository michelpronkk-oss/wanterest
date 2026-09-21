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

export function domainFromUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
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

export function themeLabel(key: string): string {
  return key
    .split(/[_-]+/u)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ") || key;
}

export function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function isWithinLastDays(dateString: string, days: number): boolean {
  const time = new Date(dateString).getTime();
  if (Number.isNaN(time)) return false;
  return Date.now() - time < days * 24 * 60 * 60 * 1000;
}

export function formatRelativeTime(value: string | null | undefined): string {
  if (!value) return "Recently";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "Recently";
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return formatDate(value);
}
