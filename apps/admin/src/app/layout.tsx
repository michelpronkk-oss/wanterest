import type { Metadata } from "next";
import localFont from "next/font/local";
import "./styles.css";

const inter = localFont({ src: "../../../../assets/fonts/Inter-400.ttf", variable: "--font-inter", weight: "400", display: "swap" });
const interBold = localFont({ src: "../../../../assets/fonts/Inter-700.ttf", variable: "--font-inter-bold", weight: "700", display: "swap" });
const sora = localFont({ src: "../../../../assets/fonts/Sora-600.ttf", variable: "--font-sora", weight: "600", display: "swap" });
const archivo = localFont({ src: "../../../../assets/fonts/Archivo-700.ttf", variable: "--font-archivo", weight: "700", display: "swap" });

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
      <body className={`${inter.variable} ${interBold.variable} ${sora.variable} ${archivo.variable}`}>{children}</body>
    </html>
  );
}
