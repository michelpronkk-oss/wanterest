import "server-only";

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

import { ShareCardArtwork, type ShareCardArtworkData } from "@/components/share-cards/share-card-artwork";
import { SHARE_CARD_DIMENSIONS, type ShareCardFormat } from "@/shared/share-card-presentation";

/*
 * Brand fonts for the PNG renderer (Satori cannot use the site's next/font files). OFL-licensed
 * TTFs live in assets/fonts; read once per server instance, as the Next.js OG docs recommend.
 */
const FONT_FILES = [
  { name: "Archivo", weight: 800, file: "Archivo-800.ttf" },
  { name: "Archivo", weight: 700, file: "Archivo-700.ttf" },
  { name: "Sora", weight: 600, file: "Sora-600.ttf" },
  { name: "Inter", weight: 400, file: "Inter-400.ttf" },
  { name: "Inter", weight: 700, file: "Inter-700.ttf" },
] as const;

let fontsPromise: Promise<{ name: string; data: Buffer; weight: 400 | 600 | 700 | 800; style: "normal" }[]> | null = null;

function loadFonts() {
  fontsPromise ??= Promise.all(FONT_FILES.map(async (font) => ({
    name: font.name,
    data: await readFile(join(process.cwd(), "assets/fonts", font.file)),
    weight: font.weight,
    style: "normal" as const,
  }))).catch((error) => {
    fontsPromise = null;
    throw error;
  });
  return fontsPromise;
}

export function shareCardFormat(value: string | null): ShareCardFormat {
  return value === "square" ? "square" : value === "landscape" ? "landscape" : "portrait";
}

export async function renderShareCardImage(data: ShareCardArtworkData, format: ShareCardFormat, headers: Record<string, string>) {
  const { width, height } = SHARE_CARD_DIMENSIONS[format];
  return new ImageResponse(<ShareCardArtwork data={data} format={format} />, {
    width,
    height,
    fonts: await loadFonts(),
    headers,
  });
}
