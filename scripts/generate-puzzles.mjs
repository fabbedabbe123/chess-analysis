/**
 * Generates public/data/puzzles.json with REAL Stockfish (the same engine the app ships).
 *
 * 1. Plays many weak, error-prone games (low Skill Level + occasional random moves) so that natural
 *    tactical chances appear after mistakes.
 * 2. Every position is analysed at full strength (MultiPV 2). It becomes a puzzle only if
 *      - mate:    the side to move has a forced mate in 1-3, or
 *      - tactic:  the best move wins >= 2 pawns AND is >= 2 pawns better than the second best, or
 *      - defence: the best move holds the balance while every alternative loses >= 3 pawns.
 * 3. Candidates are re-verified at a higher depth; the solution line only keeps user moves that are
 *    verified as unique (or mating). Difficulty = shallowest search depth at which the engine finds move 1
 *    (depth 6 -> easy, depth 10 -> medium, otherwise hard).
 *
 * Usage: node scripts/generate-puzzles.mjs [targetCount] [maxMinutes]
 */
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { Chess } from 'chess.js';

const require = createRequire(import.meta.url);
const TARGET = Number(process.argv[2] ?? 90);
const MAX_MS = Number(process.argv[3] ?? 25) * 60_000;
const started = Date.now();

const sf = require('stockfish')('lite-single', (line) => onLine(line));
let waiter = null;
let infos = new Map();
function onLine(line) {
  if (line.startsWith('info ') && line.includes(' pv ') && line.includes(' score ')) {
    const mp = /multipv (\d+)/.exec(line);
    const idx = mp ? Number(mp[1]) : 1;
    const depth = Number(/ depth (\d+)/.exec(line)?.[1] ?? 0);
    const cp = /score cp (-?\d+)/.exec(line);
    const mate = /score mate (-?\d+)/.exec(line);
    const pv = line.split(' pv ')[1].trim().split(' ');
    if (/(lowerbound|upperbound)/.test(line)) return;
    infos.set(idx, { depth, cp: cp ? Number(cp[1]) : null, mate: mate ? Number(mate[1]) : null, pv });
  } else if (line.startsWith('bestmove') && waiter) {
    const w = waiter;
    waiter = null;
    setImmediate(() => w(line.split(' ')[1]));
  } else if (line === 'readyok' && readyWaiter) {
    const w = readyWaiter;
    readyWaiter = null;
    setImmediate(w);
  }
}
let readyWaiter = null;
const ready = () => new Promise((res) => { readyWaiter = res; sf.processCommand('isready'); });
const opt = (n, v) => sf.processCommand(`setoption name ${n} value ${v}`);

async function search(fen, { depth, multipv = 1, skill = 20 }) {
  opt('Skill Level', skill);
  opt('MultiPV', multipv);
  await ready();
  infos = new Map();
  sf.processCommand(`position fen ${fen}`);
  const best = await new Promise((res) => { waiter = res; sf.processCommand(`go depth ${depth}`); });
  return { best, lines: [...infos.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v) };
}

const score = (l) => (l.mate !== null ? (l.mate > 0 ? 100000 - l.mate : -100000 - l.mate) : l.cp);
const mateLike = (l) => l.mate !== null;

function randomPick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

async function playGame() {
  const chess = new Chess();
  const fens = [];
  for (let ply = 0; ply < 80 && !chess.isGameOver(); ply += 1) {
    const moves = chess.moves({ verbose: true });
    let move;
    if (ply < 6 || Math.random() < 0.08) move = randomPick(moves);
    else {
      const r = await search(chess.fen(), { depth: 4, skill: 2 });
      move = moves.find((m) => m.from + m.to + (m.promotion ?? '') === r.best) ?? randomPick(moves);
    }
    chess.move(move);
    if (ply >= 8 && !chess.isGameOver()) fens.push(chess.fen());
  }
  return fens;
}

const key = (fen) => fen.split(' ').slice(0, 4).join(' ');
const seen = new Set();
const puzzles = [];
// MERGE=1 keeps puzzles from an earlier run (e.g. to top up medium/hard ones).
if (process.env.MERGE && existsSync('public/data/puzzles.json')) {
  for (const old of JSON.parse(readFileSync('public/data/puzzles.json', 'utf8'))) {
    puzzles.push(old);
    seen.add(key(old.fen));
  }
}
const counts = { mate1: 0, mate2: 0, mate3: 0, tactic: 0, defence: 0 };
const QUOTA = { mate1: 8, mate2: 14, mate3: 12, tactic: 44, defence: 12 };
const DIFF_QUOTA = { easy: Number(process.env.EASY ?? 28), medium: Number(process.env.MEDIUM ?? 34), hard: Number(process.env.HARD ?? 34) };
const diffCounts = { easy: 0, medium: 0, hard: 0 };
for (const old of puzzles) {
  diffCounts[old.difficulty] += 1;
  counts[old.theme] += 1;
}

function applyUci(chess, uci) {
  return chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
}

async function classify(fen) {
  const quick = await search(fen, { depth: 10, multipv: 2 });
  const [a, b] = quick.lines;
  if (!a) return null;
  if (mateLike(a) && a.mate > 0 && a.mate <= 3) return { theme: `mate${a.mate}` };
  const sa = score(a);
  const sb = b ? score(b) : -100000;
  if (a.cp !== null && sa >= 200 && sa - sb >= 200) return { theme: 'tactic' };
  if (a.cp !== null && sa >= -60 && sa <= 150 && sb <= -300) return { theme: 'defence' };
  return null;
}

async function build(fen, theme) {
  // Re-verify deeper and extend the solution while each user move stays unique / mating.
  const solution = [];
  const chess = new Chess(fen);
  const userColor = chess.turn();
  const startAnalysis = await search(fen, { depth: 16, multipv: 2 });
  const [a, b] = startAnalysis.lines;
  if (!a) return null;
  const sa = score(a);
  const sb = b ? score(b) : -100000;
  if (theme.startsWith('mate')) {
    if (!(a.mate > 0 && a.mate <= 3)) return null;
  } else if (theme === 'tactic') {
    if (!(a.cp !== null && sa >= 180 && sa - sb >= 150)) return null;
  } else if (!(a.cp !== null && sa >= -80 && sb <= -250)) return null;

  let pv = a.pv;
  const maxUser = theme.startsWith('mate') ? 3 : 3;
  for (let i = 0; i < maxUser; i += 1) {
    const userMove = pv[0];
    if (!userMove) break;
    try { applyUci(chess, userMove); } catch { return null; }
    solution.push(userMove);
    if (chess.isGameOver()) break;
    const reply = pv[1];
    if (!reply) break;
    try { applyUci(chess, reply); } catch { return null; }
    solution.push(reply);
    if (chess.isGameOver()) break;
    if (i === maxUser - 1) break;
    // Is the next user move still clear-cut?
    const next = await search(chess.fen(), { depth: 14, multipv: 2 });
    const [na, nb] = next.lines;
    if (!na) break;
    const clear = mateLike(na) ? na.mate > 0 : na.cp !== null && score(na) - (nb ? score(nb) : -100000) >= 150 && score(na) >= 150;
    if (!clear) { solution.pop(); break; } // keep the position after the user's move only: drop the opponent reply too
    pv = na.pv;
  }
  // The solution must end on a USER move.
  if (solution.length % 2 === 0) solution.pop();
  if (solution.length === 0) return null;
  // Difficulty: how shallow a search already finds move 1.
  let difficulty = 'hard';
  for (const [d, label] of [[6, 'easy'], [10, 'medium']]) {
    const r = await search(fen, { depth: d, multipv: 1 });
    if (r.best === solution[0]) { difficulty = label; break; }
  }
  return { fen, solution, theme, difficulty, sideToMove: userColor, ...(theme.startsWith('mate') ? { mateIn: Number(theme.slice(4)) } : {}) };
}

sf.processCommand('uci');
await ready();
let games = 0;
while (puzzles.length < TARGET && Date.now() - started < MAX_MS) {
  games += 1;
  const fens = await playGame();
  let fromThisGame = 0;
  let cooldown = 0;
  for (const fen of fens) {
    if (puzzles.length >= TARGET || Date.now() - started > MAX_MS) break;
    if (cooldown > 0) { cooldown -= 1; continue; } // consecutive positions of one game repeat the same tactic
    if (fromThisGame >= 2) break;
    const k = key(fen);
    if (seen.has(k)) continue;
    seen.add(k);
    const c = await classify(fen);
    if (!c) continue;
    const bucket = c.theme;
    if (counts[bucket] >= QUOTA[bucket]) continue;
    const p = await build(fen, c.theme);
    if (!p) continue;
    if (diffCounts[p.difficulty] >= DIFF_QUOTA[p.difficulty]) continue;
    diffCounts[p.difficulty] += 1;
    fromThisGame += 1;
    cooldown = 8;
    counts[bucket] += 1;
    puzzles.push({ id: `p${String(puzzles.length + 1).padStart(3, '0')}`, ...p });
    console.log(`#${puzzles.length} ${bucket} ${p.difficulty} ${p.solution.join(' ')}  (game ${games}, ${Math.round((Date.now() - started) / 1000)}s)`);
  }
}
sf.terminate();
puzzles.sort((x, y) => ['easy', 'medium', 'hard'].indexOf(x.difficulty) - ['easy', 'medium', 'hard'].indexOf(y.difficulty));
puzzles.forEach((p, i) => { p.id = `p${String(i + 1).padStart(3, '0')}`; });
mkdirSync('public/data', { recursive: true });
writeFileSync('public/data/puzzles.json', JSON.stringify(puzzles));
console.log('DONE', puzzles.length, counts, diffCounts, 'games', games);
process.exit(0);
