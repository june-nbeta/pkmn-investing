import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  // COB-812 local acceptance: keep the Neon serverless driver out of the server
  // bundle so it runs on raw Node (bundled WebSocket handling crashes on WS error).
  serverExternalPackages: ["@neondatabase/serverless"],
};

export default nextConfig;
