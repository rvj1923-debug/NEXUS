/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  reactStrictMode: false,
  poweredByHeader: false,
  eslint: {
    ignoreDuringBuilds: false,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  // Keep compiled routes in memory for 24h so switching pages is instant
  onDemandEntries: {
    maxInactiveAge: 24 * 60 * 60 * 1000,
    pagesBufferLength: 100,
  },
  experimental: {
    optimizePackageImports: ["lucide-react"],
  },
};

export default nextConfig;

