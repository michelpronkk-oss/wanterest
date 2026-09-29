import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AdminScope } from "@admin/app/admin-scope";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { default: "Wanterest Admin", template: "%s · Wanterest Admin" },
  description: "Private operations console for Wanterest.",
  robots: { index: false, follow: false, noarchive: true },
};

export default function AdminHostLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <AdminScope>{children}</AdminScope>;
}
