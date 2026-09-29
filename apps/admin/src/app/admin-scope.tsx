import localFont from "next/font/local";
import type { ReactNode } from "react";
import "./styles.css";

const inter = localFont({ src: "../../../../assets/fonts/Inter-400.ttf", variable: "--font-inter", weight: "400", display: "swap" });
const interBold = localFont({ src: "../../../../assets/fonts/Inter-700.ttf", variable: "--font-inter-bold", weight: "700", display: "swap" });
const sora = localFont({ src: "../../../../assets/fonts/Sora-600.ttf", variable: "--font-sora", weight: "600", display: "swap" });
const archivo = localFont({ src: "../../../../assets/fonts/Archivo-700.ttf", variable: "--font-archivo", weight: "700", display: "swap" });

export function AdminScope({ children }: Readonly<{ children: ReactNode }>) {
  return <div className={`admin-scope ${inter.variable} ${interBold.variable} ${sora.variable} ${archivo.variable}`}>{children}</div>;
}
