const HOSTNAME_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

function isIpAddress(hostname: string): boolean {
  if (hostname.includes(":")) return true;
  const labels = hostname.split(".");
  return labels.length === 4 && labels.every((label) => /^\d+$/.test(label));
}

/** Fast browser-side guard. The server schema remains authoritative. */
export function isValidOnboardingWebsiteInput(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || /\s/.test(trimmed)) return false;
  if (/^[a-z][a-z\d+.-]*:/i.test(trimmed) && !/^https?:\/\//i.test(trimmed)) return false;

  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return false;
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const labels = hostname.split(".");
  if (!/^https?:$/.test(parsed.protocol) || !hostname || parsed.username || parsed.password || parsed.port) return false;
  if (hostname === "localhost" || hostname.endsWith(".local") || isIpAddress(hostname)) return false;
  if (labels.length < 2 || labels.some((label) => !HOSTNAME_LABEL.test(label))) return false;
  return (labels.at(-1)?.length ?? 0) >= 2;
}

export function isValidOnboardingDescription(value: string): boolean {
  const trimmedLength = value.trim().length;
  return trimmedLength >= 15 && trimmedLength <= 240;
}

export function isValidOnboardingProductForm(website: string, description: string): boolean {
  return isValidOnboardingWebsiteInput(website) && isValidOnboardingDescription(description);
}
