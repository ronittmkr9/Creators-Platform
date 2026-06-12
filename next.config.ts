import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname),
  },
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