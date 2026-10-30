import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  agentRules: false,
  serverExternalPackages: ["pdfjs-dist", "@napi-rs/canvas"],
  // A phone on the office Wi-Fi loads this address and sends it as Origin.
  // Without this, the dev server returns 403 for the stylesheet and scripts.
  allowedDevOrigins: ["192.168.*.*"],
  // The proxy buffers each request body. Its 10 MB default would cut short the 12 MB uploads staff and clients may send.
  experimental: { proxyClientMaxBodySize: "13mb" },
};

export default nextConfig;
