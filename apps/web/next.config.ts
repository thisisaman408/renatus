import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@renatus/agents', '@renatus/db', '@renatus/llm', '@renatus/shared'],
  experimental: {
    // WebContainers needs cross-origin isolation headers to load.
    // The /replay-test route sets them via the headers() function below.
  },
  async headers() {
    return [
      {
        source: '/replay-test/:path*',
        headers: [
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          { key: 'Cross-Origin-Embedder-Policy', value: 'require-corp' },
        ],
      },
    ];
  },
};

export default nextConfig;
