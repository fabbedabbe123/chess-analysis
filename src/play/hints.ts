import { Chess, type Move } from 'chess.js';
import { pvToSan } from '@/analysis/pv';
import { detectTactics } from '@/analysis/tactics';
import type { PieceType } from '@/types/game';

/**
 * Progressive hints. Everything numeric (score, best move, line) comes from Stockfish; the WORDS describing the
 * move's purpose are rule-based observations about the board (captures, checks, castling, retreats, development)
 * and are labelled as such. They explain WHAT the move does, not why the engine prefers it beyond its score.
 */

export type MovePurpose = 'tactical' | 'defensive' | 'attacking' | 'positional';

const PIECE: Record<PieceType, string> = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
const VALUE: Record<PieceType, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };

export interface MoveFacts {
  san: string;
  uci: string;
  from: string;
  to: string;
  piece: PieceType;
  captured: PieceType | null;
  check: boolean;
  mate: boolean;
  castle: boolean;
  promotion: boolean;
  purpose: MovePurpose;
  /** One sentence on what the move does. */
  purposeText: string;
  /** What threatens the mover now (their pieces that are attacked and unprotected / attacked by something cheaper). */
  threatenedSquares: string[];
}

function attackedBy(chess: Chess, square: string, by: 'w' | 'b'): string[] {
  return chess.attackers(square as never, by) as string[];
}

/** Describes `uci` played in `fen`; null if it is not legal there. */
export function describeMove(fen: string, uci: string): MoveFacts | null {
  let chess: Chess;
  try {
    chess = new Chess(fen);
  } catch {
    return null;
  }
  const mover = chess.turn();
  const opp = mover === 'w' ? 'b' : 'w';
  let move: Move;
  try {
    move = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), ...(uci.length === 5 ? { promotion: uci[4] as string } : {}) });
  } catch {
    return null;
  }
  const piece = move.piece as PieceType;
  const captured = (move.captured ?? null) as PieceType | null;
  const mate = chess.isCheckmate();
  const check = chess.inCheck();
  const castle = move.isKingsideCastle() || move.isQueensideCastle();
  const promotion = move.promotion !== undefined;

  // Was the moved piece (before the move) in danger? Compare on the position BEFORE the move.
  const before = new Chess(fen);
  const wasAttacked = attackedBy(before, move.from, opp).length > 0;
  const wasDefended = attackedBy(before, move.from, mover).length > 0;
  const hanging = wasAttacked && (!wasDefended || attackedBy(before, move.from, opp).some((s) => VALUE[(before.get(s as never)?.type ?? 'k') as PieceType] < VALUE[piece]));
  const threatened = detectTactics(fen)
    .filter((t) => t.color === mover && (t.kind === 'hanging' || t.kind === 'threatened'))
    .flatMap((t) => t.squares as string[]);

  // After the move: does the moved piece now attack something valuable and loose?
  let attacksTarget = false;
  const afterBoard = chess;
  for (const row of afterBoard.board()) {
    for (const cell of row) {
      if (cell === null || cell.color !== opp || cell.type === 'k') continue;
      if (!attackedBy(afterBoard, cell.square, mover).includes(move.to)) continue;
      const loose = attackedBy(afterBoard, cell.square, opp).length === 0;
      if (loose || VALUE[cell.type as PieceType] > VALUE[piece]) attacksTarget = true;
    }
  }

  let purpose: MovePurpose;
  let purposeText: string;
  const name = PIECE[piece];
  if (mate) {
    purpose = 'tactical';
    purposeText = 'It delivers checkmate.';
  } else if (promotion) {
    purpose = 'tactical';
    purposeText = 'It promotes a pawn.';
  } else if (captured !== null) {
    purpose = 'tactical';
    purposeText = VALUE[captured] > VALUE[piece]
      ? `It wins material: your ${name} captures a more valuable ${PIECE[captured]}.`
      : `It captures a ${PIECE[captured]}, a tactical move that changes the material balance or removes an attacker.`;
  } else if (check) {
    purpose = 'tactical';
    purposeText = `It gives check with the ${name}, a forcing move that limits the opponent's replies.`;
  } else if (hanging && threatened.includes(move.from)) {
    purpose = 'defensive';
    purposeText = `It moves your ${name} out of danger: it was attacked and not safely defended.`;
  } else if (castle) {
    purpose = 'defensive';
    purposeText = 'It castles: the king gets safer and a rook joins the game.';
  } else if (attacksTarget) {
    purpose = 'attacking';
    purposeText = `It creates a threat: the ${name} now attacks a piece that is loose or worth more.`;
  } else if (threatened.length > 0) {
    purpose = 'defensive';
    purposeText = 'It reorganises your position while a piece of yours is under pressure.';
  } else if ((piece === 'n' || piece === 'b') && ['1', '8'].includes(move.from[1] as string)) {
    purpose = 'positional';
    purposeText = `It develops the ${name}, bringing it into play from the back rank.`;
  } else if (piece === 'p') {
    purpose = 'positional';
    purposeText = 'It is a pawn move that changes the structure or gains space.';
  } else {
    purpose = 'positional';
    purposeText = `It improves the activity of your ${name}.`;
  }
  return { san: move.san, uci, from: move.from, to: move.to, piece, captured, check, mate, castle, promotion, purpose, purposeText, threatenedSquares: threatened };
}

export interface HintContent {
  /** 1: general idea (no piece named) */
  level1: string;
  /** 2: which piece / what to look at, no destination */
  level2: string;
  /** 3: the move and the line. */
  level3: { san: string; from: string; to: string; line: string; scoreText: string; purposeText: string; purpose: MovePurpose };
}

export function buildHint(fen: string, bestPv: readonly string[], scoreText: string): HintContent | null {
  const best = bestPv[0];
  if (best === undefined) return null;
  const facts = describeMove(fen, best);
  if (facts === null) return null;
  const threatened = facts.threatenedSquares;

  const level1 = {
    tactical: 'There is something forcing in this position. Check captures, checks and threats before quiet moves.',
    defensive: threatened.length > 0
      ? 'Your position needs care: one of your pieces is under pressure. Make sure everything is safe before attacking.'
      : 'Safety first: consider king safety and your opponent\'s threats before anything else.',
    attacking: 'You can put pressure on the opponent. Look for a move that attacks a loose or valuable piece.',
    positional: 'There is no immediate tactic. Improve your worst-placed piece or develop and keep the structure healthy.',
  }[facts.purpose];

  const bits: string[] = [`Think about your ${PIECE[facts.piece]}.`];
  if (threatened.length > 0) bits.push(`Pieces on ${threatened.join(', ')} are under attack.`);
  if (facts.captured !== null) bits.push('The best move is a capture.');
  else if (facts.check) bits.push('The best move gives check.');
  else if (facts.castle) bits.push('Consider moving the king to safety.');
  const level2 = bits.join(' ');

  const conv = pvToSan(fen, bestPv as string[], 6);
  const line = conv.moves.map((m, i) => `${m.color === 'w' ? `${m.moveNumber}.` : i === 0 ? `${m.moveNumber}...` : ''}${m.san}`).join(' ');
  return { level1, level2, level3: { san: facts.san, from: facts.from, to: facts.to, line, scoreText, purposeText: facts.purposeText, purpose: facts.purpose } };
}
