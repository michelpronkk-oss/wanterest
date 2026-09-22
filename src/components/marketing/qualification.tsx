function HeartIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 20.2 4.7 13a5.15 5.15 0 0 1 7.3-7.28A5.15 5.15 0 0 1 19.3 13L12 20.2Z" />
    </svg>
  );
}

function MoreIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor" aria-hidden="true">
      <circle cx="3.5" cy="9" r="1.5" />
      <circle cx="9" cy="9" r="1.5" />
      <circle cx="14.5" cy="9" r="1.5" />
    </svg>
  );
}

function SignalIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="2" y="8" width="2.5" height="6" rx="0.6" fill="currentColor" />
      <rect x="6.7" y="5" width="2.5" height="9" rx="0.6" fill="currentColor" />
      <rect x="11.4" y="2" width="2.5" height="12" rx="0.6" fill="currentColor" />
    </svg>
  );
}

function QualificationMeta({ likes }: { likes: string }) {
  return (
    <div className="marketing-qualification-meta">
      <div className="marketing-qualification-likes"><HeartIcon /> <span>{likes}</span></div>
      <MoreIcon />
    </div>
  );
}

export function QualificationSection() {
  return (
    <section className="marketing-section marketing-qualification-section is-tight is-alt">
      <div className="marketing-section-inner marketing-qualification-inner">
        <div className="marketing-section-eyebrow">QUALIFICATION</div>
        <h2 className="marketing-heading marketing-qualification-title">Not every mention is demand.</h2>
        <p className="marketing-qualification-subtitle">Popularity doesn&rsquo;t create demand. Intent does.</p>
        <div className="marketing-qualification-grid">
          <article className="marketing-qualification-card">
            <QualificationMeta likes="500K likes" />
            <p className="marketing-qualification-quote">&ldquo;HubSpot lol&rdquo;</p>
            <span className="marketing-qualification-tag">NOT A SIGNAL</span>
          </article>
          <article className="marketing-qualification-card is-featured">
            <QualificationMeta likes="2 likes" />
            <p className="marketing-qualification-quote">
              &ldquo;Looking for a cheaper <mark>HubSpot</mark> alternative with SSO&rdquo;
            </p>
            <span className="marketing-qualification-tag is-strong"><SignalIcon /> HIGH-CONFIDENCE SIGNAL</span>
          </article>
        </div>
      </div>
    </section>
  );
}
