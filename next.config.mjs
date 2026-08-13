import path from "node:path";
import { fileURLToPath } from "node:url";

/** @type {import('next').NextConfig} */
const nextConfig = {
  // A package-lock.json in C:\Users\rishi makes Next infer the home dir as the
  // root. fileURLToPath is required here: stripping the leading slash by hand
  // works for Windows' /C:/… but turns a Linux path into a relative one, which
  // Turbopack rejects.
  turbopack: {
    root: path.dirname(fileURLToPath(import.meta.url)),
  },

  images: {
    // Media is served straight from /public or a blob host; no loader needed
    unoptimized: true,
  },

  // Don't advertise the framework version to scanners
  poweredByHeader: false,

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Nobody should be able to frame the site — protects the dashboard
          // from clickjacking a logged-in admin into destructive actions.
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          // Stop browsers guessing a different content type than we sent,
          // which is what turns an uploaded file into an executable one.
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-DNS-Prefetch-Control", value: "on" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
          },
        ],
      },
      {
        // The dashboard and API must never be cached by a proxy or CDN
        source: "/(admin|api)/:path*",
        headers: [{ key: "Cache-Control", value: "no-store, must-revalidate" }],
      },
    ];
  },
};

export default nextConfig;
