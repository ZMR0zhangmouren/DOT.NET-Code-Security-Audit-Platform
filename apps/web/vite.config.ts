import path from 'node:path';
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@platform/shared': path.resolve(__dirname, '../../packages/shared/src/index.ts'),
    },
  },
  server: {
    port: 5180,
    proxy: {
      // 开发期把 /api 与 /socket.io 转到 nest 后端(端口见 apps/api/.env.example)
      '/api': { target: 'http://127.0.0.1:3030', changeOrigin: true },
      '/socket.io': { target: 'http://127.0.0.1:3030', ws: true, changeOrigin: true },
    },
  },
});