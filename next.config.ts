import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  distDir: process.env.PROCUREMENT_REVIEW_PROTOTYPE === "1" ? ".quotation-review-prototype-cache" : ".next",
  typescript: { tsconfigPath: process.env.PROCUREMENT_REVIEW_PROTOTYPE === "1" ? "tsconfig.quotation-review-prototype.json" : "tsconfig.json" },
  outputFileTracingIncludes: { "/api/**/*": ["./src/server/document-assets/**/*"] },
};

export default nextConfig;
