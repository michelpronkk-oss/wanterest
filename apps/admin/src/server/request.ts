import "server-only";

import { headers } from "next/headers";

import { ADMIN_HOSTNAME } from "../host-routing";

export async function isAdminHostnameRequest() {
  const requestHeaders = await headers();
  const hostname = requestHeaders.get("host")?.split(":", 1)[0]?.toLowerCase().replace(/\.$/, "");
  const localAdminHost = hostname === "admin.localhost" && process.env.NODE_ENV === "development";
  if (hostname !== ADMIN_HOSTNAME && !localAdminHost) return false;
  return process.env.VERCEL !== "1" || process.env.VERCEL_ENV === "production";
}

export async function assertAdminHostnameRequest() {
  if (!await isAdminHostnameRequest()) throw new Error("Not found");
}
