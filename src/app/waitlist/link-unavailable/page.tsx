import type { Metadata } from "next";

import { JourneyShell, LinkUnavailableView } from "@/components/waitlist/journey-views";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Link unavailable",
  robots: { index: false, follow: false },
};

/** Design 14 — expired / invalid confirmation link. The reason is non-sensitive and chosen server-side by /waitlist/verify. */
export default async function LinkUnavailablePage({ searchParams }: { searchParams: Promise<{ reason?: string | string[] }> }) {
  const reason = (await searchParams).reason === "expired" ? "expired" : "invalid";
  return <JourneyShell nav="marketing"><LinkUnavailableView reason={reason} /></JourneyShell>;
}
