import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";

const nextConfig: NextConfig = {
  devIndicators: false,
  outputFileTracingIncludes: {
    "/api/**/*": ["./src/server/document-assets/**/*"],
    "/.well-known/workflow/v1/flow": ["./src/server/document-assets/**/*"],
  },
};

export default withWorkflow(nextConfig);
