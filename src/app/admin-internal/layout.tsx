import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { AdminScope } from "@admin/app/admin-scope";
import { isAdminHostnameRequest } from "@admin/server/request";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { default: "Wanterest Admin", template: "%s · Wanterest Admin" },
  description: "Private operations console for Wanterest.",
  robots: { index: false, follow: false, noarchive: true },
};

export default async function AdminHostLayout({ children }: Readonly<{ children: ReactNode }>) {
  if (!await isAdminHostnameRequest()) notFound();
  return <AdminScope>{children}</AdminScope>;
}
