import type { Metadata } from "next";

import { getPublicCohortWallsQuery, type PublicCohortRow } from "@/server/modules/cohort-public";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Wanterest members",
  description: "Publicly opted-in Founding 25 and Early 100 members of Wanterest.",
  alternates: { canonical: "/members" },
};

function number(row: PublicCohortRow): string {
  return `#${String(row.number).padStart(row.cohort === "founding_25" ? 2 : 3, "0")}`;
}

function WallSection({ title, rows }: { title: string; rows: PublicCohortRow[] }) {
  return (
    <section aria-labelledby={`${title.toLowerCase().replaceAll(" ", "-")}-title`}>
      <div className="marketing-content-eyebrow"><span className="marketing-content-eyebrow-dot" /> {title}</div>
      <h2 id={`${title.toLowerCase().replaceAll(" ", "-")}-title`}>{rows.length ? `${rows.length} public member${rows.length === 1 ? "" : "s"}` : "No public members yet"}</h2>
      {rows.length ? (
        <ol aria-label={`${title} public members`}>
          {rows.map((row) => (
            <li key={row.publicSlug}>
              <a href={`/members/${encodeURIComponent(row.publicSlug)}`}>
                <span aria-hidden="true">{row.monogram ?? "WN"}</span>
                <span>{number(row)} · {row.displayName}</span>
              </a>
            </li>
          ))}
        </ol>
      ) : <p>Public visibility is opt-in. The wall will grow as members choose to share their identity.</p>}
    </section>
  );
}

export default async function MembersPage() {
  const walls = await getPublicCohortWallsQuery();
  return (
    <main className="marketing-content-wrap" aria-labelledby="members-title">
      <div className="marketing-content-eyebrow"><span className="marketing-content-eyebrow-dot" /> WANterest community</div>
      <h1 id="members-title">The people building with Wanterest.</h1>
      <p>Permanent cohort identities belong to workspaces. Only members who opt in appear here.</p>
      <WallSection title="Founding 25" rows={walls.founding} />
      <WallSection title="Early 100" rows={walls.early} />
    </main>
  );
}
