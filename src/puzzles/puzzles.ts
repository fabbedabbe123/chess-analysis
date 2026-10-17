import { Chess } from 'chess.js';
import { validateAndNormalizeFen } from '@/chess/fen';
import type { ReviewMove } from '@/analysis/review';
import type { Color } from '@/types/game';

export type PuzzleDifficulty = 'easy' | 'medium' | 'hard';
export type PuzzleTheme = 'mate1' | 'mate2' | 'mate3' | 'tactic' | 'defence' | 'mistake' | 'lesson' | 'custom';

export const THEME_LABEL: Record<PuzzleTheme, string> = {
  mate1: 'Mate in 1',
  mate2: 'Mate in 2',
  mate3: 'Mate in 3',
  tactic: 'Win material',
  defence: 'Only move (defence)',
  mistake: 'From your game',
  lesson: 'Lesson exercise',
  custom: 'My puzzle',
};

export const DIFFICULTY_NOTE =
  'Difficulty = how deep Stockfish has to search to find the first move: easy (depth 6), medium (depth 10), hard (deeper).';

export interface Puzzle {
  id: string;
  /** Position with the SOLVER to move. */
  fen: string;
  /** UCI moves: solver, opponent reply, solver, ... always ending on a solver move. */
  solution: string[];
  theme: PuzzleTheme;
  difficulty: PuzzleDifficulty;
  sideToMove: Color;
  mateIn?: number;
  /** Own puzzles: a short name chosen by the author. */
  title?: string;
  /** Lesson exercises: why the solution works, shown once the exercise is over. */
  explanation?: string;
  /** Lesson exercises: only the stored first move counts (no engine check for alternatives). */
  exact?: boolean;
  /** Lesson exercises: the skill (lesson) this exercise belongs to. */
  skillId?: string;
  /** Lesson exercises: an opening line to memorise rather than a position with an engine-best answer. */
  book?: boolean;
}

const UCI = /^[a-h][1-8][a-h][1-8][qrbn]?$/;

/** Return the puzzle if it is well formed AND its solution is a legal move sequence, else a reason. */
export function validatePuzzle(raw: unknown): { ok: true; puzzle: Puzzle } | { ok: false; error: string } {
  if (typeof raw !== 'object' || raw === null) return { ok: false, error: 'not an object' };
  const p = raw as Record<string, unknown>;
  if (typeof p['id'] !== 'string' || typeof p['fen'] !== 'string' || !Array.isArray(p['solution'])) return { ok: false, error: 'missing fields' };
  const fen = validateAndNormalizeFen(p['fen']);
  if (!fen.ok) return { ok: false, error: fen.error };
  const solution = p['solution'] as unknown[];
  if (solution.length === 0 || solution.length % 2 === 0 || !solution.every((m) => typeof m === 'string' && UCI.test(m))) {
    return { ok: false, error: 'solution must be UCI moves ending on the solver\'s move' };
  }
  const chess = new Chess(fen.fen);
  const sideToMove: Color = chess.turn();
  for (const uci of solution as string[]) {
    try {
      chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), ...(uci.length === 5 ? { promotion: uci[4] as string } : {}) });
    } catch {
      return { ok: false, error: `illegal solution move ${uci}` };
    }
  }
  const theme = p['theme'] as PuzzleTheme;
  const difficulty = p['difficulty'] as PuzzleDifficulty;
  if (!(theme in THEME_LABEL) || !['easy', 'medium', 'hard'].includes(difficulty)) return { ok: false, error: 'unknown theme or difficulty' };
  return {
    ok: true,
    puzzle: {
      id: p['id'],
      fen: fen.fen,
      solution: solution as string[],
      theme,
      difficulty,
      sideToMove,
      ...(typeof p['mateIn'] === 'number' ? { mateIn: p['mateIn'] } : {}),
      ...(typeof p['title'] === 'string' && p['title'].trim() !== '' ? { title: p['title'].trim().slice(0, 60) } : {}),
      ...(typeof p['explanation'] === 'string' ? { explanation: p['explanation'].slice(0, 400) } : {}),
      ...(p['exact'] === true ? { exact: true } : {}),
      ...(typeof p['skillId'] === 'string' ? { skillId: p['skillId'] } : {}),
      ...(p['book'] === true ? { book: true } : {}),
    },
  };
}

export function validatePuzzles(raw: unknown): { puzzles: Puzzle[]; rejected: number } {
  if (!Array.isArray(raw)) return { puzzles: [], rejected: 0 };
  const puzzles: Puzzle[] = [];
  let rejected = 0;
  for (const item of raw) {
    const r = validatePuzzle(item);
    if (r.ok) puzzles.push(r.puzzle);
    else rejected += 1;
  }
  return { puzzles, rejected };
}

let cache: Promise<Puzzle[]> | null = null;

/** Bundled puzzle set (generated with Stockfish, see scripts/generate-puzzles.mjs). */
export function loadPuzzles(baseUrl: string = import.meta.env.BASE_URL): Promise<Puzzle[]> {
  if (cache === null) {
    const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
    cache = fetch(`${base}data/puzzles.json`)
      .then((res) => {
        if (!res.ok) throw new Error(`Puzzle set not available (HTTP ${res.status})`);
        return res.json() as Promise<unknown>;
      })
      .then((raw) => validatePuzzles(raw).puzzles)
      .catch((error: unknown) => {
        cache = null; // retry next time
        throw error;
      });
  }
  return cache;
}

export function setPuzzlesForTests(puzzles: Puzzle[] | null): void {
  cache = puzzles === null ? null : Promise.resolve(puzzles);
}

/** Turn a reviewed mistake into a practice puzzle: find the move Stockfish preferred. */
export function puzzleFromMistake(move: ReviewMove): Puzzle | null {
  const best = move.before.bestMove;
  if (best === null || move.classification.isEngineBest) return null;
  const result = validatePuzzle({
    id: `m-${move.nodeId}`,
    fen: move.fenBefore,
    solution: [best],
    theme: 'mistake',
    difficulty: 'medium',
  });
  return result.ok ? result.puzzle : null;
}

// ------------------------------------------------------------------ progress

export interface PuzzleProgress {
  /** id -> attempts used when solved (only puzzles that were solved). */
  solved: Record<string, { attempts: number; clean: boolean }>;
  streak: number;
  bestStreak: number;
  /** Spaced repetition (Leitner boxes) for bundled puzzles: id -> box 1..5 and due time (ms). Absent in older saved data. */
  srs?: Record<string, SrsEntry>;
}

export interface SrsEntry {
  box: number;
  due: number;
}

export const EMPTY_PROGRESS: PuzzleProgress = { solved: {}, streak: 0, bestStreak: 0 };

const DAY_MS = 86_400_000;
/** Days until the next review per box. A clean solve moves a puzzle up one box; anything else sends it back to box 1. */
export const SRS_DAYS = [1, 3, 7, 16, 35] as const;
export const SRS_MAX_ENTRIES = 1000;

export function nextSrs(prev: SrsEntry | undefined, success: boolean, now: number): SrsEntry {
  const box = success ? Math.min(SRS_DAYS.length, (prev?.box ?? 0) + 1) : 1;
  return { box, due: now + (SRS_DAYS[box - 1] ?? 1) * DAY_MS };
}

/** Puzzles whose review is due, most overdue first. Only puzzles present in `all` can be offered. */
export function duePuzzles(all: readonly Puzzle[], progress: PuzzleProgress, now: number): Puzzle[] {
  const srs = progress.srs ?? {};
  return all
    .filter((p) => (srs[p.id]?.due ?? Infinity) <= now)
    .sort((a, b) => (srs[a.id]?.due ?? 0) - (srs[b.id]?.due ?? 0));
}

/** Time of the next scheduled review among puzzles in `all`, or null. */
export function nextDueTime(all: readonly Puzzle[], progress: PuzzleProgress): number | null {
  const srs = progress.srs ?? {};
  let best: number | null = null;
  for (const p of all) {
    const e = srs[p.id];
    if (e !== undefined && (best === null || e.due < best)) best = e.due;
  }
  return best;
}

export function sanitizeProgress(raw: unknown): PuzzleProgress {
  if (typeof raw !== 'object' || raw === null) return { ...EMPTY_PROGRESS, solved: {} };
  const r = raw as Record<string, unknown>;
  const solved: PuzzleProgress['solved'] = {};
  if (typeof r['solved'] === 'object' && r['solved'] !== null) {
    for (const [id, v] of Object.entries(r['solved'] as Record<string, unknown>)) {
      if (typeof v !== 'object' || v === null) continue;
      const e = v as Record<string, unknown>;
      solved[id] = { attempts: typeof e['attempts'] === 'number' ? e['attempts'] : 1, clean: e['clean'] === true };
    }
  }
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
  const srs: Record<string, SrsEntry> = {};
  if (typeof r['srs'] === 'object' && r['srs'] !== null) {
    for (const [id, v] of Object.entries(r['srs'] as Record<string, unknown>).slice(0, SRS_MAX_ENTRIES)) {
      if (typeof v !== 'object' || v === null) continue;
      const e = v as Record<string, unknown>;
      const box = e['box'];
      const due = e['due'];
      if (typeof box !== 'number' || !Number.isInteger(box) || box < 1 || box > SRS_DAYS.length || typeof due !== 'number' || !Number.isFinite(due)) continue;
      srs[id] = { box, due };
    }
  }
  return { solved, streak: n(r['streak']), bestStreak: n(r['bestStreak']), ...(Object.keys(srs).length > 0 ? { srs } : {}) };
}

export interface PuzzleFilter {
  difficulty: PuzzleDifficulty | 'any';
  theme: PuzzleTheme | 'any';
}

/** Next puzzle: unsolved ones that match the filter first (in order), then the rest; never the current one if avoidable. */
export function pickNextPuzzle(all: readonly Puzzle[], progress: PuzzleProgress, filter: PuzzleFilter, currentId: string | null): Puzzle | null {
  const matching = all.filter(
    (p) => (filter.difficulty === 'any' || p.difficulty === filter.difficulty) && (filter.theme === 'any' || p.theme === filter.theme),
  );
  if (matching.length === 0) return null;
  const unsolved = matching.filter((p) => progress.solved[p.id] === undefined && p.id !== currentId);
  if (unsolved.length > 0) return unsolved[0] ?? null;
  const others = matching.filter((p) => p.id !== currentId);
  const pool = others.length > 0 ? others : matching;
  return pool[Math.floor(Math.random() * pool.length)] ?? null;
}
