import { CATEGORY_LABEL, CATEGORY_ORDER, RELATED_LESSONS, type CoachCategory } from '@/play/coach';
import { buildCoachReport } from '@/play/coach';
import type { ReviewResult } from '@/analysis/review';
import type { Skill } from '@/lessons/lessons';
import { skillProgress, type Mastery } from '@/lessons/lessons';
import { validatePuzzle, type Puzzle, type PuzzleProgress } from '@/puzzles/puzzles';
import type { Color } from '@/types/game';
import type { WhiteScore } from '@/types/engine';

/**
 * Strength estimate + focus areas + training plan.
 *
 * HONESTY NOTES (also shown in the UI):
 *  - The rating is an ESTIMATE of playing strength from engine analysis, not an Elo. It uses the average centipawn loss (ACPL)
 *    of your moves and a community rule-of-thumb mapping (see `ratingFromAcpl`) that we did NOT calibrate ourselves.
 *  - It is shown as a range that narrows with more analysed games; a single game says very little.
 *  - Focus areas and trends come from the rule-based coach categories (patterns, not proven causes).
 */

export type GameSource = 'play' | 'chesscom' | 'lichess' | 'import';

/** One of the user's worst moves in a game, kept so it can be practised later. */
export interface SavedMistake {
  /** Stable puzzle id. */
  id: string;
  /** Position before the user's move (user to move). */
  fen: string;
  /** Stockfish's preferred move (UCI). */
  best: string;
  category: CoachCategory;
  /** Winning-chance points lost by the move that was played. */
  loss: number;
  ply: number;
}

export const MAX_MISTAKES_PER_GAME = 8;
const UCI_MOVE = /^[a-h][1-8][a-h][1-8][qrbn]?$/;

function hashId(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i += 1) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

export interface AnalysedGame {
  id: string;
  source: GameSource;
  /** ms since epoch */
  endedAt: number;
  userColor: Color;
  /** Short description for the list ("vs Stockfish Beginner", "vs Magnus (1500)"). */
  label: string;
  /** Number of the user's moves that counted towards ACPL (book moves are skipped). */
  moves: number;
  /** Average centipawn loss of the user's counted moves. */
  acpl: number;
  accuracy: number | null;
  counts: { inaccuracy: number; mistake: number; blunder: number };
  /** Coach category -> number of mistakes / winning-chance points lost. */
  catCount: Partial<Record<CoachCategory, number>>;
  catLoss: Partial<Record<CoachCategory, number>>;
  /** The user's own rating at the time (Chess.com games only). */
  myRating: number | null;
  /** Search depth of the analysis. */
  depth: number;
  /** The worst moves (see SavedMistake); absent in games saved before this existed. */
  mistakes: SavedMistake[];
}

export const MAX_ANALYSED = 200;
/** Only the most recent games count for the estimate: it should describe current form. */
export const RECENT_GAMES = 20;
const CP_CLAMP = 1000;

/** Centipawns from the mover's point of view; mate = +-CP_CLAMP. */
export function moverCp(score: WhiteScore, mover: Color): number {
  let white: number;
  if (score.kind === 'mate') {
    const w = score.value === 0 ? (score.winner === 'w' ? 1 : -1) : Math.sign(score.value);
    white = w * CP_CLAMP;
  } else white = score.value;
  const cp = mover === 'w' ? white : -white;
  return Math.max(-CP_CLAMP, Math.min(CP_CLAMP, cp));
}

/** Build the record for one analysed game from a finished review; null when the user has no counted move. */
export function gameFromReview(
  result: ReviewResult,
  userColor: Color,
  meta: { id: string; source: GameSource; endedAt: number; label: string; myRating?: number | null },
): AnalysedGame | null {
  let total = 0;
  let moves = 0;
  for (const m of result.moves) {
    if (m.color !== userColor || m.classification.moveClass === null || m.classification.grade === 'book') continue;
    const before = moverCp(m.before.score, userColor);
    const after = moverCp(m.after.score, userColor);
    total += Math.max(0, before - after);
    moves += 1;
  }
  if (moves === 0) return null;
  const report = buildCoachReport(result, userColor);
  const catCount: AnalysedGame['catCount'] = {};
  const catLoss: AnalysedGame['catLoss'] = {};
  for (const x of report.mistakes) {
    catCount[x.category] = (catCount[x.category] ?? 0) + 1;
    catLoss[x.category] = (catLoss[x.category] ?? 0) + x.move.classification.winLoss;
  }
  const mistakes: SavedMistake[] = [];
  for (const x of report.mistakes) {
    const best = x.move.before.bestMove;
    if (best === null || x.move.classification.isEngineBest || !UCI_MOVE.test(best)) continue;
    mistakes.push({ id: `tm-${hashId(meta.id)}-${x.move.ply}`, fen: x.move.fenBefore, best, category: x.category, loss: Math.round(x.move.classification.winLoss * 10) / 10, ply: x.move.ply });
    if (mistakes.length >= MAX_MISTAKES_PER_GAME) break; // report.mistakes is sorted worst first
  }
  const acc = result.summary.accuracy[userColor];
  const c = result.summary.counts[userColor];
  return {
    id: meta.id,
    source: meta.source,
    endedAt: meta.endedAt,
    userColor,
    label: meta.label,
    moves,
    acpl: total / moves,
    accuracy: acc === null || Number.isNaN(acc) ? null : acc,
    counts: { inaccuracy: c.inaccuracy, mistake: c.mistake, blunder: c.blunder },
    catCount,
    catLoss,
    myRating: meta.myRating ?? null,
    depth: result.depth,
    mistakes,
  };
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function sanitizeMap(raw: unknown): Partial<Record<CoachCategory, number>> {
  const out: Partial<Record<CoachCategory, number>> = {};
  if (typeof raw !== 'object' || raw === null) return out;
  for (const c of CATEGORY_ORDER) {
    const v = num((raw as Record<string, unknown>)[c]);
    if (v !== null && v >= 0) out[c] = v;
  }
  return out;
}

export function sanitizeAnalysed(raw: unknown): AnalysedGame | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const acpl = num(r['acpl']);
  const moves = num(r['moves']);
  const endedAt = num(r['endedAt']);
  if (typeof r['id'] !== 'string' || acpl === null || acpl < 0 || moves === null || moves <= 0 || endedAt === null) return null;
  if (r['userColor'] !== 'w' && r['userColor'] !== 'b') return null;
  const source: GameSource = r['source'] === 'chesscom' || r['source'] === 'lichess' || r['source'] === 'import' ? r['source'] : 'play';
  const c = (typeof r['counts'] === 'object' && r['counts'] !== null ? r['counts'] : {}) as Record<string, unknown>;
  return {
    id: r['id'],
    source,
    endedAt,
    userColor: r['userColor'],
    label: typeof r['label'] === 'string' ? r['label'] : '',
    moves,
    acpl,
    accuracy: num(r['accuracy']),
    counts: { inaccuracy: num(c['inaccuracy']) ?? 0, mistake: num(c['mistake']) ?? 0, blunder: num(c['blunder']) ?? 0 },
    catCount: sanitizeMap(r['catCount']),
    catLoss: sanitizeMap(r['catLoss']),
    myRating: num(r['myRating']),
    depth: num(r['depth']) ?? 0,
    mistakes: sanitizeMistakes(r['mistakes']),
  };
}

function sanitizeMistakes(raw: unknown): SavedMistake[] {
  if (!Array.isArray(raw)) return [];
  const out: SavedMistake[] = [];
  for (const x of raw.slice(0, MAX_MISTAKES_PER_GAME)) {
    if (typeof x !== 'object' || x === null) continue;
    const m = x as Record<string, unknown>;
    const loss = num(m['loss']);
    const ply = num(m['ply']);
    const cat = CATEGORY_ORDER.find((c) => c === m['category']);
    if (typeof m['id'] !== 'string' || typeof m['fen'] !== 'string' || typeof m['best'] !== 'string' || !UCI_MOVE.test(m['best'])
      || cat === undefined || loss === null || loss < 0 || ply === null) continue;
    out.push({ id: m['id'], fen: m['fen'], best: m['best'], category: cat, loss, ply });
  }
  return out;
}

// ---------------------------------------------------------------- practise your own mistakes

/**
 * Practice puzzles from the user's own saved mistakes (newest analysed games first, via `recentGames`).
 * Focus-area categories come first, then the biggest losses. Puzzles already solved cleanly are left out.
 * Every puzzle is validated (legal position and move) before it is offered.
 */
export function trainingPuzzles(all: readonly AnalysedGame[], progress: PuzzleProgress, limit = 10): Puzzle[] {
  const games = recentGames(all);
  const focus = new Set(focusAreas(all).areas.map((a) => a.category));
  const seen = new Set<string>();
  const candidates: SavedMistake[] = [];
  for (const g of games) {
    for (const m of g.mistakes) {
      const key = `${m.fen}|${m.best}`;
      if (seen.has(key) || progress.solved[m.id]?.clean === true) continue;
      seen.add(key);
      candidates.push(m);
    }
  }
  candidates.sort((a, b) => Number(focus.has(b.category)) - Number(focus.has(a.category)) || b.loss - a.loss);
  const out: Puzzle[] = [];
  for (const m of candidates) {
    const v = validatePuzzle({ id: m.id, fen: m.fen, solution: [m.best], theme: 'mistake', difficulty: 'medium' });
    if (v.ok) out.push(v.puzzle);
    if (out.length >= limit) break;
  }
  return out;
}

/** Number of saved mistakes in the recent games that are still open (not solved cleanly). */
export function openMistakeCount(all: readonly AnalysedGame[], progress: PuzzleProgress): number {
  let n = 0;
  for (const g of recentGames(all)) for (const m of g.mistakes) if (progress.solved[m.id]?.clean !== true) n += 1;
  return n;
}

// ---------------------------------------------------------------- progress over time

export interface ProgressPoint {
  endedAt: number;
  /** Centre of the rolling estimate over the last `window` games up to and including this one; null when too little evidence. */
  rating: number | null;
  accuracy: number | null;
  acpl: number;
}

/** Chronological series for the chart: per game accuracy / ACPL and a rolling strength estimate (same rule as the main estimate). */
export function progressSeries(all: readonly AnalysedGame[], window = 5): ProgressPoint[] {
  const chrono = [...all].sort((a, b) => a.endedAt - b.endedAt).slice(-MAX_ANALYSED);
  return chrono.map((g, i) => {
    const slice = chrono.slice(Math.max(0, i + 1 - window), i + 1);
    const est = estimateStrength(slice);
    return { endedAt: g.endedAt, rating: est === null ? null : est.rating, accuracy: g.accuracy, acpl: g.acpl };
  });
}



// ----------------------------------------------------------------- the estimate

/**
 * Rule-of-thumb mapping from average centipawn loss to playing strength: rating ~ 3100 * exp(-0.01 * ACPL).
 * This is a widely repeated community approximation, NOT something we calibrated. Real ACPL depends on the engine depth,
 * the time control and the kind of positions, so treat the result as a rough guide only.
 */
export function ratingFromAcpl(acpl: number): number {
  const raw = 3100 * Math.exp(-0.01 * Math.max(0, acpl));
  return Math.max(400, Math.min(2800, raw));
}

export type Confidence = 'very rough' | 'rough' | 'moderate';

/** Below this many counted moves (book moves are skipped, so short opening games count for little) no estimate is shown. */
export const MIN_MOVES_ESTIMATE = 20;
/** About this many counted moves make one "full game" worth of evidence. */
const MOVES_PER_GAME = 30;

export interface StrengthEstimate {
  /** Games the estimate is based on. */
  games: number;
  moves: number;
  acpl: number;
  rating: number;
  low: number;
  high: number;
  confidence: Confidence;
}

const roundTo = (x: number, step: number) => Math.round(x / step) * step;

export function recentGames(games: readonly AnalysedGame[]): AnalysedGame[] {
  return [...games].sort((a, b) => b.endedAt - a.endedAt).slice(0, RECENT_GAMES);
}

/**
 * null when there is not enough evidence (no games, or fewer than MIN_MOVES_ESTIMATE counted moves).
 * The band half-width shrinks with the evidence, measured in "full games" n = min(games, moves / 30):
 * 350 / sqrt(n), kept between 125 and 400.
 */
export function estimateStrength(all: readonly AnalysedGame[]): StrengthEstimate | null {
  const games = recentGames(all);
  if (games.length === 0) return null;
  let moves = 0;
  let loss = 0;
  for (const g of games) {
    moves += g.moves;
    loss += g.acpl * g.moves;
  }
  if (moves < MIN_MOVES_ESTIMATE) return null;
  const acpl = loss / moves;
  const rating = ratingFromAcpl(acpl);
  const evidence = Math.max(1, Math.min(games.length, moves / MOVES_PER_GAME));
  const half = Math.max(125, Math.min(400, 350 / Math.sqrt(evidence)));
  return {
    games: games.length,
    moves,
    acpl,
    rating: roundTo(rating, 25),
    low: Math.max(400, roundTo(rating - half, 50)),
    high: Math.min(2800, roundTo(rating + half, 50)),
    confidence: evidence < 3 ? 'very rough' : evidence < 8 ? 'rough' : 'moderate',
  };
}

/** The rating range is only shown from this many analysed games; before that the app shows accuracy only. */
export const MIN_GAMES_RATING = 10;

/** The estimate the UI may show as a rating range: null until MIN_GAMES_RATING games are analysed. */
export function ratingEstimate(all: readonly AnalysedGame[]): StrengthEstimate | null {
  return recentGames(all).length >= MIN_GAMES_RATING ? estimateStrength(all) : null;
}

/** Mean accuracy (0-100) over the recent games that carry one; null when none does. */
export function averageAccuracy(all: readonly AnalysedGame[]): number | null {
  const acc = recentGames(all).flatMap((g) => (g.accuracy === null ? [] : [g.accuracy]));
  return acc.length === 0 ? null : acc.reduce((a, b) => a + b, 0) / acc.length;
}

/** Average of the user's real ratings in recent Chess.com games (null if none carries a rating). */
export function recentActualRating(all: readonly AnalysedGame[]): { rating: number; games: number } | null {
  const rated = recentGames(all).filter((g) => g.myRating !== null);
  if (rated.length === 0) return null;
  return { rating: Math.round(rated.reduce((s, g) => s + (g.myRating ?? 0), 0) / rated.length), games: rated.length };
}

// ------------------------------------------------------------------ focus areas

export type Trend = 'improving' | 'steady' | 'worse' | 'unknown';

export interface FocusArea {
  category: CoachCategory;
  label: string;
  /** Winning-chance points lost to this category per analysed game. */
  lossPerGame: number;
  mistakes: number;
  /** Share (0..1) of all points lost to categorised mistakes. */
  share: number;
  trend: Trend;
}

export const MIN_GAMES_FOCUS = 3;
export const MIN_GAMES_TREND = 6;

function lossIn(games: readonly AnalysedGame[], c: CoachCategory): number {
  return games.reduce((s, g) => s + (g.catLoss[c] ?? 0), 0) / Math.max(1, games.length);
}

/** Categories ranked by points lost; the top two (at least 15 % of the total) become the focus. Needs >= 3 games. */
export function focusAreas(all: readonly AnalysedGame[]): { areas: FocusArea[]; enough: boolean; ranked: FocusArea[] } {
  const games = recentGames(all);
  if (games.length < MIN_GAMES_FOCUS) return { areas: [], ranked: [], enough: false };
  const chrono = [...games].sort((a, b) => a.endedAt - b.endedAt);
  const totals = CATEGORY_ORDER.map((c) => ({ c, loss: games.reduce((s, g) => s + (g.catLoss[c] ?? 0), 0), n: games.reduce((s, g) => s + (g.catCount[c] ?? 0), 0) }));
  const grand = totals.reduce((s, t) => s + t.loss, 0);
  const ranked: FocusArea[] = totals
    .filter((t) => t.loss > 0)
    .sort((a, b) => b.loss - a.loss)
    .map((t) => {
      let trend: Trend = 'unknown';
      if (chrono.length >= MIN_GAMES_TREND) {
        const half = Math.floor(chrono.length / 2);
        const early = lossIn(chrono.slice(0, half), t.c);
        const late = lossIn(chrono.slice(chrono.length - half), t.c);
        trend = late <= early * 0.75 ? 'improving' : late >= early * 1.25 ? 'worse' : 'steady';
      }
      return { category: t.c, label: CATEGORY_LABEL[t.c], lossPerGame: t.loss / games.length, mistakes: t.n, share: grand > 0 ? t.loss / grand : 0, trend };
    });
  return { enough: true, ranked, areas: ranked.filter((a) => a.share >= 0.15).slice(0, 2) };
}

// ---------------------------------------------------------------- training plan

export interface PlanLesson {
  skillId: string;
  title: string;
  mastery: Mastery;
  solved: number;
  total: number;
}

export interface PlanItem {
  area: FocusArea;
  lessons: PlanLesson[];
}

/** For each focus area: up to two related lessons that are not mastered yet (new / learning first). */
export function buildPlan(areas: readonly FocusArea[], skills: readonly Skill[], progress: PuzzleProgress): PlanItem[] {
  const order: Record<Mastery, number> = { new: 0, learning: 1, practised: 2, mastered: 3 };
  return areas.map((area) => {
    const lessons: PlanLesson[] = [];
    for (const id of RELATED_LESSONS[area.category]) {
      const skill = skills.find((s) => s.id === id);
      if (skill === undefined) continue;
      const p = skillProgress(skill, progress);
      if (p.mastery === 'mastered') continue;
      lessons.push({ skillId: id, title: skill.title, mastery: p.mastery, solved: p.solved, total: p.total });
    }
    lessons.sort((a, b) => order[a.mastery] - order[b.mastery]);
    return { area, lessons: lessons.slice(0, 2) };
  });
}
