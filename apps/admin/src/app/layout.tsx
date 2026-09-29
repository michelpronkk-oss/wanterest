import type { Metadata } from "next";
import { AdminScope } from "./admin-scope";

// Every response receives a one-time CSP nonce from proxy.ts.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { default: "Wanterest Admin", template: "%s · Wanterest Admin" },
  description: "Private operations console for Wanterest.",
  robots: { index: false, follow: false, noarchive: true },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body><AdminScope>{children}</AdminScope></body>
    </html>
  );
}
