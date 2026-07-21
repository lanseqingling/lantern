import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Vinext reads this setting for Route Handlers as well. Without it, its
    // default 1 MB request limit rejects ordinary comic reference images
    // before the 50 MB application-level upload validation can run.
    serverActions: {
      bodySizeLimit: "60mb",
    },
    proxyClientMaxBodySize: "60mb",
  },
};

export default nextConfig;
