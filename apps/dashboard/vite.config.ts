import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import type { ProxyOptions } from 'vite';
import { defineConfig } from 'vitest/config';

type ProxyServer = Parameters<NonNullable<ProxyOptions['configure']>>[0];

/** The gateway as deployed in the local cluster; the dev server proxies the API to it. */
const GATEWAY_ORIGIN = 'http://app.localhost';
const DEV_PORT = 5173;
/** Origins the dev server itself is served from; only these (or no Origin at all) are rewritten. */
const DEV_ORIGINS = new Set([`http://localhost:${DEV_PORT}`, `http://127.0.0.1:${DEV_PORT}`]);

/**
 * The gateway's CSRF guard requires `Origin` to equal its public origin. In development the browser's
 * origin is the Vite server, so the proxy maps that one origin onto the public one. A foreign Origin is
 * passed through untouched, so the gateway still rejects cross-site requests: the guard is never loosened.
 */
const gatewayProxy = {
  target: GATEWAY_ORIGIN,
  changeOrigin: true,
  configure: (proxy: ProxyServer) => {
    proxy.on('proxyReq', (proxyReq, req) => {
      const origin = req.headers.origin;
      if (origin === undefined || DEV_ORIGINS.has(origin)) proxyReq.setHeader('origin', GATEWAY_ORIGIN);
    });
  },
} satisfies ProxyOptions;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: DEV_PORT,
    strictPort: true,
    proxy: { '/api': gatewayProxy, '/mcp': gatewayProxy },
  },
  build: { outDir: 'dist', sourcemap: false },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    // Unit tests only: Playwright e2e specs (Task 4.8) must never run under `npm test`.
    include: ['test/**/*.test.{ts,tsx}'],
  },
});
