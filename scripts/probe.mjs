// Probe: node scripts/probe.mjs [depth] "<fen>" ...   prints top 3 lines per FEN (dev helper for lesson authoring)
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const DEPTH = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 16);
const fens = process.argv.slice(2).filter((a) => !/^\d+$/.test(a));
let infos = new Map(), waiter = null, readyWaiter = null;
const sf = require('stockfish')('lite-single', (line) => {
  if (line.startsWith('info ') && line.includes(' pv ') && !/(lowerbound|upperbound)/.test(line)) {
    const idx = Number(/multipv (\d+)/.exec(line)?.[1] ?? 1);
    const cp = /score cp (-?\d+)/.exec(line), mate = /score mate (-?\d+)/.exec(line);
    infos.set(idx, `${mate ? '#' + mate[1] : cp[1] + 'cp'} ${line.split(' pv ')[1].split(' ').slice(0, 5).join(' ')}`);
  } else if (line.startsWith('bestmove') && waiter) { const w = waiter; waiter = null; setImmediate(w); }
  else if (line === 'readyok' && readyWaiter) { const w = readyWaiter; readyWaiter = null; setImmediate(w); }
});
sf.processCommand('uci'); sf.processCommand('setoption name MultiPV value 3');
await new Promise((r) => { readyWaiter = r; sf.processCommand('isready'); });
for (const fen of fens) {
  infos = new Map();
  sf.processCommand(`position fen ${fen}`);
  await new Promise((r) => { waiter = r; sf.processCommand(`go depth ${DEPTH}`); });
  console.log(fen); for (const [i, t] of [...infos].sort()) console.log('  ', i, t);
}
sf.terminate(); process.exit(0);
