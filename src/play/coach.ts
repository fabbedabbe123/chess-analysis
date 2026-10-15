import { Chess } from 'chess.js';
import { mateDistance, mateWinner } from '@/analysis/eval';
import { pvToSan } from '@/analysis/pv';
import type { ReviewMove, ReviewResult } from '@/analysis/review';
import type { PuzzleTheme } from '@/puzzles/puzzles';
import type { Color } from '@/types/engine';
import type { PieceType } from '@/types/game';

/**
 * Coaching report. Two layers, kept apart on purpose:
 *  - OBJECTIVE (engine): which move was played, which move Stockfish preferred, the evaluations before/after, the line.
 *  - RULE-BASED (this file): deciding which category a mistake belongs to and the wording of the lesson. These are
 *    deterministic rules over board facts and engine data, NOT output of a language model, and the category is a
 *    heuristic label (e.g. "pawn structure" = the played move was a pawn move and the engine preferred another kind).
 * No external AI service is used, so the report works offline and cannot invent evaluations.
 */

export type CoachCategory = 'opening' | 'tactics' | 'positional' | 'kingSafety' | 'pieceActivity' | 'pawnStructure' | 'endgame' | 'calculation';

export const CATEGORY_LABEL: Record<CoachCategory, string> = {
  opening: 'Opening',
  tactics: 'Tactics',
  positional: 'Positional play',
  kingSafety: 'King safety',
  pieceActivity: 'Piece activity',
  pawnStructure: 'Pawn structure',
  endgame: 'Endgame technique',
  calculation: 'Calculation & missed opportunities',
};
/** Lessons (skill ids in public/data/lessons.json) that practise each coach category. Rule-based pointers, not diagnoses. */
export const RELATED_LESSONS: Record<CoachCategory, readonly string[]> = {
  opening: ['opening-principles'],
  tactics: ['forks', 'pins', 'skewers', 'discovered'],
  positional: ['trades'],
  kingSafety: ['backrank'],
  pieceActivity: ['opening-principles'],
  pawnStructure: [],
  endgame: ['king-pawn', 'opposition', 'lucena', 'philidor'],
  calculation: ['sacrifices', 'deflection'],
};
export const CATEGORY_ORDER = Object.keys(CATEGORY_LABEL) as CoachCategory[];

export interface CoachExample {
  category: CoachCategory;
  move: ReviewMove;
  bestSan: string | null;
  bestLine: string;
  /** What the engine data says (objective). */
  facts: string;
  /** What to remember (rule-based). */
  lesson: string;
  /** Puzzle themes that train this specific pattern; empty when the bundled set has nothing relevant. */
  themes: PuzzleTheme[];
}

export interface Strength {
  move: ReviewMove;
  text: string;
}

export interface CoachReport {
  userColor: Color;
  /** Mistakes (inaccuracy or worse) of the user, each placed in exactly one category. */
  mistakes: CoachExample[];
  /** Mistake counts per category. */
  counts: Record<CoachCategory, number>;
  /** The most instructive example per category that has one (worst first). */
  examples: CoachExample[];
  strengths: Strength[];
  headline: string[];
}

const pieceAt = (fen: string, sq: string): PieceType | null => {
  try {
    return (new Chess(fen).get(sq as never)?.type ?? null) as PieceType | null;
  } catch {
    return null;
  }
};

function nonPawnMaterialPieces(fen: string): number {
  const board = fen.split(' ')[0] ?? '';
  return [...board].filter((c) => 'nbrqNBRQ'.includes(c)).length;
}

function replyChecksMover(m: ReviewMove): boolean {
  const reply = m.after.bestMove;
  if (reply === null) return false;
  try {
    const c = new Chess(m.after.fen);
    c.move({ from: reply.slice(0, 2), to: reply.slice(2, 4), ...(reply.length === 5 ? { promotion: reply[4] as string } : {}) });
    return c.inCheck();
  } catch {
    return false;
  }
}

/** The opponent's best reply captures the piece that just moved: the move left a piece en prise. */
function replyCapturesMovedPiece(m: ReviewMove): boolean {
  const reply = m.after.bestMove;
  return reply !== null && reply.slice(2, 4) === m.uci.slice(2, 4) && pieceAt(m.after.fen, reply.slice(2, 4)) !== null;
}

function bestIsQuietPieceMove(m: ReviewMove): boolean {
  const best = m.before.bestMove;
  if (best === null) return false;
  const piece = pieceAt(m.fenBefore, best.slice(0, 2));
  if (piece === null || piece === 'p' || piece === 'k') return false;
  return pieceAt(m.fenBefore, best.slice(2, 4)) === null;
}

/** Puts one user mistake into one category (first matching rule wins; see file header for the caveat). */
export function categorize(m: ReviewMove): CoachCategory {
  const tags = m.classification.tags;
  if (tags.includes('missed-mate') || tags.includes('missed-win')) return 'calculation';
  if (tags.includes('allowed-mate')) return 'kingSafety';
  if (nonPawnMaterialPieces(m.fenBefore) <= 4) return 'endgame';
  if (tags.includes('tactical') || replyCapturesMovedPiece(m)) return 'tactics';
  if (tags.includes('opening')) return 'opening';
  if (replyChecksMover(m)) return 'kingSafety';
  const playedPiece = pieceAt(m.fenBefore, m.uci.slice(0, 2));
  if (playedPiece === 'p' && m.before.bestMove !== null && pieceAt(m.fenBefore, m.before.bestMove.slice(0, 2)) !== 'p') return 'pawnStructure';
  if (bestIsQuietPieceMove(m)) return 'pieceActivity';
  return 'positional';
}

export function themesFor(m: ReviewMove, category: CoachCategory): PuzzleTheme[] {
  const tags = m.classification.tags;
  if (tags.includes('missed-mate')) {
    const d = mateDistance(m.before.score);
    return d === 1 ? ['mate1'] : d === 2 ? ['mate2'] : d === 3 ? ['mate3'] : ['tactic'];
  }
  if (tags.includes('allowed-mate') || category === 'kingSafety') return ['defence'];
  if (tags.includes('tactical') || tags.includes('missed-win') || category === 'tactics') return ['tactic'];
  return [];
}

const pct = (n: number): string => `${Math.round(n)}%`;

function factsFor(m: ReviewMove, bestSan: string | null): string {
  const cls = m.classification;
  const base = `${m.moveNumber}${m.color === 'w' ? '.' : '...'} ${m.san} dropped your winning chances from ${pct(cls.winBefore)} to ${pct(cls.winAfter)} (Stockfish, depth ${m.before.depth}).`;
  const best = bestSan !== null ? ` The engine preferred ${bestSan}.` : '';
  const mate = cls.tags.includes('missed-mate') ? ` You had a forced mate${mateDistance(m.before.score) !== null ? ` in ${mateDistance(m.before.score)}` : ''}.` : cls.tags.includes('allowed-mate') ? ' The move allowed a forced mate.' : '';
  return base + best + mate;
}

const LESSON: Record<CoachCategory, string> = {
  opening: 'In the opening, develop pieces, fight for the centre and avoid moving the same piece twice or grabbing material at the cost of development. When unsure, compare with the book move in the Openings tab.',
  tactics: 'Before every move, list the opponent\'s forcing replies (checks, captures, threats). Here a forcing idea was available or allowed - look for those first.',
  positional: 'Quiet moves still matter: ask which of your pieces is worst placed and which of the opponent\'s ideas you must stop before choosing a plan.',
  kingSafety: 'Ask "what is my opponent\'s most forcing reply?" after each candidate move. This move gave the opponent a strong attack or check against your king.',
  pieceActivity: 'The engine preferred activating a piece. Before pushing pawns or shuffling, bring the least active piece to a useful square.',
  pawnStructure: 'Pawn moves cannot be undone. Here a pawn move was worse than a piece move; check what the pawn leaves undefended before pushing it.',
  endgame: 'In endgames, king activity, passed pawns and exact calculation decide the game. Count moves concretely instead of relying on general rules.',
  calculation: 'You had a much better move than the one played. When the position is sharp, calculate forcing lines to the end before choosing, and double-check mates and wins of material.',
};

export function bestSanOf(m: ReviewMove): { san: string | null; line: string } {
  const best = m.before.bestMove;
  if (best === null) return { san: null, line: '' };
  const pv = m.before.bestPv.length > 0 ? m.before.bestPv : [best];
  const conv = pvToSan(m.fenBefore, pv, 6);
  const line = conv.moves.map((x, i) => `${x.color === 'w' ? `${x.moveNumber}.` : i === 0 ? `${x.moveNumber}...` : ''}${x.san}`).join(' ');
  return { san: conv.moves[0]?.san ?? null, line };
}

export function buildCoachReport(result: ReviewResult, userColor: Color): CoachReport {
  const counts = Object.fromEntries(CATEGORY_ORDER.map((c) => [c, 0])) as Record<CoachCategory, number>;
  const mistakes: CoachExample[] = [];
  for (const m of result.moves) {
    if (m.color !== userColor) continue;
    const cls = m.classification.moveClass;
    if (cls !== 'inaccuracy' && cls !== 'mistake' && cls !== 'blunder') continue;
    const category = categorize(m);
    counts[category] += 1;
    const { san, line } = bestSanOf(m);
    mistakes.push({ category, move: m, bestSan: san, bestLine: line, facts: factsFor(m, san), lesson: LESSON[category], themes: themesFor(m, category) });
  }
  mistakes.sort((a, b) => b.move.classification.winLoss - a.move.classification.winLoss);

  const examples: CoachExample[] = [];
  for (const c of CATEGORY_ORDER) {
    const first = mistakes.find((x) => x.category === c);
    if (first !== undefined) examples.push(first);
  }

  const strengths: Strength[] = result.moves
    .filter((m) => m.color === userColor && (m.classification.moveClass === 'best' || m.classification.moveClass === 'excellent'))
    .map((m) => ({ m, gain: (userColor === 'w' ? 1 : -1) * m.swing }))
    .filter(({ m, gain }) => gain >= 3 || (m.classification.moveClass === 'best' && m.before.bestMove !== null && m.classification.tags.length === 0 && gain >= 1))
    .sort((a, b) => b.gain - a.gain)
    .slice(0, 3)
    .map(({ m, gain }) => ({ move: m, text: `${m.moveNumber}${m.color === 'w' ? '.' : '...'} ${m.san} was ${m.classification.moveClass === 'best' ? 'the engine\'s top choice' : 'close to the best'} and raised your winning chances by ${pct(gain)}.` }));

  const headline: string[] = [];
  const total = mistakes.length;
  if (total === 0) headline.push('No inaccuracies, mistakes or blunders were found at the review depth.');
  else {
    const top = CATEGORY_ORDER.filter((c) => counts[c] > 0).sort((a, b) => counts[b] - counts[a])[0];
    if (top !== undefined) headline.push(`${total} move${total === 1 ? '' : 's'} lost winning chances; the most common area was ${CATEGORY_LABEL[top].toLowerCase()} (${counts[top]}).`);
  }
  const blunders = mistakes.filter((x) => x.move.classification.moveClass === 'blunder').length;
  if (blunders > 0) headline.push(`${blunders} blunder${blunders === 1 ? '' : 's'}: those decided most of the game.`);

  return { userColor, mistakes, counts, examples, strengths, headline };
}

export { mateWinner };
