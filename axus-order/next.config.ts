import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Don't auto-generate AGENTS.md / CLAUDE.md in the app dir (the monorepo has its own).
  agentRules: false,
};

export default nextConfig;
