import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lets the Playwright server build into its own folder, so it never collides with `npm run dev`.
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;
