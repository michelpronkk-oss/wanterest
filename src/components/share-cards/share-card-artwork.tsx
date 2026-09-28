type ShareCardArtworkData = {
  variant: "EARLY_ACCESS" | "PRIORITY_ACCESS" | "FOUNDING_25" | "EARLY_100";
  displayName: string | null;
  headline: string | null;
  identityLabel: string;
  identityNumber: number | null;
  tone: "neutral" | "priority" | "founding" | "early";
};

export function shareCardIdentity(data: Pick<ShareCardArtworkData, "variant" | "identityNumber">): string {
  if (data.identityNumber === null) return "PRIORITY";
  const width = data.variant === "FOUNDING_25" ? 2 : data.variant === "EARLY_100" ? 3 : 4;
  return `#${String(data.identityNumber).padStart(width, "0")}`;
}

export function ShareCardArtwork({ data }: { data: ShareCardArtworkData }) {
  const dark = data.tone === "founding";
  const background = dark ? "#171814" : data.tone === "priority" ? "#edf5d4" : "#f5f4ee";
  const foreground = dark ? "#f5f4ee" : "#171814";
  const muted = dark ? "rgba(245,244,238,0.62)" : "#6f7068";
  const accent = dark ? "#d7ff3d" : data.tone === "priority" ? "#789b18" : "#8e9c74";
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
