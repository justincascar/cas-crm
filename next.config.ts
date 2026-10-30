import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  agentRules: false,
  serverExternalPackages: ["pdfjs-dist", "@napi-rs/canvas"],
  // A phone on the office Wi-Fi loads this address and sends it as Origin.
  // Without this, the dev server returns 403 for the stylesheet and scripts.
  allowedDevOrigins: ["192.168.*.*"],
  // The proxy buffers each request body. Its 10 MB default would cut short the 12 MB uploads staff and clients may send.
  experimental: { proxyClientMaxBodySize: "13mb" },
  // J15: safe security headers on every page and file.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'self'; base-uri 'self'; form-action 'self'; object-src 'none'" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "Permissions-Policy", value: "geolocation=(), microphone=(), payment=(), usb=()" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        ],
      },
      // Stored files are never run or framed. These come last so they win over the headers above for these addresses.
      ...["/documents/:id/file", "/claims/:id/client-form/file/:upload"].map((source) => ({
        source,
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "sandbox; frame-ancestors 'none'" },
        ],
      })),
    ];
  },
};

export default nextConfig;
