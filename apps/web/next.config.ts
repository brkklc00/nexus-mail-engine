import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  experimental: {
    typedRoutes: true
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "i.ibb.co" }
    ]
  }
};

export default nextConfig;
