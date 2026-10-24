import type { NextConfig } from "next";
import { loadRedirects } from "./src/lib/seo/redirects";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  // Cache Components is intentionally off: catalogue pages read the database
  // per request so the build never needs a database connection. See
  // docs/architecture.md ("Rendering and caching").
  poweredByHeader: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  images: {
    formats: ["image/avif", "image/webp"],
    qualities: [75, 85],
  },
  serverExternalPackages: ["sharp"],
  experimental: {
    serverActions: {
      // Inspiration-image uploads go through a Server Action.
      bodySizeLimit: "26mb",
    },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  async redirects() {
    return loadRedirects();
  },
};

export default nextConfig;
