/**
 * Optional online puzzle source: the Lichess puzzle database (CC0, https://database.lichess.org/#puzzles) through the public
 * API `/api/puzzle/batch/mix`. Nothing is required: when the network (or the hosting page's policy) blocks the request, the
 * bundled engine-generated set keeps working and the error says so.
 *
 * Format (checked against the live API): `game.pgn` is the space separated SAN moves up to and including the opponent's move
 * that sets the puzzle; replaying it gives the position with the SOLVER to move, and `puzzle.solution` (UCI) starts with the
 * solver's move and ends on a solver move. Every puzzle is validated (legal position, legal solution) before it is kept.
 */
import { Chess } from 'chess.js';
import { validatePuzzle, type Puzzle, type PuzzleDifficulty, type PuzzleTheme } from './puzzles';
import { storageGet, storageSet } from '@/utils/storage';

export const LICHESS_PUZZLE_KEY = 'chess-analysis:lichess-puzzles:v1';
export const MAX_SAVED_LICHESS_PUZZLES = 300;
export const LICHESS_PUZZLE_BATCH = 20;

function themeOf(themes: readonly string[]): { theme: PuzzleTheme; mateIn?: number } {
  for (const [name, theme, n] of [['mateIn1', 'mate1', 1], ['mateIn2', 'mate2', 2], ['mateIn3', 'mate3', 3]] as const) {
    if (themes.includes(name)) return { theme, mateIn: n };
  }
  return { theme: themes.includes('defensiveMove') ? 'defence' : 'tactic' };
}

export function difficultyOf(rating: number): PuzzleDifficulty {
  return rating < 1300 ? 'easy' : rating < 1800 ? 'medium' : 'hard';
}

/** One API entry -> Puzzle, or null when it is malformed or its moves are not legal. */
export function parseLichessPuzzle(raw: unknown): Puzzle | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const e = raw as { game?: { pgn?: unknown }; puzzle?: Record<string, unknown> };
  const pz = e.puzzle;
  const pgn = e.game?.pgn;
  if (pz === undefined || typeof pgn !== 'string' || typeof pz['id'] !== 'string' || !/^[A-Za-z0-9]{3,10}$/.test(pz['id'])
    || !Array.isArray(pz['solution']) || typeof pz['rating'] !== 'number') return null;
  const chess = new Chess();
  try {
    for (const san of pgn.split(/\s+/).filter((t) => t !== '')) chess.move(san);
  } catch {
    return null;
  }
  const themes = Array.isArray(pz['themes']) ? pz['themes'].filter((t): t is string => typeof t === 'string') : [];
  const { theme, mateIn } = themeOf(themes);
  const v = validatePuzzle({ id: `li-${pz['id']}`, fen: chess.fen(), solution: pz['solution'], theme, difficulty: difficultyOf(pz['rating']), ...(mateIn !== undefined ? { mateIn } : {}) });
  return v.ok ? v.puzzle : null;
}

export class PuzzleFetchError extends Error {}

export async function fetchLichessPuzzles(nb = LICHESS_PUZZLE_BATCH, f: typeof fetch = fetch): Promise<{ puzzles: Puzzle[]; rejected: number }> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 20000);
  let res: Response;
  try {
    res = await f(`https://lichess.org/api/puzzle/batch/mix?nb=${Math.max(1, Math.min(50, Math.floor(nb)))}`, { signal: ctl.signal, headers: { Accept: 'application/json' } });
  } catch {
    throw new PuzzleFetchError('Could not reach Lichess (offline, blocked, or the service is down). The bundled puzzles still work.');
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 429) throw new PuzzleFetchError('Lichess is rate limiting requests. Wait a minute and try again.');
  if (!res.ok) throw new PuzzleFetchError(`Lichess returned HTTP ${res.status}.`);
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    throw new PuzzleFetchError('Lichess returned data that is not valid JSON.');
  }
  const list = (data as { puzzles?: unknown }).puzzles;
  if (!Array.isArray(list)) throw new PuzzleFetchError('Unexpected puzzle data from Lichess.');
  const puzzles: Puzzle[] = [];
  let rejected = 0;
  for (const item of list) {
    const p = parseLichessPuzzle(item);
    if (p === null) rejected += 1; else puzzles.push(p);
  }
  return { puzzles, rejected };
}

/** Keeps existing puzzles, adds new ones (by id), newest last, and drops the oldest beyond the cap. */
export function mergeLichessPuzzles(existing: readonly Puzzle[], incoming: readonly Puzzle[]): Puzzle[] {
  const seen = new Set(existing.map((p) => p.id));
  const merged = [...existing];
  for (const p of incoming) if (!seen.has(p.id)) { seen.add(p.id); merged.push(p); }
  return merged.slice(-MAX_SAVED_LICHESS_PUZZLES);
}

/** Saved Lichess puzzles, re-validated on every load (stored data is never trusted). */
export function loadSavedLichessPuzzles(): Puzzle[] {
  try {
    const text = storageGet(LICHESS_PUZZLE_KEY);
    if (text === null) return [];
    const raw = JSON.parse(text) as unknown;
    if (!Array.isArray(raw)) return [];
    const out: Puzzle[] = [];
    for (const item of raw.slice(0, MAX_SAVED_LICHESS_PUZZLES)) {
      const v = validatePuzzle(item);
      if (v.ok && v.puzzle.id.startsWith('li-')) out.push(v.puzzle);
    }
    return out;
  } catch {
    return [];
  }
}

export function saveLichessPuzzles(list: readonly Puzzle[]): boolean {
  return storageSet(LICHESS_PUZZLE_KEY, JSON.stringify(list));
}
