/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';

// COOP/COEP make the page cross-origin isolated so the multi-threaded Stockfish
// build (SharedArrayBuffer) can be used. If the app is hosted without these
// headers, the engine layer automatically falls back to the single-threaded build.
const isolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

// Shown as a small marker in the corner of the app so it is obvious which version is loaded:
// the short commit hash plus the build time (UTC).
function buildId(): string {
  let sha = (process.env['GITHUB_SHA'] ?? '').slice(0, 7);
  if (sha === '') {
    try {
      sha = execSync('git rev-parse --short=7 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    } catch {
      sha = 'dev';
    }
  }
  return `${sha} · ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

export default defineConfig({
  define: { __BUILD_ID__: JSON.stringify(buildId()) },
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
