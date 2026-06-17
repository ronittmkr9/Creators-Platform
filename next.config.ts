import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname),
  },
  allowedDevOrigins: ['192.168.30.148','0.0.0.0','192.168.254.14','localhost'],
  output: "standalone",
  serverExternalPackages: [
    "bcryptjs",
    "pg",
    "pg-native",
    "@prisma/client",
    "@prisma/adapter-pg",
  ],
  typescript: {
    ignoreBuildErrors: true,
  },
};

export default nextConfig;