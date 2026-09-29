import { admittedCohortPresentation, admissionMonth, admissionMonthLong } from "@/shared/member-presentation";
import { selectPublicMemberIdentity } from "./cohort-public.identity";
import { publicCohortRowSchema, type PublicCohortPass, type PrivatePublicProfile } from "./cohort-public.schemas";

/** Receives a current pass-visible read, never a wall row as publication authorization. */
export function publicMemberPassPresentation(profile: PublicCohortPass) {
  const row = publicCohortRowSchema.parse(profile);
  return {
    ...admittedCohortPresentation(row.cohort, row.number),
    displayName: row.displayName, headline: row.headline,
    admissionMonth: admissionMonth(row.assignedAt), admissionMonthLong: admissionMonthLong(row.assignedAt),
    identity: selectPublicMemberIdentity(row),
  };
}
/** Settings public-profile preview; caller already authorized the private profile query.
 * The permanent workspace badge uses workspaceCohortPresentation separately, even
 * when no public profile exists.
 * No public pass URL, automatic publication, allocation or implicit consent is created.
 */
export function privateMembershipPresentation(profile: PrivatePublicProfile | null) {
  if (!profile) return null;
  return {
    ...admittedCohortPresentation(profile.cohort, profile.number),
    displayName: profile.displayName, headline: profile.headline,
    admissionMonth: admissionMonth(profile.assignedAt), admissionMonthLong: admissionMonthLong(profile.assignedAt),
    identity: selectPublicMemberIdentity(profile),
    visibility: { wallVisible: profile.wallVisible, passVisible: profile.passVisible },
  };
}
