// Downloads the piece sets used by the board into public/pieces/<set>/<wK>.svg.
// The files are committed with the project, so this only needs to run to refresh them.
// Licenses: cburnett GPLv2+, merida GPLv2+, chessnut Apache-2.0, rhosgfx CC0-1.0
// (sources: https://github.com/lichess-org/lila/tree/master/public/piece, see COPYING.md there).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sets = ['cburnett', 'merida', 'chessnut', 'rhosgfx'];
const names = ['wK', 'wQ', 'wR', 'wB', 'wN', 'wP', 'bK', 'bQ', 'bR', 'bB', 'bN', 'bP'];
const base = 'https://raw.githubusercontent.com/lichess-org/lila/master/public/piece';

let failed = 0;
for (const set of sets) {
  mkdirSync(join(root, 'public', 'pieces', set), { recursive: true });
  for (const name of names) {
    const res = await fetch(`${base}/${set}/${name}.svg`);
    if (!res.ok) {
      console.error(`FAILED ${set}/${name}.svg (${res.status})`);
      failed += 1;
      continue;
    }
    writeFileSync(join(root, 'public', 'pieces', set, `${name}.svg`), Buffer.from(await res.arrayBuffer()));
  }
  console.log(`ok ${set}`);
}
process.exit(failed === 0 ? 0 : 1);
