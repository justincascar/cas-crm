import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  agentRules: false,
  serverExternalPackages: ["pdfjs-dist", "@napi-rs/canvas"],
  // A phone on the office Wi-Fi loads this address and sends it as Origin.
  // Without this, the dev server returns 403 for the stylesheet and scripts.
  allowedDevOrigins: ["192.168.*.*"],
};

export default nextConfig;
