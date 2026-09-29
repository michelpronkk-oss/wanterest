import { ApexMark } from "@/components/identity/apex-artwork";
import { LogoMark } from "@/components/dashboard/nav-icons";
import type { PublicMemberIdentity } from "@/shared/public-member-identity";
import { admittedCohortPresentation, type AdmittedCohort, type IdentityTone } from "@/shared/member-presentation";
import { MemberIdentity } from "./member-identity-client";
import styles from "./founder-pass.module.css";

export type FounderPassLayout = "horizontal" | "vertical" | "compact";

export type FounderPassArtworkProps = {
  cohort: AdmittedCohort;
  number: number;
  identity: PublicMemberIdentity;
  displayName: string;
  className?: string;
  /** Retained for interface compatibility; pass surfaces are defined by the cohort edition. */
  size?: number;
  tone?: IdentityTone;
  headline?: string | null;
  /** "Sep 2026" (existing presentation field). */
  admissionMonth?: string | null;
  /** "September 2026" — preferred on the pass when supplied. */
  admissionMonthLong?: string | null;
  layout?: FounderPassLayout;
  /** Board 14 appearance motion (static under prefers-reduced-motion). */
  animate?: boolean;
};

const EDITION_LABEL: Record<AdmittedCohort, string> = { founding_25: "FOUNDING MEMBER", early_100: "EARLY 100 MEMBER" };
const COMPACT_LABEL: Record<AdmittedCohort, string> = { founding_25: "FOUNDING", early_100: "EARLY 100" };

/**
 * Apex 2.0 Founder Pass (board 09) and Early 100 Public Pass (board 10).
 * A permanent artifact, not a credential. A caller must already hold a current
 * pass-visible public DTO; this component cannot authorize or publish a pass.
 * Every value is injected from that DTO; nothing is baked into artwork.
 */
export function FounderPassArtwork({ cohort, number, identity, displayName, className, headline, admissionMonth, admissionMonthLong, layout = "horizontal", animate = false }: FounderPassArtworkProps) {
  const presentation = admittedCohortPresentation(cohort, number);
  const edition = cohort === "founding_25" ? "founding" : "early";
  const apexFill = cohort === "founding_25" ? "founding-dark" : "early-light";
  const tone: IdentityTone = cohort === "founding_25" ? "dark" : "light";
  const admitted = admissionMonthLong ?? admissionMonth ?? null;
  const serialOf = `No. ${presentation.digits} of ${presentation.limit}`;
  const rootProps = {
    className: [styles.pass, className].filter(Boolean).join(" "),
    "data-founder-pass-artwork": true,
    "data-cohort": cohort,
    "data-cohort-number": number,
    "data-serial": presentation.serial,
    "data-edition": edition,
    "data-layout": layout,
    "data-animate": animate ? "appear" : undefined,
    "data-public-headline": headline ?? undefined,
    "data-admission-month": admissionMonth ?? undefined,
    "aria-label": `${displayName}, ${presentation.label} ${presentation.serial} public pass`,
  };
  const serial = (
    <span className={styles.serial} aria-hidden="true">
      <span className={styles.serialDigits}>{presentation.digits}</span>
      <span className={styles.serialTotal}>/{presentation.limit}</span>
    </span>
  );
  const wordmark = (
    <span className={styles.wordmark}><LogoMark size={layout === "vertical" ? 14 : 15} /><span>wanterest</span></span>
  );

  if (layout === "compact") {
    return (
      <article {...rootProps}>
        <span className={styles.compactSerial} aria-hidden="true">
          <span className={styles.serialDigits}>{presentation.digits}</span>
          <span className={styles.serialTotal}>/{presentation.limit}</span>
        </span>
        <span className={styles.compactDivider} aria-hidden="true" />
        <span className={styles.compactBody}>
          <span className={styles.compactLabel}><ApexMark size={12} fill={apexFill} /><span>{COMPACT_LABEL[cohort]}</span></span>
          <span className={styles.compactName}>{displayName}</span>
        </span>
      </article>
    );
  }

  if (layout === "vertical") {
    return (
      <article {...rootProps}>
        <div className={styles.header}><ApexMark size={20} fill={apexFill} /><span>{EDITION_LABEL[cohort]}</span></div>
        <div className={styles.verticalSerial}>{serial}</div>
        <div className={styles.verticalIdentity}>
          <MemberIdentity identity={identity} size={44} tone={tone} />
          <div className={styles.identityCopy}>
            <strong className={styles.nameVertical}>{displayName}</strong>
            {admitted ? <span className={styles.subtle}>Admitted {admitted}</span> : null}
          </div>
        </div>
        <div className={styles.verticalFooter}>{wordmark}<span className={styles.subtle}>{serialOf}</span></div>
      </article>
    );
  }

  return (
    <article {...rootProps}>
      <div className={styles.primary}>
        <div className={styles.header}><ApexMark size={22} fill={apexFill} /><span>{EDITION_LABEL[cohort]}</span></div>
        {serial}
      </div>
      <div className={styles.aside}>
        <div className={styles.asideIdentity}>
          <MemberIdentity identity={identity} size={52} tone={tone} />
          <div className={styles.identityCopy}>
            <strong className={styles.nameHorizontal}>{displayName}</strong>
            {headline ? <span className={styles.headline}>{headline}</span> : null}
          </div>
        </div>
        <dl className={styles.facts}>
          <div><dt>Cohort</dt><dd>{presentation.label}</dd></div>
          <div><dt>Serial</dt><dd>{serialOf}</dd></div>
          {admitted ? <div><dt>Admitted</dt><dd>{admitted}</dd></div> : null}
        </dl>
        <div className={styles.asideFooter}>{wordmark}<span className={styles.subtle}>Permanent</span></div>
      </div>
    </article>
  );
}
