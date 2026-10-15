/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// COOP/COEP make the page cross-origin isolated so the multi-threaded Stockfish
// build (SharedArrayBuffer) can be used. If the app is hosted without these
// headers, the engine layer automatically falls back to the single-threaded build.
const isolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: { headers: isolationHeaders, host: true },
  preview: { headers: isolationHeaders, host: true },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
