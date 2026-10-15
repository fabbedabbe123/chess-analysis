// Copies the Stockfish.js engine files from node_modules into public/engine so
// that they are served as static assets (same-origin Web Worker + WASM).
// Runs on `npm install` (postinstall) and can be run manually: npm run prepare:engine
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules', 'stockfish', 'bin');
const dest = join(root, 'public', 'engine');

// Lite single-threaded is the default (works everywhere, no special headers).
// Lite multi-threaded is used only when the page is cross-origin isolated.
const files = [
  'stockfish-19-lite-single.js',
  'stockfish-19-lite-single.wasm',
  'stockfish-19-lite.js',
  'stockfish-19-lite.wasm',
];

if (!existsSync(src)) {
  console.warn('[copy-engine] node_modules/stockfish/bin not found; skipping (run npm install first).');
  process.exit(0);
}

mkdirSync(dest, { recursive: true });
for (const f of files) {
  const from = join(src, f);
  if (!existsSync(from)) {
    console.error(`[copy-engine] missing engine file: ${from}`);
    process.exit(1);
  }
  copyFileSync(from, join(dest, f));
  const kb = (statSync(join(dest, f)).size / 1024).toFixed(0);
  console.log(`[copy-engine] ${f} (${kb} KB)`);
}
