import type { NextConfig } from 'next';

/**
 * Cross-origin isolation headers — required so `SharedArrayBuffer` is exposed
 * to client code, which is the prerequisite for the WebContainers SDK to boot.
 * The /replay/* page mounts WebContainers; /replay-test/* keeps the original
 * Wave-1 smoke-test route working. /kg/* doesn't strictly need isolation but
 * inherits the same set so the canvas snapshot button can use OffscreenCanvas
 * without cross-origin restrictions in browsers that gate it.
 *
 * The header values are exactly:
 *   Cross-Origin-Embedder-Policy: require-corp
 *   Cross-Origin-Opener-Policy:   same-origin
 *
 * See SYSTEM-DESIGN.md §12.
 */
const ISOLATED_ROUTES = [
  '/replay/:path*',
  '/replay-test/:path*',
  '/kg/:path*',
];

const COI_HEADERS = [
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'Cross-Origin-Embedder-Policy', value: 'require-corp' },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@renatus/agents', '@renatus/db', '@renatus/llm', '@renatus/shared'],
  async headers() {
    return ISOLATED_ROUTES.map((source) => ({
      source,
      headers: COI_HEADERS,
    }));
  },
};

export default nextConfig;
