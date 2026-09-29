export const ADMIN_HOSTNAME = "admin.wanterest.com";
export const ADMIN_INTERNAL_PREFIX = "/admin-internal";

export type AdminHostDecision =
  | { kind: "admin"; rewritePath: string }
  | { kind: "blocked" }
  | { kind: "customer" };

function isInternalPath(pathname: string) {
  let decodedPath = pathname;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    // Malformed escapes cannot represent a valid internal route.
  }
  const normalized = decodedPath.toLowerCase();
  return normalized === ADMIN_INTERNAL_PREFIX || normalized.startsWith(`${ADMIN_INTERNAL_PREFIX}/`);
}

export function resolveAdminHostRequest(input: {
  hostname: string;
  pathname: string;
  isVercel: boolean;
  vercelEnvironment?: string;
  allowLocalAdminHost?: boolean;
}): AdminHostDecision {
  const hostname = input.hostname.toLowerCase().replace(/\.$/, "");

  // The implementation namespace must never be directly addressable, even on
  // the admin host. It is reached only by the host-based rewrite below.
  if (isInternalPath(input.pathname)) return { kind: "blocked" };

  const isAdminHost = hostname === ADMIN_HOSTNAME || (hostname === "admin.localhost" && input.allowLocalAdminHost === true);
  if (!isAdminHost) return { kind: "customer" };

  // Vercel aliases and preview deployments must not expose the control center.
  if (input.isVercel && input.vercelEnvironment !== "production") return { kind: "blocked" };

  const suffix = input.pathname === "/" ? "" : input.pathname;
  return { kind: "admin", rewritePath: `${ADMIN_INTERNAL_PREFIX}${suffix}` };
}
