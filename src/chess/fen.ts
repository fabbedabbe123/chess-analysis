import { Chess, validateFen } from 'chess.js';
import type { Color } from '@/types/game';

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export type FenValidation = { ok: true; fen: string } | { ok: false; error: string };

/**
 * Validate and normalise a FEN string.
 *  - accepts 4-field FENs (missing move counters become "0 1")
 *  - collapses whitespace
 *  - rejects positions chess.js considers malformed AND positions where the side
 *    that is NOT to move is already in check (unreachable by legal play)
 */
export function validateAndNormalizeFen(input: string): FenValidation {
  const trimmed = input.trim().replace(/\s+/g, ' ');
  if (trimmed.length === 0) return { ok: false, error: 'FEN is empty.' };

  const fields = trimmed.split(' ');
  if (fields.length === 4) fields.push('0', '1');
  if (fields.length !== 6) {
    return { ok: false, error: `A FEN has 6 space-separated fields (found ${fields.length}).` };
  }
  const fen = fields.join(' ');

  const result = validateFen(fen);
  if (!result.ok) return { ok: false, error: result.error ?? 'Invalid FEN.' };

  let chess: Chess;
  try {
    chess = new Chess(fen);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Invalid FEN.' };
  }

  // The side that just moved must not be left in check.
  const turn = chess.turn();
  const other: Color = turn === 'w' ? 'b' : 'w';
  const kings = chess.findPiece({ type: 'k', color: other });
  const king = kings[0];
  if (king !== undefined && chess.isAttacked(king, turn)) {
    return {
      ok: false,
      error: `The ${other === 'w' ? 'white' : 'black'} king is in check but it is ${turn === 'w' ? 'white' : 'black'}'s turn to move.`,
    };
  }
  return { ok: true, fen: chess.fen() };
}

export function sideToMove(fen: string): Color {
  return fen.split(' ')[1] === 'b' ? 'b' : 'w';
}

/** Full-move number from a FEN (1 if missing/invalid). */
export function fullMoveNumber(fen: string): number {
  const n = Number.parseInt(fen.split(' ')[5] ?? '1', 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/** Piece placement + side + castling + en passant: the part that defines "same position". */
export function positionKey(fen: string): string {
  return fen.split(' ').slice(0, 4).join(' ');
}
