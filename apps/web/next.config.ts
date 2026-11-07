import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { NextConfig } from "next";

// Load the repository-root `.env` so one file configures web and scanner. Existing variables win.
const rootEnv = resolve(process.cwd(), "../../.env");
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const nextConfig: NextConfig = {
  output: "export",
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ["@veriq/contracts", "@veriq/analysis"],
  images: {
    unoptimized: true,
  },
};
export default nextConfig;
