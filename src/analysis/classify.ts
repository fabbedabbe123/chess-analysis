import { Chess } from 'chess.js';
import type { Color, WhiteScore } from '@/types/engine';
import { mateWinner, sideWinPercent } from './eval';

/**
 * MOVE CLASSIFICATION MODEL
 * -------------------------
 * For a move played by `mover` we compare two engine evaluations made with the SAME
 * settings (same depth, MultiPV, options):
 *   before = position before the move (mover to move)
 *   after  = position after the move   (opponent to move)
 * Both are converted to the mover's winning chances (0..100) with the logistic model in
 * `eval.ts`, so the side-to-move flip is handled once, in one place.
 *
 *   winLoss = max(0, winBefore - winAfter)        (percentage points lost by the mover)
 *
 *   best        the played move equals the engine's first choice at `before`
 *   excellent   winLoss <= thresholds.excellent
 *   good        winLoss <= thresholds.good
 *   inaccuracy  winLoss <= thresholds.inaccuracy
 *   mistake     winLoss <= thresholds.mistake
 *   blunder     winLoss >  thresholds.mistake
 *
 * These are HEURISTIC labels derived from engine evaluations (which are themselves
 * depth-limited estimates). The `tags` below are stated separately:
 *   missed-mate   engine had a forced mate for the mover before; the move does not keep one
 *   allowed-mate  the move allows a forced mate against the mover that was not there before
 *   missed-win    mover was clearly winning (>= 80%) and is no longer (< 60%)
 *   opening       mistake/blunder within the first 10 full moves (heuristic by move number)
 *   tactical      mistake/blunder where the engine's preferred move was a capture, check or mate
 *                 (heuristic - it says a tactic existed, not that the player "missed" it knowingly)
 * A move is only classified when BOTH evaluations are complete (`complete: true`); otherwise
 * `moveClass` is null and `unclassifiedReason` says why.
 */

/**
 * GRADES (the Chess.com-style labels)
 * -----------------------------------
 * On top of the six base classes the review assigns one display grade per move. Chess.com's exact rules are
 * proprietary, so these are OUR documented approximations built from the same engine evaluations:
 *   book        the move is a known opening-book move and every earlier move of the game was too
 *   brilliant   a real sacrifice: the engine's best (or within the excellent threshold), but the move offers material
 *               that was not already hanging (see netSacrifice): the engine's best reply wins at least
 *               GRADE_RULES.brilliantMinSacrifice points because of it and the mover is still behind one move later,
 *               was not already clearly winning (< brilliantMaxWinBefore %) and is not worse afterwards
 *               (>= brilliantMinWinAfter %). Exception: if it is the ONLY way to keep a won position (second-best is
 *               >= greatMinGap points worse), an already-winning position still counts (needs >= brilliantOnlyWayMinWinAfter % after)
 *   great       the engine's best move, and the second-best move is at least greatMinGap winning-chance points worse
 *               (an "only move"), in a position with more than 2 legal moves that is not already won; a move that
 *               allows a forced mate is never great
 *   miss        an inaccuracy or mistake right after the opponent erred (>= missOpponentLoss points), or a missed
 *               forced mate / missed clear win after which the mover still has >= missMinWinAfter % (not a collapse)
 *   otherwise   the base class: best, excellent, good, inaccuracy, mistake, blunder
 * Precedence: book > brilliant > great > miss > base class.
 */
export type MoveGrade = MoveClass | 'brilliant' | 'great' | 'book' | 'miss';
export const GRADE_ORDER: readonly MoveGrade[] = ['brilliant', 'great', 'best', 'excellent', 'good', 'book', 'inaccuracy', 'mistake', 'miss', 'blunder'];
export const GRADE_RULES = {
  brilliantMinSacrifice: 2,
  brilliantMaxWinBefore: 90,
  brilliantMinWinAfter: 45,
  /** Brilliant when it is the only way to keep a won position: the position after the move must still be this good. */
  brilliantOnlyWayMinWinAfter: 90,
  greatMinGap: 15,
  greatMaxWinBefore: 90,
  greatMinLegalMoves: 3,
  missOpponentLoss: 10,
  missMinWinAfter: 40,
} as const;

export type MoveClass = 'best' | 'excellent' | 'good' | 'inaccuracy' | 'mistake' | 'blunder';
export type MoveTag = 'missed-mate' | 'allowed-mate' | 'missed-win' | 'opening' | 'tactical';

export const MOVE_CLASS_ORDER: readonly MoveClass[] = ['best', 'excellent', 'good', 'inaccuracy', 'mistake', 'blunder'];

export interface ClassifyThresholds {
  /** Upper bounds of winning-chance loss (percentage points). Above `mistake` = blunder. */
  excellent: number;
  good: number;
  inaccuracy: number;
  mistake: number;
}

export const DEFAULT_THRESHOLDS: ClassifyThresholds = { excellent: 2, good: 5, inaccuracy: 10, mistake: 20 };

/** Check that thresholds are finite, non-negative and increasing. */
export function normalizeThresholds(t: ClassifyThresholds): ClassifyThresholds {
  const clamp = (n: number, fallback: number) => (Number.isFinite(n) && n >= 0 ? Math.min(100, n) : fallback);
  const excellent = clamp(t.excellent, DEFAULT_THRESHOLDS.excellent);
  const good = Math.max(excellent, clamp(t.good, DEFAULT_THRESHOLDS.good));
  const inaccuracy = Math.max(good, clamp(t.inaccuracy, DEFAULT_THRESHOLDS.inaccuracy));
  const mistake = Math.max(inaccuracy, clamp(t.mistake, DEFAULT_THRESHOLDS.mistake));
  return { excellent, good, inaccuracy, mistake };
}

export interface PositionEval {
  score: WhiteScore;
  /** Engine's best move (UCI) in this position; null in terminal positions. */
  bestMove: string | null;
  /** False when the engine output was cut short or did not reach the requested depth. */
  complete: boolean;
}

export interface ClassifyInput {
  mover: Color;
  playedUci: string;
  before: PositionEval;
  after: PositionEval;
  /** Half-move index of the played move (1 = White's first move). */
  ply: number;
  /** Whether the engine's preferred move at `before` is a capture, check or mating move. */
  bestMoveIsForcing: boolean;
  thresholds?: ClassifyThresholds;
  /** Grade inputs (all optional; without them only the base classes are produced). */
  /** The move is an opening-book move and the whole game so far was book. */
  inBook?: boolean;
  /** Points of material the mover is down after the exchanges of the engine's line (0 = none). */
  sacrifice?: number;
  /** Winning-chance points (mover) between the best and the second-best move at `before`; null if unknown. */
  onlyMoveGap?: number | null;
  /** Number of legal moves in the position before the move. */
  legalMoves?: number;
  /** Winning-chance points the opponent's previous move lost (0 if unknown). */
  opponentLoss?: number;
}

export interface MoveClassification {
  moveClass: MoveClass | null;
  unclassifiedReason?: 'incomplete-engine-output';
  /** Winning chances (0..100) of the mover before/after the move. */
  winBefore: number;
  winAfter: number;
  /** Percentage points of winning chances lost by the mover (>= 0). */
  winLoss: number;
  /** 0..100, see `moveAccuracy`. */
  accuracy: number;
  isEngineBest: boolean;
  tags: MoveTag[];
  /** Display grade (see GRADES above); null while the move is unclassified. */
  grade: MoveGrade | null;
}

/**
 * Per-move accuracy from the winning-chance loss. Functional form and constants adapted
 * from the model Lichess publishes (open source); this is an ESTIMATE and does not
 * reproduce Lichess's or Chess.com's displayed numbers.
 */
export function moveAccuracy(winLoss: number): number {
  const raw = 103.1668 * Math.exp(-0.04354 * Math.max(0, winLoss)) - 3.1669;
  return Math.max(0, Math.min(100, raw));
}

export function classifyMove(input: ClassifyInput): MoveClassification {
  const thresholds = normalizeThresholds(input.thresholds ?? DEFAULT_THRESHOLDS);
  const { mover, before, after } = input;

  const winBefore = sideWinPercent(before.score, mover);
  const winAfter = sideWinPercent(after.score, mover);
  const winLoss = Math.max(0, winBefore - winAfter);
  const isEngineBest = before.bestMove !== null && before.bestMove === input.playedUci;

  const base = {
    winBefore,
    winAfter,
    winLoss,
    accuracy: moveAccuracy(winLoss),
    isEngineBest,
    tags: [] as MoveTag[],
    grade: null as MoveGrade | null,
  };

  if (!before.complete || !after.complete) {
    return { ...base, moveClass: null, unclassifiedReason: 'incomplete-engine-output', accuracy: Number.NaN };
  }

  let moveClass: MoveClass;
  if (isEngineBest) moveClass = 'best';
  else if (winLoss <= thresholds.excellent) moveClass = 'excellent';
  else if (winLoss <= thresholds.good) moveClass = 'good';
  else if (winLoss <= thresholds.inaccuracy) moveClass = 'inaccuracy';
  else if (winLoss <= thresholds.mistake) moveClass = 'mistake';
  else moveClass = 'blunder';

  const tags: MoveTag[] = [];
  // Mate handling is explicit and independent of the centipawn model.
  const beforeMate = mateWinner(before.score);
  const afterMate = mateWinner(after.score);
  if (beforeMate === mover && afterMate !== mover) tags.push('missed-mate');
  if (afterMate !== null && afterMate !== mover && beforeMate !== afterMate) tags.push('allowed-mate');
  if (!tags.includes('missed-mate') && winBefore >= 80 && winAfter < 60) tags.push('missed-win');

  const serious = moveClass === 'mistake' || moveClass === 'blunder';
  if (serious && input.ply <= 20) tags.push('opening');
  if (serious && input.bestMoveIsForcing) tags.push('tactical');

  return { ...base, moveClass, tags, grade: gradeMove(input, moveClass, { winBefore, winAfter, winLoss }, tags, thresholds) };
}

function gradeMove(
  input: ClassifyInput,
  moveClass: MoveClass,
  w: { winBefore: number; winAfter: number; winLoss: number },
  tags: readonly MoveTag[],
  thresholds: ClassifyThresholds,
): MoveGrade {
  const R = GRADE_RULES;
  if (input.inBook === true) return 'book';
  const nearBest = moveClass === 'best' || w.winLoss <= thresholds.excellent;
  // A sacrifice that is the ONLY way to keep a forced mate / win (every alternative is clearly worse)
  // is brilliant even though the position was already winning before the move.
  const onlyWayToWin =
    input.onlyMoveGap !== null && input.onlyMoveGap !== undefined && input.onlyMoveGap >= R.greatMinGap && w.winAfter >= R.brilliantOnlyWayMinWinAfter;
  const notAlreadyWon = w.winBefore < R.brilliantMaxWinBefore;
  if (nearBest && (input.sacrifice ?? 0) >= R.brilliantMinSacrifice && (notAlreadyWon || onlyWayToWin) && w.winAfter >= R.brilliantMinWinAfter) return 'brilliant';
  if (
    moveClass === 'best' &&
    input.onlyMoveGap !== null && input.onlyMoveGap !== undefined && input.onlyMoveGap >= R.greatMinGap &&
    (input.legalMoves ?? 0) >= R.greatMinLegalMoves &&
    w.winBefore < R.greatMaxWinBefore &&
    !tags.includes('allowed-mate')
  ) return 'great';
  const missable = moveClass === 'inaccuracy' || moveClass === 'mistake';
  if (missable && (input.opponentLoss ?? 0) >= R.missOpponentLoss) return 'miss';
  // A forced mate or a clear win was there and was not kept, but the game is not lost either.
  const failedToConvert = (tags.includes('missed-mate') || tags.includes('missed-win')) && !tags.includes('allowed-mate');
  if (failedToConvert && moveClass !== 'best' && w.winAfter >= R.missMinWinAfter) return 'miss';
  return moveClass;
}

/** True when the move is a capture, gives check, or the engine scored the position as a forced mate. */
export function isForcingMove(fenBefore: string, uci: string, scoreIsMate: boolean): boolean {
  if (scoreIsMate) return true;
  return moveIsCaptureOrCheck(fenBefore, uci);
}

function moveIsCaptureOrCheck(fen: string, uci: string): boolean {
  try {
    const chess = new Chess(fen);
    const move = chess.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      ...(uci.length === 5 ? { promotion: uci.slice(4) } : {}),
    });
    return move.isCapture() || move.isEnPassant() || chess.inCheck();
  } catch {
    return false;
  }
}
