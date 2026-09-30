import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  outputFileTracingIncludes: { "/api/**/*": ["./src/server/document-assets/**/*"] },
};

export default nextConfig;
