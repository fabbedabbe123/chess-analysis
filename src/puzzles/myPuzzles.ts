import { Chess } from 'chess.js';
import { validatePuzzle, type Puzzle, type PuzzleDifficulty } from './puzzles';

/** Puzzles the user made (or imported from a friend). Kept in this browser; shared as a text code / link. */
export const MAX_MY_PUZZLES = 100;
const CODE_PREFIX = 'cp1.';
const MAX_CODE_CHARS = 3000;

export interface PuzzleDraft {
  /** Position with the solver to move. */
  fen: string;
  /** UCI: solver, opponent reply, solver ... ending on a solver move. */
  solution: string[];
  title: string;
  explanation: string;
  difficulty: PuzzleDifficulty;
  /** Only the author's first move counts (no Stockfish check for alternatives). */
  exact: boolean;
}

function hashText(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i += 1) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/** Stable id from the content, so importing the same puzzle twice does not create a duplicate. */
export function puzzleIdFor(fen: string, solution: readonly string[]): string {
  return `u-${hashText(`${fen}|${solution.join(' ')}`)}`;
}

/** Build and validate a puzzle from what the author recorded. */
export function buildMyPuzzle(draft: PuzzleDraft): { ok: true; puzzle: Puzzle } | { ok: false; error: string } {
  const r = validatePuzzle({
    id: puzzleIdFor(draft.fen, draft.solution),
    fen: draft.fen,
    solution: draft.solution,
    theme: 'custom',
    difficulty: draft.difficulty,
    ...(draft.title.trim() !== '' ? { title: draft.title } : {}),
    ...(draft.explanation.trim() !== '' ? { explanation: draft.explanation.trim() } : {}),
    ...(draft.exact ? { exact: true } : {}),
  });
  if (!r.ok) return r;
  // a mate puzzle is more useful when labelled as such for the "any mate counts" rule: keep it 'custom' but remember the depth
  const last = new Chess(r.puzzle.fen);
  for (const m of r.puzzle.solution) last.move({ from: m.slice(0, 2), to: m.slice(2, 4), ...(m.length === 5 ? { promotion: m[4] as string } : {}) });
  if (last.isCheckmate()) return { ok: true, puzzle: { ...r.puzzle, mateIn: Math.ceil(r.puzzle.solution.length / 2) } };
  return r;
}

const b64 = (text: string): string => {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const unb64 = (code: string): string => {
  const pad = code.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(pad + '='.repeat((4 - (pad.length % 4)) % 4));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
};

/** Text code that carries a puzzle (position, solution, name, explanation, difficulty). */
export function encodePuzzleCode(p: Puzzle): string {
  const payload = { f: p.fen, s: p.solution, d: p.difficulty, ...(p.title !== undefined ? { t: p.title } : {}), ...(p.explanation !== undefined ? { e: p.explanation } : {}), ...(p.exact === true ? { x: 1 } : {}) };
  return CODE_PREFIX + b64(JSON.stringify(payload));
}

/** Link that opens the app and offers to add the puzzle. */
export function puzzleLink(p: Puzzle, base: string): string {
  return `${base.split('#')[0]}#p=${encodePuzzleCode(p)}`;
}

/** Accepts a bare code, or a link / text that contains `p=<code>`. */
export function decodePuzzleCode(input: string): { ok: true; puzzle: Puzzle } | { ok: false; error: string } {
  let text = input.trim();
  const m = /[#?&]p=([A-Za-z0-9_.-]+)/.exec(text);
  if (m !== null) text = m[1] as string;
  const idx = text.indexOf(CODE_PREFIX);
  if (idx < 0) return { ok: false, error: 'That does not look like a puzzle code (it should start with cp1.).' };
  const body = text.slice(idx + CODE_PREFIX.length).split(/[^A-Za-z0-9_-]/)[0] ?? '';
  if (body === '' || body.length > MAX_CODE_CHARS) return { ok: false, error: 'The puzzle code is empty or too long.' };
  let raw: unknown;
  try {
    raw = JSON.parse(unb64(body));
  } catch {
    return { ok: false, error: 'The puzzle code is damaged.' };
  }
  if (typeof raw !== 'object' || raw === null) return { ok: false, error: 'The puzzle code is damaged.' };
  const o = raw as Record<string, unknown>;
  if (typeof o['f'] !== 'string' || !Array.isArray(o['s']) || !['easy', 'medium', 'hard'].includes(o['d'] as string)) return { ok: false, error: 'The puzzle code is incomplete.' };
  return buildMyPuzzle({
    fen: o['f'],
    solution: o['s'].filter((x): x is string => typeof x === 'string'),
    title: typeof o['t'] === 'string' ? o['t'] : '',
    explanation: typeof o['e'] === 'string' ? o['e'] : '',
    difficulty: o['d'] as PuzzleDifficulty,
    exact: o['x'] === 1,
  });
}

/** Read stored puzzles: only well-formed custom puzzles survive. */
export function parseMyPuzzles(text: string | null): Puzzle[] {
  if (text === null) return [];
  try {
    const raw = JSON.parse(text) as unknown;
    if (!Array.isArray(raw)) return [];
    const out: Puzzle[] = [];
    for (const item of raw.slice(0, MAX_MY_PUZZLES)) {
      const r = validatePuzzle(item);
      if (r.ok && r.puzzle.theme === 'custom') out.push(r.puzzle);
    }
    return out;
  } catch {
    return [];
  }
}
