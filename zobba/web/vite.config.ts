import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { protectProxyErrors } from './proxy-errors.ts';

export default defineConfig({
  plugins: [react()],
  server: {
    host: 'localhost',
    port: 5173,
    strictPort: true,
    https: process.env.ZOBBA_LOCAL_TLS_KEY && process.env.ZOBBA_LOCAL_TLS_CERT ? {
      key: readFileSync(process.env.ZOBBA_LOCAL_TLS_KEY),
      cert: readFileSync(process.env.ZOBBA_LOCAL_TLS_CERT),
    } : undefined,
    proxy: {
      '/api': {
        target: process.env.ZOBBA_API_PROXY_TARGET ?? 'http://127.0.0.1:4310',
        rewrite: (path) => path.replace(/^\/api(?=\/)/, ''),
        configure: protectProxyErrors,
      },
    },
  },
});
