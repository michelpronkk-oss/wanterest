import Link from "next/link";

import type { PublicMemberIdentity } from "@/shared/public-member-identity";
import type { AdmittedCohortPresentation } from "@/shared/member-presentation";
import { CopyPassLink } from "./copy-pass-link";
import { FounderPassArtwork } from "./founder-pass";
import { MemberIdentity } from "./member-identity-client";
import { CohortBadge } from "./member-identity-slots";
import styles from "./member-profile.module.css";

export type MemberProfilePresentation = AdmittedCohortPresentation & {
  displayName: string;
  headline: string | null;
  admissionMonth: string;
  admissionMonthLong: string;
  identity: PublicMemberIdentity;
};

/**
 * Apex 2.0 boards 11 (desktop) and 12 (mobile) public member profile. Receives
 * the output of `publicMemberPassPresentation` for a current pass-visible read;
 * it cannot authorize publication. "Share pass" is intentionally absent: public
 * sharing belongs to the unreleased 13B layer and stays inactive here.
 */
export function MemberProfileView({ presentation, canonicalUrl, websiteUrl }: { presentation: MemberProfilePresentation; canonicalUrl: string; websiteUrl: string | null }) {
  const serialOf = `No. ${presentation.digits} of ${presentation.limit}`;
  return (
    <main className={styles.profile} aria-labelledby="member-pass-title">
      <nav className={styles.breadcrumb} aria-label="Breadcrumb">
        <ol>
          <li><Link href="/members">Members</Link></li>
          <li aria-hidden="true">/</li>
          <li>{presentation.label}</li>
          <li aria-hidden="true">/</li>
          <li aria-current="page">No. {presentation.digits}</li>
        </ol>
      </nav>

      <header className={styles.header}>
        <div className={styles.identity}>
          <span className={styles.identityDesktop}><MemberIdentity identity={presentation.identity} size={96} /></span>
          <span className={styles.identityMobile}><MemberIdentity identity={presentation.identity} size={64} /></span>
          <div className={styles.identityCopy}>
            <h1 id="member-pass-title">{presentation.displayName}</h1>
            {presentation.headline ? <p className={styles.headline}>{presentation.headline}</p> : null}
            <div className={styles.badgeRow}>
              <CohortBadge cohort={presentation.cohort} number={presentation.number} />
              <span className={styles.admitted}>Admitted {presentation.admissionMonthLong}</span>
            </div>
          </div>
        </div>
        <div className={styles.actions}>
          <CopyPassLink url={canonicalUrl} className={styles.secondaryButton} />
        </div>
      </header>

      <div className={styles.passHorizontal}><FounderPassArtwork {...presentation} layout="horizontal" animate /></div>
      <div className={styles.passVertical}><FounderPassArtwork {...presentation} layout="vertical" animate /></div>

      <dl className={styles.facts}>
        <div><dt>Cohort</dt><dd>{presentation.label}</dd></div>
        <div><dt>Serial</dt><dd>{serialOf}</dd></div>
        <div><dt>Admitted</dt><dd>{presentation.admissionMonthLong}</dd></div>
      </dl>

      <div className={styles.mobileActions}>
        <CopyPassLink url={canonicalUrl} className={styles.secondaryButton} />
      </div>

      <footer className={styles.note}>
        {websiteUrl ? <a href={websiteUrl} rel="noreferrer">Visit website</a> : null}
        <p>This public pass represents workspace cohort provenance. It is not an access token, invitation, or billing credential.</p>
      </footer>
    </main>
  );
}
