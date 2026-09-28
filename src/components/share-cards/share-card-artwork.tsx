type ShareCardArtworkData = {
  variant: "EARLY_ACCESS" | "PRIORITY_ACCESS" | "FOUNDING_25" | "EARLY_100" | "SIGNAL" | "DEMAND_GAP" | "DEMAND_DRIFT";
  displayName: string | null;
  headline: string | null;
  identityLabel: string;
  identityNumber: number | null;
  tone: "neutral" | "priority" | "founding" | "early" | "signal" | "gap" | "drift";
  cardKind?: "identity" | "intelligence";
  claim?: string | null;
  evidence?: string | null;
  evidenceStrength?: string | null;
  contextLabel?: string | null;
  freshnessLabel?: string | null;
  sourceLabel?: string | null;
};

export function shareCardIdentity(data: Pick<ShareCardArtworkData, "variant" | "identityNumber">): string {
  if (data.identityNumber === null) return "PRIORITY";
  const width = data.variant === "FOUNDING_25" ? 2 : data.variant === "EARLY_100" ? 3 : 4;
  return `#${String(data.identityNumber).padStart(width, "0")}`;
}

export function ShareCardArtwork({ data }: { data: ShareCardArtworkData }) {
  const intelligence = data.cardKind === "intelligence";
  const dark = data.tone === "founding" || data.tone === "drift";
  const background = intelligence ? (data.tone === "drift" ? "#171814" : "#eef2e7") : dark ? "#171814" : data.tone === "priority" ? "#edf5d4" : "#f5f4ee";
  const foreground = dark ? "#f5f4ee" : "#171814";
  const muted = dark ? "rgba(245,244,238,0.62)" : "#6f7068";
  const accent = dark ? "#d7ff3d" : data.tone === "priority" ? "#789b18" : data.tone === "gap" ? "#9a6b24" : "#5d7c61";
  if (intelligence) {
    return (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "7.5%", backgroundColor: background, color: foreground, fontFamily: "Arial, sans-serif" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 24, letterSpacing: "0.18em", fontWeight: 700 }}>
          <span>WANTEREST</span><span style={{ color: accent, fontSize: 18, letterSpacing: "0.12em" }}>INTELLIGENCE</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: "88%" }}>
          <div style={{ color: accent, fontSize: 20, letterSpacing: "0.16em", fontWeight: 700 }}>{data.identityLabel.toUpperCase()}</div>
          <div style={{ fontSize: 38, fontWeight: 700, lineHeight: 1.05, letterSpacing: "-0.03em" }}>{data.claim ?? data.headline ?? "Evidence-backed market intelligence"}</div>
          <div style={{ color: muted, fontSize: 21, lineHeight: 1.25 }}>{data.evidence ?? "Shared with explicit workspace consent."}</div>
          <div style={{ display: "flex", gap: 22, color: muted, fontSize: 16 }}>
            <span>{data.evidenceStrength ?? "Evidence-backed"}</span><span>{data.freshnessLabel ?? "Current context"}</span>
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 24 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}><span style={{ fontSize: 20, fontWeight: 700 }}>{data.contextLabel ?? "Market intelligence"}</span><span style={{ color: muted, fontSize: 17 }}>{data.sourceLabel ?? "Evidence, context, and uncertainty"}</span></div>
          <span style={{ color: muted, fontSize: 17 }}>wanterest.com</span>
        </div>
      </div>
    );
  }
  const label = data.identityNumber === null ? "CURRENT STATUS" : data.variant === "EARLY_ACCESS" ? "VERIFIED IDENTITY" : "PERMANENT IDENTITY";
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "7.5%", backgroundColor: background, color: foreground, fontFamily: "Arial, sans-serif" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 24, letterSpacing: "0.18em", fontWeight: 700 }}>
        <span>WANTEREST</span>
        <span style={{ color: accent, fontSize: 18, letterSpacing: "0.14em" }}>SHARE CARD</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
        <div style={{ color: accent, fontSize: 22, letterSpacing: "0.2em", fontWeight: 700 }}>{label}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 44, fontWeight: 700, letterSpacing: "-0.03em" }}>{data.identityLabel}</div>
          <div style={{ color: muted, fontSize: 24 }}>{data.headline ?? "Shared with consent."}</div>
        </div>
        <div style={{ color: accent, fontSize: data.identityNumber === null ? 54 : 112, fontWeight: 800, letterSpacing: "-0.06em", lineHeight: 0.95 }}>{shareCardIdentity(data)}</div>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 24 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          <span style={{ fontSize: 20, fontWeight: 700 }}>{data.displayName ?? "Wanterest member"}</span>
          <span style={{ color: muted, fontSize: 17 }}>Demand intelligence with evidence.</span>
        </div>
        <span style={{ color: muted, fontSize: 17 }}>wanterest.com</span>
      </div>
    </div>
  );
}

export type { ShareCardArtworkData };
