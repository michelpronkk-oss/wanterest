import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  // Share-card PNG routes read their brand fonts from disk at runtime.
  outputFileTracingIncludes: {
    "/share/**": ["./assets/fonts/*.ttf"],
  },
};

export default nextConfig;
