"use client";

import { useEffect, useRef, useState } from "react";

import { SHARE_CARD_DIMENSIONS, type ShareCardFormat } from "@/shared/share-card-presentation";
import { SHARE_CARD_PAGE_FONTS, ShareCardArtwork, type ShareCardArtworkData } from "./share-card-artwork";

/**
 * The exact artwork the PNG routes render, laid out at native size and scaled to the column
 * width, so the private preview and the public page show the card precisely as it will be shared.
 */
export function ShareCardPreview({ data, format = "landscape", label }: { data: ShareCardArtworkData; format?: ShareCardFormat; label: string }) {
  const frameRef = useRef<HTMLDivElement>(null);
  const { width, height } = SHARE_CARD_DIMENSIONS[format];
  const [scale, setScale] = useState(0);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const update = () => setScale(frame.clientWidth / width);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [width]);

  return (
    <div ref={frameRef} className="share-card-preview" style={{ aspectRatio: `${width} / ${height}` }} role="img" aria-label={label}>
      <div className="share-card-preview-canvas" style={{ width, height, transform: `scale(${scale})`, visibility: scale ? "visible" : "hidden" }} aria-hidden="true">
        <ShareCardArtwork data={data} format={format} fonts={SHARE_CARD_PAGE_FONTS} />
      </div>
    </div>
  );
}
