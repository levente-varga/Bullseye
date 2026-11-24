import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // The PDF route reads its embedded fonts from disk: ship them with that function.
  outputFileTracingIncludes: { "/api/drafts/[id]/pdf": ["./src/lib/pdf/fonts/**"] },
  partialPrefetching: true,
  experimental: {
    // CV uploads go through a server action; the default 1 MB is too small for a PDF.
    serverActions: { bodySizeLimit: "6mb" },
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
