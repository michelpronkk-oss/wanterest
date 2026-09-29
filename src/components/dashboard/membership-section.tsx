import { CohortBadge, FounderPassArtwork } from "@/components/members/member-identity";
import { AccessStatusChip, PublicationChip, WorkspaceActivity } from "@/components/members/member-identity-slots";
import { MemberWallCard } from "@/components/members/member-wall-card";
import type { PublicMemberIdentity } from "@/shared/public-member-identity";
import type { AdmittedCohort } from "@/shared/member-presentation";
import { PublicProfileEditor, type PublicProfileFormValues } from "./membership-settings";
import styles from "./membership-settings.module.css";

export type MembershipSectionData = {
  workspaceId: string;
  publicOrigin: string;
  /** From getWorkspaceCohortIdentityQuery -> workspaceCohortPresentation (private authority). */
  cohort:
    | { state: "unavailable" }
    | { state: "none"; workspaceStatus: "active" | "suspended" | "archived" }
    | { state: "member"; cohort: AdmittedCohort; number: number; workspaceStatus: "active" | "suspended" | "archived" };
  /** From the authorized private public-profile read; null when absent or not manageable. */
  profile: null | {
    form: PublicProfileFormValues;
    preview: { displayName: string; headline: string | null; admissionMonth: string; identity: PublicMemberIdentity; cohort: AdmittedCohort; number: number };
  };
};

/**
 * Apex 2.0 board 16 "Settings · Membership" + "Public profile settings".
 * Permanent identity comes from the private cohort query, never from public
 * profile data; editing the private profile is kept separate from the two
 * independent publication-consent switches.
 */
export function MembershipSection({ data }: { data: MembershipSectionData }) {
  const { cohort, profile } = data;
  return (
    <div className={styles.section}>
      <section className={styles.card} aria-labelledby="membership-heading">
        <h2 id="membership-heading" className={styles.kicker}>Membership</h2>
        {cohort.state === "unavailable" ? (
          <p className={styles.body} role="status">Membership identity is unavailable right now. Your permanent cohort is unchanged; try again shortly.</p>
        ) : (
          <div className={styles.rows}>
            <div className={styles.row}>
              <span className={styles.rowLabel}>Identity</span>
              <span className={styles.rowValue}>
                {cohort.state === "member" ? <><CohortBadge cohort={cohort.cohort} number={cohort.number} /><span className={styles.permanent}>Permanent</span></> : <span className={styles.body}>No permanent cohort. Founding 25 and Early 100 are assigned only at admission.</span>}
              </span>
            </div>
            {cohort.state === "member" ? (
              <div className={styles.row}>
                <span className={styles.rowLabel}>Access</span>
                <span className={styles.rowValue}><AccessStatusChip status="admitted" /></span>
              </div>
            ) : null}
            <div className={styles.row}>
              <span className={styles.rowLabel}>Activity</span>
              <span className={styles.rowValue}><WorkspaceActivity active={cohort.workspaceStatus === "active"} /></span>
            </div>
            {cohort.state === "member" ? (
              <div className={styles.row}>
                <span className={styles.rowLabel}>Publication</span>
                <span className={styles.rowValue}>
                  {profile ? <><PublicationChip surface="wall" visible={profile.form.wallVisible} /><PublicationChip surface="pass" visible={profile.form.passVisible} /></> : <span className={styles.body}>No public profile</span>}
                </span>
              </div>
            ) : null}
          </div>
        )}
      </section>

      {cohort.state === "member" && profile ? (
        <>
          <section className={styles.card} aria-labelledby="public-profile-heading">
            <h2 id="public-profile-heading" className={styles.kicker}>Public profile settings</h2>
            <PublicProfileEditor workspaceId={data.workspaceId} initial={profile.form} publicOrigin={data.publicOrigin} />
          </section>
          <section className={styles.card} aria-labelledby="public-preview-heading">
            <h2 id="public-preview-heading" className={styles.kicker}>Saved public preview</h2>
            <div className={styles.previewGrid}>
              <div className={styles.previewStack}>
                <span className={styles.previewLabel}>Members Wall card{profile.form.wallVisible ? "" : " · not currently on the wall"}</span>
                <MemberWallCard {...profile.preview} />
              </div>
              <div className={styles.previewStack}>
                <span className={styles.previewLabel}>Pass preview{profile.form.passVisible ? "" : " · pass is private"}</span>
                <FounderPassArtwork {...profile.preview} layout="compact" />
                <p className={styles.body}>Previews use your saved profile. Nothing here is published unless its switch is on.</p>
              </div>
            </div>
          </section>
        </>
      ) : cohort.state === "member" ? (
        <section className={styles.card} aria-labelledby="public-profile-heading">
          <h2 id="public-profile-heading" className={styles.kicker}>Public profile settings</h2>
          <p className={styles.body}>The public profile isn&rsquo;t available for this workspace yet, or your role can&rsquo;t manage it. Owners and admins can manage it once it has been initialized.</p>
        </section>
      ) : null}
    </div>
  );
}
