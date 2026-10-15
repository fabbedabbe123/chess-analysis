/**
 * Independent Stockfish re-check of public/data/lessons.json (default depth 16).
 * Engine exercises (kind "engine"), values from the solver's point of view:
 *   (win % = Lichess logistic model of the centipawn score)
 *   - every solver move is Stockfish's best or within 3 win-% points of it
 *   - exact exercises: the stored first move beats the best other first move by >= 10 win-% points (or mates when the other
 *     move does not); "trap" exercises teach a specific named idea, so only the best-move check applies to them
 *   - every opponent reply is within 5 win-% points of the opponent's best (skipped for "trap" exercises, which punish a natural mistake)
 *   - the final position gives the solver >= 65 % winning chances (about +150 cp, or mate)  [not required for "balanced" exercises, where the point is that the move is the only accurate one]
 * Book exercises (opening drills) were checked against the opening book by scripts/build-lessons.mjs.
 * Usage: node scripts/verify-lessons.mjs [depth]
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { Chess } from 'chess.js';
const require = createRequire(import.meta.url);
const DEPTH = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 16);
const skills = JSON.parse(readFileSync('public/data/lessons.json', 'utf8'));
let infos = new Map(), waiter = null, readyWaiter = null;
const sf = require('stockfish')('lite-single', (line) => {
  if (line.startsWith('info ') && line.includes(' pv ') && !/(lowerbound|upperbound)/.test(line)) {
    const idx = Number(/multipv (\d+)/.exec(line)?.[1] ?? 1);
    const cp = /score cp (-?\d+)/.exec(line), mate = /score mate (-?\d+)/.exec(line);
    infos.set(idx, { v: mate ? (Number(mate[1]) > 0 ? 100000 - Number(mate[1]) : -100000 - Number(mate[1])) : Number(cp[1]), move: line.split(' pv ')[1].split(' ')[0] });
  } else if (line.startsWith('bestmove') && waiter) { const w = waiter; waiter = null; setImmediate(w); }
  else if (line === 'readyok' && readyWaiter) { const w = readyWaiter; readyWaiter = null; setImmediate(w); }
});
sf.processCommand('uci');
await new Promise((r) => { readyWaiter = r; sf.processCommand('isready'); });
/** Score for the side to move in `fen` (cp, mates as +-100000), optionally restricted to one move. */
async function evaluate(fen, only) {
  const chess = new Chess(fen);
  if (chess.isCheckmate()) return { v: -100000, move: null };
  if (chess.isDraw() || chess.moves().length === 0) return { v: 0, move: null };
  infos = new Map();
  sf.processCommand(`setoption name MultiPV value ${only ? 1 : 2}`);
  sf.processCommand(`position fen ${fen}`);
  await new Promise((r) => { waiter = r; sf.processCommand(`go depth ${DEPTH}${only ? ` searchmoves ${only}` : ''}`); });
  return { top: infos.get(1), second: infos.get(2) };
}
const wp = (cp) => 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * Math.max(-3000, Math.min(3000, cp)))) - 1);
const play = (fen, uci) => { const c = new Chess(fen); c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), ...(uci.length === 5 ? { promotion: uci[4] } : {}) }); return c.fen(); };
let bad = 0, checked = 0;
const FAIL = (id, why) => { bad += 1; console.log('FAIL', id, why); };
for (const skill of skills) {
  for (const ex of skill.exercises) {
    if (ex.kind === 'book') continue;
    checked += 1;
    let fen = ex.fen;
    const notes = [];
    let ok = true;
    for (let i = 0; i < ex.solution.length; i++) {
      const solver = i % 2 === 0;
      const stored = ex.solution[i];
      const all = await evaluate(fen);
      if (all.v !== undefined) { notes.push('terminal'); break; }
      // MultiPV lines can be stale when a bound is reported at the last depth, so every compared move is
      // re-searched on its own (searchmoves) and those values are the ones used.
      const exact = async (m) => (await evaluate(fen, m)).top;
      const best0 = all.top.v > (all.second?.v ?? -Infinity) ? all.top : all.top;
      const bestMove = best0.move;
      const best = await exact(bestMove);
      const mine = bestMove === stored ? best : await exact(stored);
      const otherMove = bestMove === stored ? all.second?.move : bestMove;
      const other = otherMove === undefined ? undefined : otherMove === bestMove ? best : await exact(otherMove);
      // the strongest alternative to the stored move is whichever of the two non-stored candidates scores higher
      best.move = bestMove;
      if (solver) {
        if (wp(best.v) - wp(mine.v) > 3) { ok = false; FAIL(ex.id, `solver move ${i + 1} ${stored} is ${mine.v} but best is ${best.move} ${best.v}`); break; }
        const mates = (x) => Math.abs(x) > 90000;
        if (i === 0 && ex.exact && !ex.trap && other && other.move !== stored && wp(mine.v) - wp(other.v) < 10 && !(mates(mine.v) && !mates(other.v))) { ok = false; FAIL(ex.id, `marked exact but ${other.move} (${other.v} cp) is within 10 win-% of the stored move (${mine.v} cp)`); break; }
        if (i === 0) notes.push(`first ${mine.v} vs other ${other ? other.v : '-'}`);
      } else if (!ex.trap && wp(best.v) - wp(mine.v) > 5) {
        ok = false; FAIL(ex.id, `opponent reply ${stored} is ${mine.v} but ${best.move} gives ${best.v}`); break;
      }
      fen = play(fen, stored);
    }
    if (ok && skill.id !== 'opening-principles' && !ex.balanced) {
      const final = await evaluate(fen);
      const forSolver = final.v !== undefined ? -final.v : (new Chess(fen).turn() === ex.sideToMove ? final.top.v : -final.top.v);
      if (wp(forSolver) < 65) FAIL(ex.id, `final position is only ${forSolver} cp for the solver`);
      else notes.push(`final ${forSolver}`);
    }
    if (ok) console.log('ok  ', ex.id, notes.join(', '));
  }
}
console.log(`${checked - bad}/${checked} engine exercises verified at depth ${DEPTH}`);
sf.terminate(); process.exit(bad === 0 ? 0 : 1);
