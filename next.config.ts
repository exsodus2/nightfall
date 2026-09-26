import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  devIndicators: false,
  // Mobile testing: let a phone on the LAN (`next dev --hostname 0.0.0.0`, then http://<PC IP>:3000) or a
  // Cloudflare / ngrok tunnel load the dev server's scripts and HMR socket (blocked cross-origin by default).
  allowedDevOrigins: ["192.168.*.*", "10.*.*.*", "172.*.*.*", "*.local", "*.trycloudflare.com", "*.ngrok-free.app", "*.ngrok.app"],
};

export default nextConfig;
