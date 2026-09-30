import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Archivo, Geist_Mono, Inter, Sora } from "next/font/google";
import "./globals.css";

import { DEFAULT_DESCRIPTION, DEFAULT_TITLE, SITE_NAME } from "@/shared/config/seo";
import { SITE_ORIGIN } from "@/shared/config/site";
import { Analytics, type BeforeSendEvent } from "@vercel/analytics/next";

const analyticsPaths = new Set(["/", "/about", "/contact", "/cookies", "/pricing", "/privacy", "/product", "/terms", "/waitlist"]);

function filterPublicAnalyticsEvent(event: BeforeSendEvent): BeforeSendEvent | null {
  try {
    const url = new URL(event.url, SITE_ORIGIN);
    if (!analyticsPaths.has(url.pathname)) return null;
    // Exclude query parameters so verification links, referral parameters and form
    // prefill data never become analytics dimensions.
    return { ...event, url: `${url.origin}${url.pathname}` };
  } catch {
    return null;
  }
}

const sora = Sora({
  variable: "--font-sora",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  weight: ["700", "800"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_ORIGIN),
  title: { default: DEFAULT_TITLE, template: `%s — ${SITE_NAME}` },
  description: DEFAULT_DESCRIPTION,
  applicationName: SITE_NAME,
  robots: { index: true, follow: true },
  icons: { icon: "/favicon.ico" },
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    title: DEFAULT_TITLE,
    description: DEFAULT_DESCRIPTION,
    url: "/",
  },
  twitter: {
    card: "summary_large_image",
    title: DEFAULT_TITLE,
    description: DEFAULT_DESCRIPTION,
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${sora.variable} ${archivo.variable} ${inter.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        {process.env.VERCEL === "1" && process.env.VERCEL_ENV === "production" ? <Analytics beforeSend={filterPublicAnalyticsEvent} /> : null}
      </body>
    </html>
  );
}
