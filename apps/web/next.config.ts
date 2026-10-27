import type { NextConfig } from "next";

/**
 * Static security headers. The Content-Security-Policy is NOT set here: it
 * needs a per-request nonce, so it is generated in `src/proxy.ts`.
 */
const securityHeaders = [
  {
    key: "Strict-Transport-Security",
    // Add `preload` after a month without problems (docs/03 §2.11).
    value: "max-age=63072000; includeSubDomains",
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    // clipboard-read is needed for the Paste button on our own origin only.
    value: [
      "camera=()",
      "microphone=()",
      "geolocation=()",
      "payment=()",
      "usb=()",
      "browsing-topics=()",
      "clipboard-read=(self)",
      "clipboard-write=(self)",
    ].join(", "),
  },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  // Cache Components / Partial Prerendering are intentionally off: every page
  // is rendered per request so the CSP nonce from proxy.ts can be applied.
  poweredByHeader: false,
  reactStrictMode: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // The home page hosts the result and download views: send no referrer
      // at all from there (docs/03 §2.11). Later rules override earlier ones.
      { source: "/", headers: [{ key: "Referrer-Policy", value: "no-referrer" }] },
      // Converter pages are cross-origin isolated so LibRaw (camera RAW) can use
      // threads. They load nothing from other sites, so nothing breaks. Workers
      // they start must send the same header. On Cloudflare, static files get
      // these from public/_headers instead.
      ...["/convert/:path*", "/vendor/:path*", "/frames/:path*", "/_next/static/:path*"].map((source) => ({
        source,
        headers: [{ key: "Cross-Origin-Embedder-Policy", value: "require-corp" }],
      })),
      // The Word converter renders documents in a same-origin frame (public/frames).
      { source: "/frames/:path*", headers: [{ key: "X-Frame-Options", value: "SAMEORIGIN" }] },
    ];
  },
};

export default nextConfig;
