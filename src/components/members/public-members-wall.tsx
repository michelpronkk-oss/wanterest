"use client";

import Link from "next/link";
import { useRef, useState } from "react";

import { CohortBadge, MemberIdentity } from "./member-identity";
import styles from "./public-members-wall.module.css";
import type { PublicMemberIdentity } from "@/shared/public-member-identity";

type WallKey = "founding" | "early";

/** Serializable, public-only view of the server's authoritative cohort projection. */
export type PublicMemberWallRow = {
  publicSlug: string;
  displayName: string;
  headline: string | null;
  cohort: "founding_25" | "early_100";
  number: number;
  assignedAt: string;
  identity: PublicMemberIdentity;
};

type PublicMembersWallProps = {
  founding: PublicMemberWallRow[];
  early: PublicMemberWallRow[];
  primaryAction: { href: string; label: string };
};

const WALLS: Array<{ key: WallKey; label: string; description: string }> = [
  { key: "founding", label: "Founding 25", description: "The first 25 admitted workspaces." },
  { key: "early", label: "Early 100", description: "The next 100 admitted workspaces." },
];

function cohortLabel(cohort: PublicMemberWallRow["cohort"]): string {
  return cohort === "founding_25" ? "Founding 25" : "Early 100";
}

function cohortNumber(row: PublicMemberWallRow): string {
  return `#${String(row.number).padStart(4, "0")}`;
}

function admittedAt(value: string): string {
  return new Intl.DateTimeFormat("en", { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(value));
}

function MemberCard({ row }: { row: PublicMemberWallRow }) {
  const label = cohortLabel(row.cohort);
  return (
    <li className={styles.cardItem}>
      {/* wall_visible and pass_visible are deliberately independent consent flags. The
          public wall DTO does not expose pass visibility, so this card never implies
          that the separate public-pass route is available. */}
      <article className={styles.card} aria-label={`${row.displayName}, ${label} ${cohortNumber(row)}`}>
        <div className={styles.cardTopline}>
          <span className={styles.number}>{cohortNumber(row)}</span>
          <CohortBadge cohort={row.cohort} className={styles.cohortBadge} />
        </div>
        <div className={styles.identity}>
          <MemberIdentity identity={row.identity} />
          <span className={styles.identityCopy}>
            <strong>{row.displayName}</strong>
            {row.headline ? <span className={styles.headline}>{row.headline}</span> : <span className={styles.headline}>Public cohort member</span>}
          </span>
        </div>
        <span className={styles.admitted}>Admitted {admittedAt(row.assignedAt)}</span>
        <span className={styles.cardFooter}>
          <span className={styles.visibility}><i aria-hidden="true" /> Visible by choice</span>
        </span>
      </article>
    </li>
  );
}

export function PublicMembersWall({ founding, early, primaryAction }: PublicMembersWallProps) {
  const [activeWall, setActiveWall] = useState<WallKey>("founding");
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  function moveToTab(currentIndex: number, key: string) {
    const lastIndex = WALLS.length - 1;
    const nextIndex = key === "ArrowRight" ? (currentIndex + 1) % WALLS.length
      : key === "ArrowLeft" ? (currentIndex - 1 + WALLS.length) % WALLS.length
        : key === "Home" ? 0
          : key === "End" ? lastIndex
            : currentIndex;
    if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(key)) return;
    setActiveWall(WALLS[nextIndex].key);
    tabRefs.current[nextIndex]?.focus();
  }

  return (
    <main className={styles.wall} aria-labelledby="members-title">
      <header className={styles.hero}>
        <div className={styles.signalField} aria-hidden="true"><i /><i /><i /><i /><i /><i /></div>
        <div className={styles.eyebrow}><span aria-hidden="true" /> Public members wall</div>
        <h1 id="members-title">The people building<br />what&apos;s next.</h1>
        <p>A public wall of the founders, builders and operators in our earliest cohorts. Real people choose whether to appear.</p>
      </header>

      <section className={styles.wallContent} aria-labelledby="wall-heading">
        <h2 id="wall-heading" className={styles.srOnly}>Public cohort members</h2>
        <div className={styles.tabs} role="tablist" aria-label="Public member cohorts">
          {WALLS.map((wall, index) => {
            const isActive = wall.key === activeWall;
            return (
              <button
                key={wall.key}
                id={`${wall.key}-members-tab`}
                className={isActive ? styles.tabActive : styles.tab}
                role="tab"
                type="button"
                aria-selected={isActive}
                aria-controls={`${wall.key}-members-panel`}
                tabIndex={isActive ? 0 : -1}
                onClick={() => setActiveWall(wall.key)}
                onKeyDown={(event) => {
                  if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) return;
                  event.preventDefault();
                  moveToTab(index, event.key);
                }}
                ref={(element) => { tabRefs.current[index] = element; }}
              >
                {wall.label}
              </button>
            );
          })}
        </div>

        {WALLS.map((wall) => {
          const rows = wall.key === "founding" ? founding : early;
          return (
            <div key={wall.key} id={`${wall.key}-members-panel`} className={styles.panel} role="tabpanel" aria-labelledby={`${wall.key}-members-tab`} hidden={wall.key !== activeWall} tabIndex={0}>
              <p className={styles.cohortDescription}>{wall.description}</p>
              {rows.length ? (
                <ol className={styles.grid} aria-label={`${wall.label} public members`}>
                  {rows.map((row) => <MemberCard key={row.publicSlug} row={row} />)}
                </ol>
              ) : (
                <div className={styles.empty}>
                  <strong>No public members yet.</strong>
                  <p>Only members who have chosen public visibility appear on this wall.</p>
                </div>
              )}
            </div>
          );
        })}
      </section>

      <section className={styles.closing} aria-label="Access Wanterest">
        <p>Only members who have chosen to be visible are shown on this wall.</p>
        <div className={styles.actions}>
          <a className={styles.primaryAction} href={primaryAction.href}>{primaryAction.label} <span aria-hidden="true">→</span></a>
          <Link className={styles.secondaryAction} href="/">Explore Wanterest</Link>
        </div>
      </section>
    </main>
  );
}
