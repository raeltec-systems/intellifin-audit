import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Railway runs the app from a slim container image (AD-11: web and worker are
  // separate containers built from this one repository).
  output: 'standalone',
  outputFileTracingRoot: new URL('../../', import.meta.url).pathname,
  // Workspace packages ship TypeScript source; Next compiles them in place.
  transpilePackages: [
    '@intellifin/domain',
    '@intellifin/application',
    '@intellifin/infrastructure',
  ],
  reactStrictMode: true,
};

export default nextConfig;
