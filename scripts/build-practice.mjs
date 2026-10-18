// Builds the practice sets of the learning path from the Lichess open puzzle database (CC0).
//
//   curl -L https://database.lichess.org/lichess_db_puzzle.csv.zst | zstd -dc | node scripts/build-practice.mjs
//
// Input (stdin): Lichess puzzle CSV  PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags
//   Moves[0] is the opponent's move that creates the puzzle; the rest alternates solver, opponent, ... ending on the solver.
// Output: public/data/practice/<skill>.json  { v: 1, p: [[id, fen, "uci uci ...", rating], ...] }  sorted by rating
//         public/data/practice/index.json     levels, skills (order, requires, text for new skills) and counts
// Every puzzle is replayed with chess.js (legal moves, solver moves last) before it is written. Lichess has already
// checked each puzzle with Stockfish and ranks it by player votes; only well-liked, well-played puzzles are used.
import { createInterface } from 'node:readline';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { Chess } from 'chess.js';
import { PATH, LEVELS } from '../data-src/path.src.mjs';

const OUT = 'public/data/practice';
const BANDS = [[0, 1000], [1000, 1400], [1400, 1800], [1800, 2200], [2200, 4000]];
const PER_BAND = 40;
const MIN_POPULARITY = 80;
const MIN_PLAYS = 200;
const MAX_DEVIATION = 90;

const skills = PATH.filter((s) => s.practice);
const keep = new Map(); // `${skill}|${band}` -> [{score, rec}]
for (const s of skills) for (let b = 0; b < BANDS.length; b++) keep.set(`${s.id}|${b}`, []);

let read = 0, eligible = 0, matched = 0;
const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of rl) {
  read += 1;
  if (read === 1 && line.startsWith('PuzzleId')) continue;
  const f = line.split(',');
  if (f.length < 8) continue;
  const rating = Number(f[3]), dev = Number(f[4]), pop = Number(f[5]), plays = Number(f[6]);
  if (!(pop >= MIN_POPULARITY && plays >= MIN_PLAYS && dev <= MAX_DEVIATION)) continue;
  eligible += 1;
  const themes = new Set(f[7].split(' '));
  const skill = skills.find((s) => s.practice.themes.some((t) => themes.has(t)) && rating >= (s.practice.min ?? 0) && rating <= (s.practice.max ?? 9999));
  if (skill === undefined) continue;
  const band = BANDS.findIndex(([lo, hi]) => rating >= lo && rating < hi);
  if (band < 0) continue;
  matched += 1;
  const bucket = keep.get(`${skill.id}|${band}`);
  const score = pop + plays / 1e7;
  if (bucket.length >= PER_BAND * 3 && score <= bucket[bucket.length - 1].score) continue;
  bucket.push({ score, rec: [f[0], f[1], f[2], rating] });
  bucket.sort((a, b) => b.score - a.score);
  if (bucket.length > PER_BAND * 3) bucket.pop();
}

/** Replays the puzzle; returns [id, startFen, solutionUci, rating] or null. */
function prepare([id, fen, moves, rating]) {
  const list = moves.split(' ');
  if (list.length < 2 || list.length % 2 !== 0) return null;
  const chess = new Chess();
  try { chess.load(fen); } catch { return null; }
  const uci = (m) => m.from + m.to + (m.promotion ?? '');
  const out = [];
  try {
    for (let i = 0; i < list.length; i++) {
      const m = list[i];
      const mv = chess.move({ from: m.slice(0, 2), to: m.slice(2, 4), ...(m.length === 5 ? { promotion: m[4] } : {}) });
      if (i > 0) out.push(uci(mv));
    }
  } catch { return null; }
  // fen of the position the solver sees: replay only the first move
  const start = new Chess(fen);
  start.move({ from: list[0].slice(0, 2), to: list[0].slice(2, 4), ...(list[0].length === 5 ? { promotion: list[0][4] } : {}) });
  return [id, start.fen(), out.join(' '), rating];
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const counts = {};
const seen = new Set();
for (const s of skills) {
  const rows = [];
  for (let b = 0; b < BANDS.length; b++) {
    let n = 0;
    for (const { rec } of keep.get(`${s.id}|${b}`)) {
      if (n >= PER_BAND) break;
      const p = prepare(rec);
      if (p === null) continue;
      const key = p[1].split(' ').slice(0, 4).join(' ');
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push(p);
      n += 1;
    }
  }
  rows.sort((a, b) => a[3] - b[3]);
  counts[s.id] = rows.length;
  writeFileSync(`${OUT}/${s.id}.json`, JSON.stringify({ v: 1, p: rows }));
}

const index = {
  v: 1,
  levels: LEVELS,
  skills: PATH.map(({ practice, ...s }) => ({ ...s, practice: practice === undefined ? 0 : counts[s.id] ?? 0 })),
};
writeFileSync(`${OUT}/index.json`, JSON.stringify(index));
const total = Object.values(counts).reduce((a, b) => a + b, 0);
console.log(`read ${read} rows, ${eligible} eligible, ${matched} matched a skill; wrote ${total} puzzles for ${skills.length} skills`);
for (const s of skills) if (counts[s.id] < 40) console.warn(`  few puzzles: ${s.id} (${counts[s.id]})`);
