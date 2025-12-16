import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: "5mb",
    },
  },
  // Ensure Linear SDK and its dependencies are not bundled for client
  serverExternalPackages: ["@linear/sdk"],
  webpack: (config, { isServer }) => {
    // Handle encoding module for Linear SDK
    // The encoding module is a Node.js built-in that's not available in the browser
    if (!isServer) {
      // Mark encoding as external for client-side bundle
      config.resolve.fallback = {
        ...config.resolve.fallback,
        encoding: false,
      };
    }
    return config;
  },
};

export default nextConfig;

