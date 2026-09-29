/** V1 public reference policy; mirrored in the forward SQL migration, not a URL license/secret detector. */
export const publicProfileUrlPolicy = {
  authority: "^https://([A-Za-z0-9.-]+)(:443)?([/?#].*)?$",
  hostname: "^([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\\.)+[A-Za-z]{2,63}$",
  privateSuffix: "(^|\\.)(localhost|local|localdomain|internal|test|invalid|example|onion|home|lan|corp)$",
  privatePath: "(^|/)(auth|login|signin|sign-in|sign_in|signup|sign-up|sign_up|logout|oauth|callback|verify|verification|invite|invitations|reset-password|forgot-password|account|settings|admin|private|protected)(/|;|$)",
  privateStorage: "/(object|image)/(sign|authenticated)(/|;|$)",
  privateApplication: "^/(app|api/workspaces)(/|;|$)",
  credentialKeys: ["token", "accesstoken", "refreshtoken", "idtoken", "authtoken", "bearer", "bearertoken", "csrf", "csrftoken", "cfaccesstoken", "cfaccessjwt", "jwt", "authorization", "auth", "apikey", "key", "password", "secret", "clientsecret", "session", "sessionid", "invite", "invitetoken", "verificationtoken", "code", "signature", "sig", "policy", "expires", "expiry", "credential", "awsaccesskeyid", "googleaccessid", "sv", "se", "sp", "sr", "skoid", "sktid", "skt", "ske", "sks", "skv"],
} as const;

function decodeComponent(value: string): string | null {
  try {
    const decoded = decodeURIComponent(value);
    return /[\u0000-\u001f\u007f-\u009f\\]/.test(decoded) ? null : decoded;
  } catch { return null; }
}

function credentialKey(value: string): boolean {
  const normalized = value.toLowerCase().replace(/[-_.]/g, "");
  return publicProfileUrlPolicy.credentialKeys.some((key) => normalized === key) || /^(xamz|xgoog)/.test(normalized);
}

/** No DNS/network access. Fail closed on ambiguous syntax; preserve accepted references verbatim. */
export function isPublicProfileUrl(value: string): boolean {
  if (value.length > 2048 || !/^[!-~]+$/.test(value) || value.includes("\\")) return false;
  const match = new RegExp(publicProfileUrlPolicy.authority).exec(value);
  if (!match) return false;
  const hostname = match[1];
  if (hostname.length > 253 || !new RegExp(publicProfileUrlPolicy.hostname).test(hostname) || new RegExp(publicProfileUrlPolicy.privateSuffix, "i").test(hostname)) return false;
  const tail = match[3] ?? "";
  const hash = tail.indexOf("#");
  const fragment = hash < 0 ? "" : tail.slice(hash + 1);
  const beforeHash = hash < 0 ? tail : tail.slice(0, hash);
  const question = beforeHash.indexOf("?");
  const path = decodeComponent(question < 0 ? beforeHash : beforeHash.slice(0, question));
  if (path === null || /[?#]/.test(path) || /%[0-9a-f]{2}/i.test(path) || /(^|\/)\.{1,2}(\/|$)/.test(path) || new RegExp(publicProfileUrlPolicy.privatePath, "i").test(path) || new RegExp(publicProfileUrlPolicy.privateStorage, "i").test(path) || new RegExp(publicProfileUrlPolicy.privateApplication, "i").test(path) || /(^|\/)s--[^/]+--(\/|$)/i.test(path)) return false;
  if (hash >= 0) {
    const anchor = decodeComponent(fragment);
    if (anchor === null || !/^[A-Za-z][A-Za-z0-9_-]{0,79}$/.test(anchor) || credentialKey(anchor) || /^(token|secret|jwt|session|invite)[_-]/i.test(anchor)) return false;
  }
  if (question >= 0) {
    const query = beforeHash.slice(question + 1);
    if (!query) return false;
    for (const pair of query.split("&")) {
      const equals = pair.indexOf("=");
      const name = decodeComponent(equals < 0 ? pair : pair.slice(0, equals));
      const parameter = decodeComponent(equals < 0 ? "" : pair.slice(equals + 1));
      if (name === null || !/^[A-Za-z0-9_.-]+$/.test(name) || credentialKey(name) || parameter === null) return false;
    }
  }
  return true;
}

/** Read-time defense for legacy persisted values, including direct public DTO construction. */
export function publicProfileUrlOrNull(value: string | null): string | null {
  return value !== null && isPublicProfileUrl(value) ? value : null;
}
