/**
 * Independent re-check of public/data/puzzles.json with Stockfish at a higher depth (default 20, MultiPV 2).
 *   mate puzzles : the engine still finds a forced mate in <= mateIn
 *   tactic       : the stored first move is the engine's best (or within 30 cp) and wins >= 150 cp; second best is >= 100 cp worse
 *   defence      : the stored first move keeps the balance (>= -80 cp) while the second best is >= 200 cp worse
 * Usage: node scripts/verify-puzzles.mjs [depth] [--prune]   (--prune rewrites the file without failing puzzles)
 */
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const PRUNE = process.argv.includes('--prune');
const DEPTH = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 20);
const puzzles = JSON.parse(readFileSync('public/data/puzzles.json', 'utf8'));
let infos = new Map(), waiter = null, readyWaiter = null;
const sf = require('stockfish')('lite-single', (line) => {
  if (line.startsWith('info ') && line.includes(' pv ') && !/(lowerbound|upperbound)/.test(line)) {
    const idx = Number(/multipv (\d+)/.exec(line)?.[1] ?? 1);
    const cp = /score cp (-?\d+)/.exec(line), mate = /score mate (-?\d+)/.exec(line);
    infos.set(idx, { cp: cp ? Number(cp[1]) : null, mate: mate ? Number(mate[1]) : null, move: line.split(' pv ')[1].split(' ')[0] });
  } else if (line.startsWith('bestmove') && waiter) { const w = waiter; waiter = null; setImmediate(() => w()); }
  else if (line === 'readyok' && readyWaiter) { const w = readyWaiter; readyWaiter = null; setImmediate(w); }
});
const ready = () => new Promise((r) => { readyWaiter = r; sf.processCommand('isready'); });
sf.processCommand('uci'); sf.processCommand('setoption name MultiPV value 2'); await ready();
const val = (l) => (l.mate !== null ? (l.mate > 0 ? 100000 - l.mate : -100000 - l.mate) : l.cp);
let bad = 0;
const keep = [];
for (const p of puzzles) {
  infos = new Map();
  sf.processCommand(`position fen ${p.fen}`);
  await new Promise((r) => { waiter = r; sf.processCommand(`go depth ${DEPTH}`); });
  const a = infos.get(1), b = infos.get(2);
  let ok = false, why = '';
  if (!a) why = 'no result';
  else if (p.theme.startsWith('mate')) { ok = a.mate !== null && a.mate > 0 && a.mate <= p.mateIn; why = `engine: ${a.mate !== null ? 'mate ' + a.mate : a.cp + 'cp'}`; }
  else {
    const stored = a.move === p.solution[0] || (b && b.move === p.solution[0] && val(a) - val(b) <= 30);
    const sa = val(a), sb = b ? val(b) : -100000;
    if (p.theme === 'tactic') ok = stored && sa >= 150 && sa - sb >= 100;
    else ok = stored && sa >= -80 && sa - sb >= 200;
    why = `best ${a.move} ${sa}cp, second ${b ? b.move + ' ' + sb + 'cp' : '-'}`;
  }
  if (ok) keep.push(p);
  if (!ok) { bad += 1; console.log('FAIL', p.id, p.theme, p.solution[0], why); }
}
if (PRUNE && bad > 0) {
  keep.forEach((q, i) => { q.id = `p${String(i + 1).padStart(3, '0')}`; });
  writeFileSync('public/data/puzzles.json', JSON.stringify(keep));
  console.log(`pruned ${bad} puzzle(s) that failed the deeper check; ${keep.length} remain`);
}
console.log(`verified ${puzzles.length - bad}/${puzzles.length} at depth ${DEPTH}`);
sf.terminate(); process.exit(bad === 0 ? 0 : 1);
