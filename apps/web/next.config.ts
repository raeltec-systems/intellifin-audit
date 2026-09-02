import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Railway runs the app from a slim container image (AD-11: web and worker are
  // separate containers built from this one repository).
  output: 'standalone',
  outputFileTracingRoot: new URL('../../', import.meta.url).pathname,
  // Workspace packages resolve to their built `dist` output through the `default`
  // condition in each package's `exports`; only the `types` condition points at
  // source. They are listed here so Next still compiles them in its own pipeline
  // (and so a source-resolving dev setup keeps working) rather than treating them
  // as opaque prebuilt externals.
  transpilePackages: [
    '@intellifin/domain',
    '@intellifin/application',
    '@intellifin/infrastructure',
  ],
  reactStrictMode: true,
  // `next dev` otherwise writes its own AGENTS.md and CLAUDE.md into apps/web. This
  // repository already owns both file names as the shared decision log and the agent
  // block, so a generated pair beside them is at best untracked noise and at worst a
  // second, contradictory set of instructions.
  agentRules: false,
};

export default nextConfig;
