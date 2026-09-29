"use client";

import { useRef, useState } from "react";

import { ApexMark, ApexPlate } from "@/components/identity/apex-artwork";
import { admissionMonth } from "@/shared/member-presentation";
import type { PublicMemberIdentity } from "@/shared/public-member-identity";
import { MemberWallCard } from "./member-wall-card";
import styles from "./public-members-wall.module.css";

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
  primaryAction: { href: string; label: string; description?: string | null };
};

const WALLS: Array<{ key: WallKey; label: string }> = [
  { key: "founding", label: "Founding 25" },
  { key: "early", label: "Early 100" },
];

function MemberCard({ row }: { row: PublicMemberWallRow }) {
  return (
    <li className={styles.cardItem}>
      {/* wall_visible and pass_visible are deliberately independent consent flags. The
          public wall DTO does not expose pass visibility, so this card never links to
          or implies the separate public-pass route. */}
      <MemberWallCard cohort={row.cohort} number={row.number} displayName={row.displayName} headline={row.headline} admissionMonth={admissionMonth(row.assignedAt)} identity={row.identity} />
    </li>
  );
}

/** Apex 2.0 boards 06/07/08/17: /members, Founding 25 and Early 100 tabs, consent-safe empty state. */
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
        <div className={styles.eyebrow}><span aria-hidden="true" /> Public members wall</div>
        <h1 id="members-title">The first workspaces to find real demand.</h1>
        <p>Founding 25 and Early 100 are permanent. Only members who choose to be public appear here.</p>
        <div className={styles.tabs} role="tablist" aria-label="Public member cohorts">
          {WALLS.map((wall, index) => {
            const isActive = wall.key === activeWall;
            const fill = !isActive ? "muted" : wall.key === "founding" ? "founding-dark" : "early-dark";
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
                <ApexMark size={13} fill={fill} />
                {wall.label}
              </button>
            );
          })}
        </div>
      </header>

      <section className={styles.wallContent} aria-labelledby="wall-heading">
        <h2 id="wall-heading" className={styles.srOnly}>Public cohort members</h2>
        {WALLS.map((wall) => {
          const rows = wall.key === "founding" ? founding : early;
          return (
            <div key={wall.key} id={`${wall.key}-members-panel`} className={styles.panel} role="tabpanel" aria-labelledby={`${wall.key}-members-tab`} hidden={wall.key !== activeWall} tabIndex={0}>
              {rows.length ? (
                <ol className={styles.grid} aria-label={`${wall.label} public members`}>
                  {rows.map((row) => <MemberCard key={row.publicSlug} row={row} />)}
                </ol>
              ) : (
                <div className={styles.empty}>
                  <ApexPlate size={48} edition={wall.key} className={styles.emptyPlate} />
                  <strong>No public members yet.</strong>
                  <p>Only members who choose public visibility appear on the wall. {wall.label} identities exist whether or not they are shown here.</p>
                </div>
              )}
            </div>
          );
        })}
      </section>

      <section className={styles.closing} aria-label="Access Wanterest">
        <div>
          <p className={styles.closingTitle}>Real demand already exists.</p>
          {primaryAction.description ? <p className={styles.closingBody}>{primaryAction.description}</p> : null}
        </div>
        <a className={styles.primaryAction} href={primaryAction.href}>{primaryAction.label} <span aria-hidden="true">→</span></a>
      </section>
    </main>
  );
}
