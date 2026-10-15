// Compiles data-src/lessons.src.mjs (SAN) into public/data/lessons.json (UCI + FEN) and checks every line:
//   - the start position and each move are legal (chess.js), the solver moves last
//   - opening drills: the final position must belong to a named opening in public/data/openings.json
// Usage: node scripts/build-lessons.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { Chess } from 'chess.js';
import { SKILLS } from '../data-src/lessons.src.mjs';

const book = JSON.parse(readFileSync('public/data/openings.json', 'utf8'));
const key = (fen) => fen.split(' ').slice(0, 4).join(' ');
const toUci = (m) => m.from + m.to + (m.promotion ?? '');
let errors = 0;
const fail = (msg) => { errors += 1; console.error('ERROR', msg); };

const out = [];
for (const skill of SKILLS) {
  const exercises = [];
  skill.exercises.forEach((ex, i) => {
    const id = `${skill.id}-${i + 1}`;
    const chess = new Chess();
    try {
      if (ex.fen !== undefined) chess.load(ex.fen);
      else for (const san of ex.after.split(' ').filter(Boolean)) chess.move(san);
    } catch (e) { fail(`${id}: bad start (${e.message})`); return; }
    const startFen = chess.fen();
    const sideToMove = chess.turn();
    const sans = ex.moves.split(' ').filter(Boolean);
    if (sans.length % 2 === 0) fail(`${id}: solution must end on the solver's move`);
    const solution = [];
    const history = [];
    for (const san of sans) {
      try { const m = chess.move(san); solution.push(toUci(m)); history.push(toUci(m)); } catch { fail(`${id}: illegal move ${san}`); return; }
    }
    const ending = chess.fen();
    let opening = null;
    if (ex.kind === 'book') {
      // Walk the whole line (from the standard start) and find the last named position.
      const walk = new Chess();
      const all = [];
      for (const san of (ex.after ?? '').split(' ').filter(Boolean)) all.push(toUci(walk.move(san)));
      for (const u of solution) all.push(u);
      const w = new Chess();
      let last = null;
      for (const u of all) {
        w.move({ from: u.slice(0, 2), to: u.slice(2, 4), ...(u.length === 5 ? { promotion: u[4] } : {}) });
        const hit = book.index[key(w.fen())];
        if (hit && hit.length > 0) last = book.entries[hit[hit.length - 1]][1];
      }
      opening = last;
      if (opening === null || !opening.includes(skill.expectName ?? '')) fail(`${id}: line is named ${JSON.stringify(opening)}, expected to contain ${skill.expectName}`);
    }
    exercises.push({
      id, fen: startFen, solution, sideToMove, why: ex.why,
      exact: ex.exact === true || ex.kind === 'book',
      ...(ex.trap ? { trap: true } : {}),
      ...(ex.balanced ? { balanced: true } : {}),
      kind: ex.kind === 'book' ? 'book' : 'engine',
      ...(opening !== null ? { opening } : {}),
      difficulty: i === 0 ? 'easy' : i === 1 ? 'medium' : 'hard',
      ending,
    });
  });
  out.push({ id: skill.id, title: skill.title, category: skill.category, ...(skill.color ? { color: skill.color } : {}), blurb: skill.blurb, intro: skill.intro, ideas: skill.ideas, exercises });
}
if (errors > 0) { console.error(`${errors} error(s); lessons.json not written`); process.exit(1); }
writeFileSync('public/data/lessons.json', JSON.stringify(out));
console.log(`wrote ${out.length} skills, ${out.reduce((n, s) => n + s.exercises.length, 0)} exercises`);
