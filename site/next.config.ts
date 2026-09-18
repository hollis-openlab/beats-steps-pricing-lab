import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  async rewrites() {
    return [{ source: '/api/lab/:path*', destination: 'http://127.0.0.1:4318/:path*' }];
  },
};

export default nextConfig;
