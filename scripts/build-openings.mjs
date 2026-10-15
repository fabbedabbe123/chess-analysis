// Builds public/data/openings.json from the Lichess chess-openings TSV files (CC0 / public domain):
//   https://github.com/lichess-org/chess-openings
// Input:  data-src/{a,b,c,d,e}.tsv  (eco <tab> name <tab> pgn)
// Output: { entries, index, next }
//   entries: [eco, name, "uci uci uci ..."]            one per named line
//   index:   positionKey -> [entry index, ...]          names that END at exactly this position
//   next:    positionKey -> [[uci, entry index], ...]   book continuations from this position;
//                                                       the entry is the shortest named line using that move
// positionKey = first four FEN fields (placement, side, castling, en passant), so the
// lookup is by POSITION and therefore transposition-aware.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Chess } from 'chess.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const key = (fen) => fen.split(' ').slice(0, 4).join(' ');

const entries = [];
for (const letter of ['a', 'b', 'c', 'd', 'e']) {
  const text = readFileSync(join(root, 'data-src', `${letter}.tsv`), 'utf8');
  const lines = text.split('\n').slice(1).filter((l) => l.trim().length > 0);
  for (const line of lines) {
    const [eco, name, pgn] = line.split('\t');
    if (!eco || !name || !pgn) throw new Error(`Bad line in ${letter}.tsv: ${line}`);
    const chess = new Chess();
    const uci = [];
    const sans = pgn.replace(/\d+\.(\.\.)?/g, ' ').split(/\s+/).filter(Boolean);
    for (const san of sans) {
      const move = chess.move(san); // throws if the dataset ever contains an illegal line
      uci.push(`${move.from}${move.to}${move.promotion ?? ''}`);
    }
    entries.push({ eco, name, uci });
  }
}

const index = {};
const nextBest = {}; // key -> uci -> entry index (shortest line wins)
entries.forEach((entry, i) => {
  const chess = new Chess();
  entry.uci.forEach((uci, ply) => {
    const k = key(chess.fen());
    const bucket = (nextBest[k] ??= {});
    const current = bucket[uci];
    if (current === undefined || entries[current].uci.length > entry.uci.length) bucket[uci] = i;
    chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4) || undefined });
    if (ply === entry.uci.length - 1) (index[key(chess.fen())] ??= []).push(i);
  });
});

const next = {};
for (const [k, moves] of Object.entries(nextBest)) {
  next[k] = Object.entries(moves).sort((a, b) => a[1] - b[1]);
}

const out = {
  entries: entries.map((e) => [e.eco, e.name, e.uci.join(' ')]),
  index,
  next,
};
mkdirSync(join(root, 'public', 'data'), { recursive: true });
const file = join(root, 'public', 'data', 'openings.json');
writeFileSync(file, JSON.stringify(out));
console.log(`openings: ${entries.length} lines, ${Object.keys(index).length} named positions, ${Object.keys(next).length} book positions`);
