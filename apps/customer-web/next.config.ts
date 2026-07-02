import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@comop/platform", "@comop/cleaning"],
};

export default nextConfig;
