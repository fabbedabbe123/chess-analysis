import { Chess } from 'chess.js';
import { getNode, mainLine } from '@/chess/gameTree';
import { sideToMove } from '@/chess/fen';
import {
  type EngineOptions,
  type SearchRequest,
  type SearchSnapshot,
  type Color,
  type WhiteScore,
} from '@/types/engine';
import type { GameTree } from '@/types/game';
import {
  classifyMove,
  isForcingMove,
  MOVE_CLASS_ORDER,
  normalizeThresholds,
  type ClassifyThresholds,
  type MoveClassification,
  type MoveClass,
  type MoveGrade,
  type PositionEval,
  GRADE_ORDER,
} from './classify';
import { checkmateScore, drawScore, sideWinPercent, whiteWinPercent } from './eval';

export class ReviewAbortedError extends Error {
  constructor() {
    super('Review cancelled');
    this.name = 'ReviewAbortedError';
  }
}

/** The slice of StockfishEngine the review needs (lets tests supply a deterministic fake). */
export interface ReviewEngine {
  search(req: SearchRequest): { result: Promise<SearchSnapshot> };
  stop(): void;
}

export interface PositionRecord extends PositionEval {
  fen: string;
  /** Depth the engine reached (0 for terminal positions that were never searched). */
  depth: number;
  /** Principal variation of the best line (UCI). */
  bestPv: string[];
  terminal: 'checkmate' | 'stalemate' | 'draw' | null;
  /** Score of the second-best line (MultiPV 2); undefined when the engine reported only one line. */
  secondScore?: WhiteScore;
}

export interface ReviewMove {
  nodeId: string;
  /** 1 = first half-move of the game. */
  ply: number;
  san: string;
  uci: string;
  color: Color;
  moveNumber: number;
  fenBefore: string;
  before: PositionRecord;
  after: PositionRecord;
  classification: MoveClassification;
  /** Signed change of White's winning chances caused by this move (percentage points). */
  swing: number;
}

export interface ReviewSummary {
  totalMoves: number;
  movesAnalyzed: number;
  unclassified: number;
  /** Mean of per-move accuracies (see classify.ts); null if a side has no classified move. */
  accuracy: Record<Color, number | null>;
  counts: Record<Color, Record<MoveClass, number>>;
  /** Display grades (Chess.com-style): every classified move is counted once. */
  grades: Record<Color, Record<MoveGrade, number>>;
  missedMates: Record<Color, number>;
  missedWins: Record<Color, number>;
  allowedMates: Record<Color, number>;
  openingMistakes: Record<Color, number>;
  tacticalErrors: Record<Color, number>;
  /** Turning points, blunders and missed/allowed mates in game order (max 10). */
  criticalMoments: ReviewMove[];
  /** Five largest absolute swings in White's winning chances. */
  biggestSwings: ReviewMove[];
  /** Moves after which the clearly better side changed. */
  turningPoints: ReviewMove[];
  /** Mistakes/blunders, worst first: positions BEFORE the move are worth studying. */
  studyPositions: ReviewMove[];
}

export interface ReviewResult {
  depth: number;
  thresholds: ClassifyThresholds;
  moves: ReviewMove[];
  /** White's winning chances (0..100) for every position of the main line, ply 0..N. */
  whiteWinGraph: number[];
  summary: ReviewSummary;
  completedAt: number;
}

// -------------------------------------------------------------------- cache

/**
 * Evaluation cache. The key contains the FULL fen (the engine sees nothing else) AND the
 * settings key (depth, MultiPV, strength...), so results produced under different search
 * conditions can never be mixed up.
 */
export class EvalCache {
  private readonly map = new Map<string, PositionRecord>();
  constructor(private readonly limit = 4000) {}

  private key(fen: string, settingsKey: string): string {
    return `${settingsKey}#${fen}`;
  }

  get(fen: string, settingsKey: string): PositionRecord | undefined {
    const k = this.key(fen, settingsKey);
    const hit = this.map.get(k);
    if (hit !== undefined) {
      this.map.delete(k); // refresh LRU position
      this.map.set(k, hit);
    }
    return hit;
  }

  set(fen: string, settingsKey: string, record: PositionRecord): void {
    // Never cache incomplete results: they are not a reliable answer for anyone.
    if (!record.complete) return;
    const k = this.key(fen, settingsKey);
    this.map.delete(k);
    this.map.set(k, record);
    if (this.map.size > this.limit) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
  }

  get size(): number {
    return this.map.size;
  }
}

// ----------------------------------------------------------- position eval

function terminalRecord(fen: string): PositionRecord | null {
  let chess: Chess;
  try {
    chess = new Chess(fen);
  } catch {
    return null;
  }
  const base = { fen, depth: 0, bestMove: null, bestPv: [] as string[], complete: true };
  if (chess.isCheckmate()) return { ...base, score: checkmateScore(sideToMove(fen)), terminal: 'checkmate' };
  if (chess.isStalemate()) return { ...base, score: drawScore(), terminal: 'stalemate' };
  if (chess.isInsufficientMaterial() || chess.isDrawByFiftyMoves()) {
    return { ...base, score: drawScore(), terminal: 'draw' };
  }
  return null;
}

/** Score of a position that needs no engine (checkmate, stalemate, dead draw), else null. */
export function terminalScore(fen: string): WhiteScore | null {
  return terminalRecord(fen)?.score ?? null;
}

function legalMoveCount(fen: string): number {
  try {
    return new Chess(fen).moves().length;
  } catch {
    return 0;
  }
}

/** Options used for reviews: always full strength, whatever the play-strength setting says. */
export function reviewOptions(base: EngineOptions): EngineOptions {
  return { ...base, skillLevel: 20, limitStrength: false };
}

export function toPositionRecord(fen: string, snapshot: SearchSnapshot, requestedDepth: number): PositionRecord {
  const top = snapshot.lines[0];
  const finishedNaturally = snapshot.done && snapshot.endReason === 'completed';
  const reached = top !== undefined && (top.depth >= requestedDepth || legalMoveCount(fen) <= 1 || top.scoreWhite.kind === 'mate');
  const complete = finishedNaturally && top !== undefined && snapshot.bestMove !== null && reached;
  const score: WhiteScore = top?.scoreWhite ?? drawScore();
  return {
    fen,
    score,
    bestMove: snapshot.bestMove ?? top?.pv[0] ?? null,
    bestPv: top?.pv ?? [],
    depth: top?.depth ?? 0,
    complete,
    terminal: null,
    ...(snapshot.lines[1] !== undefined ? { secondScore: snapshot.lines[1].scoreWhite } : {}),
  };
}

async function evaluatePosition(
  fen: string,
  engine: ReviewEngine,
  depth: number,
  options: EngineOptions,
  newGame: boolean,
): Promise<PositionRecord> {
  const request: SearchRequest = { fen, multiPv: 2, limits: { depth }, options, newGame };
  let record = toPositionRecord(fen, await engine.search(request).result, depth);
  if (!record.complete) {
    // One retry: a transient early stop must not make a whole game unclassifiable.
    record = toPositionRecord(fen, await engine.search({ ...request, newGame: false }).result, depth);
  }
  return record;
}

// ------------------------------------------------------------------ summary

function emptyCounts(): Record<MoveClass, number> {
  return { best: 0, excellent: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0 };
}

function perColor<T>(make: () => T): Record<Color, T> {
  return { w: make(), b: make() };
}

function emptyGrades(): Record<MoveGrade, number> {
  return Object.fromEntries(GRADE_ORDER.map((g) => [g, 0])) as Record<MoveGrade, number>;
}

const PIECE_POINTS: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9 };
function materialFor(chess: Chess, color: Color): number {
  let sum = 0;
  for (const row of chess.board()) for (const sq of row) {
    if (sq === null || sq.type === 'k') continue;
    sum += (sq.color === color ? 1 : -1) * (PIECE_POINTS[sq.type] ?? 0);
  }
  return sum;
}

/**
 * Points of material the mover has offered with this move, or 0 if it is not a sacrifice. It is one when the engine's best
 * reply (`pv[0]`) wins material because of the move (the capture was not possible before it: the moved piece itself can be
 * taken, or the move uncovers something) and the mover is still behind after the next move of the line (so it is not an
 * even exchange). A loss that was already on the board before the move (a piece that was hanging anyway) is not a sacrifice.
 */
export function netSacrifice(fenBefore: string, uci: string, pv: readonly string[], mover: Color): number {
  try {
    const reply = pv[0];
    if (reply === undefined) return 0;
    const play = (chess: Chess, m: string) => chess.move({ from: m.slice(0, 2), to: m.slice(2, 4), ...(m.length === 5 ? { promotion: m.slice(4) } : {}) });
    const chess = new Chess(fenBefore);
    const start = materialFor(chess, mover);
    play(chess, uci);
    const captured = play(chess, reply).captured;
    if (captured === undefined) return 0;
    const dropped = start - materialFor(chess, mover);
    // already hanging before the move? Same capture available with the opponent to move in the position before it.
    try {
      const parts = fenBefore.split(' ');
      parts[1] = mover === 'w' ? 'b' : 'w';
      parts[3] = '-';
      const before = new Chess(parts.join(' '));
      if (before.moves({ verbose: true }).some((m) => m.from === reply.slice(0, 2) && m.to === reply.slice(2, 4) && m.captured === captured)) return 0;
    } catch {
      // the flipped position is not legal (e.g. a king in check): the capture could not have been played before
    }
    const next = pv[1];
    if (next !== undefined) {
      play(chess, next);
      if (start - materialFor(chess, mover) < 1) return 0;
    } else if (!chess.isGameOver()) {
      return 0;
    }
    return Math.max(0, dropped);
  } catch {
    return 0;
  }
}

/** Pure aggregation of classified moves (unit-tested without an engine). */
export function summarizeReview(moves: readonly ReviewMove[]): ReviewSummary {
  const counts = perColor(emptyCounts);
  const grades = perColor(emptyGrades);
  const missedMates = perColor(() => 0);
  const missedWins = perColor(() => 0);
  const allowedMates = perColor(() => 0);
  const openingMistakes = perColor(() => 0);
  const tacticalErrors = perColor(() => 0);
  const accuracySum = perColor(() => 0);
  const accuracyN = perColor(() => 0);
  let analyzed = 0;

  for (const m of moves) {
    const c = m.classification;
    if (c.moveClass === null) continue;
    analyzed += 1;
    counts[m.color][c.moveClass] += 1;
    grades[m.color][c.grade ?? c.moveClass] += 1;
    accuracySum[m.color] += c.accuracy;
    accuracyN[m.color] += 1;
    if (c.tags.includes('missed-mate')) missedMates[m.color] += 1;
    if (c.tags.includes('missed-win')) missedWins[m.color] += 1;
    if (c.tags.includes('allowed-mate')) allowedMates[m.color] += 1;
    if (c.tags.includes('opening')) openingMistakes[m.color] += 1;
    if (c.tags.includes('tactical')) tacticalErrors[m.color] += 1;
  }

  const accuracy: Record<Color, number | null> = {
    w: accuracyN.w > 0 ? accuracySum.w / accuracyN.w : null,
    b: accuracyN.b > 0 ? accuracySum.b / accuracyN.b : null,
  };

  const classified = moves.filter((m) => m.classification.moveClass !== null);
  const bySwing = [...classified].sort((a, b) => Math.abs(b.swing) - Math.abs(a.swing));
  const biggestSwings = bySwing.slice(0, 5);

  const turningPoints = classified.filter((m) => {
    const before = whiteWinPercent(m.before.score);
    const after = whiteWinPercent(m.after.score);
    return (before >= 60 && after <= 40) || (before <= 40 && after >= 60);
  });

  const criticalSet = new Set<ReviewMove>(turningPoints);
  for (const m of classified) {
    const tags = m.classification.tags;
    if (
      m.classification.moveClass === 'blunder' ||
      tags.includes('missed-mate') ||
      tags.includes('allowed-mate') ||
      tags.includes('missed-win')
    ) {
      criticalSet.add(m);
    }
  }
  const criticalMoments = [...criticalSet].sort((a, b) => a.ply - b.ply).slice(0, 10);

  const studyPositions = classified
    .filter((m) => m.classification.moveClass === 'mistake' || m.classification.moveClass === 'blunder')
    .sort((a, b) => b.classification.winLoss - a.classification.winLoss)
    .slice(0, 8);

  return {
    totalMoves: moves.length,
    movesAnalyzed: analyzed,
    unclassified: moves.length - analyzed,
    accuracy,
    counts,
    grades,
    missedMates,
    missedWins,
    allowedMates,
    openingMistakes,
    tacticalErrors,
    criticalMoments,
    biggestSwings,
    turningPoints,
    studyPositions,
  };
}

// ------------------------------------------------------------------- runner

export interface RunReviewParams {
  tree: GameTree;
  engine: ReviewEngine;
  depth: number;
  options: EngineOptions;
  thresholds: ClassifyThresholds;
  cache?: EvalCache;
  /** Fingerprint of the engine/settings for the cache (see makeSettingsKey). */
  settingsKey?: string;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
  /** True if `uci` is an opening-book move in `fen` (used for the Book grade). */
  isBookMove?: (fen: string, uci: string) => boolean;
}

/** Evaluate every position of the MAIN line with identical settings and classify each move. */
export async function runReview(params: RunReviewParams): Promise<ReviewResult> {
  const { tree, engine, depth, signal, onProgress } = params;
  const thresholds = normalizeThresholds(params.thresholds);
  const options = reviewOptions(params.options);
  const settingsKey = params.settingsKey ?? `review|mpv2|d${depth}|h${options.hashMb}`;
  const nodes = mainLine(tree).map((id) => getNode(tree, id));
  const records: PositionRecord[] = [];

  const onAbort = () => engine.stop();
  signal?.addEventListener('abort', onAbort);
  try {
    for (let i = 0; i < nodes.length; i += 1) {
      if (signal?.aborted) throw new ReviewAbortedError();
      const node = nodes[i];
      if (node === undefined) continue;

      let record: PositionRecord | null = terminalRecord(node.fen);
      if (record === null) {
        const cached = params.cache?.get(node.fen, settingsKey);
        if (cached !== undefined) record = cached;
      }
      if (record === null) {
        try {
          record = await evaluatePosition(node.fen, engine, depth, options, i === 0);
        } catch (error) {
          if (signal?.aborted) throw new ReviewAbortedError();
          throw error;
        }
        if (signal?.aborted) throw new ReviewAbortedError();
        params.cache?.set(node.fen, settingsKey, record);
      }
      records.push(record);
      onProgress?.(i + 1, nodes.length);
    }
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }

  const moves: ReviewMove[] = [];
  let stillBook = params.isBookMove !== undefined;
  for (let i = 1; i < nodes.length; i += 1) {
    const node = nodes[i];
    const before = records[i - 1];
    const after = records[i];
    const parent = nodes[i - 1];
    if (node === undefined || before === undefined || after === undefined || parent === undefined || node.color === undefined) continue;

    const bestIsMate = before.score.kind === 'mate';
    const forcing = before.bestMove !== null && isForcingMove(parent.fen, before.bestMove, bestIsMate);
    const inBook = stillBook && params.isBookMove !== undefined && params.isBookMove(parent.fen, node.uci);
    if (!inBook) stillBook = false;
    const prev = moves[moves.length - 1];
    const onlyMoveGap =
      before.secondScore !== undefined
        ? sideWinPercent(before.score, node.color) - sideWinPercent(before.secondScore, node.color)
        : null;
    const classification = classifyMove({
      mover: node.color,
      playedUci: node.uci,
      before,
      after,
      ply: node.ply,
      bestMoveIsForcing: forcing,
      thresholds,
      inBook,
      sacrifice: netSacrifice(parent.fen, node.uci, after.bestPv, node.color),
      onlyMoveGap,
      legalMoves: legalMoveCount(parent.fen),
      opponentLoss: prev !== undefined && prev.color !== node.color ? prev.classification.winLoss : 0,
    });
    moves.push({
      nodeId: node.id,
      ply: node.ply,
      san: node.san,
      uci: node.uci,
      color: node.color,
      moveNumber: node.moveNumber,
      fenBefore: parent.fen,
      before,
      after,
      classification,
      swing: whiteWinPercent(after.score) - whiteWinPercent(before.score),
    });
  }

  return {
    depth,
    thresholds,
    moves,
    whiteWinGraph: records.map((r) => whiteWinPercent(r.score)),
    summary: summarizeReview(moves),
    completedAt: Date.now(),
  };
}

export { MOVE_CLASS_ORDER };
