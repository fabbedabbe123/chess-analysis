import { Chess } from 'chess.js';

export interface PvMove {
  uci: string;
  san: string;
  /** Position after this move. */
  fenAfter: string;
  /** "12." for White moves, "12..." for Black moves (shown on the first move of a line when Black). */
  moveNumber: number;
  color: 'w' | 'b';
  isCapture: boolean;
  isCheck: boolean;
  isMate: boolean;
}

export interface PvConversion {
  moves: PvMove[];
  /** True if the PV contained a move that is illegal in the replayed position (line was cut there). */
  truncated: boolean;
}

export function splitUci(uci: string): { from: string; to: string; promotion?: string } | null {
  if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) return null;
  const result: { from: string; to: string; promotion?: string } = {
    from: uci.slice(0, 2),
    to: uci.slice(2, 4),
  };
  if (uci.length === 5) result.promotion = uci.slice(4, 5);
  return result;
}

/**
 * Replay a UCI principal variation from `fen` and return SAN moves. Stops at the
 * first illegal move (engine output may be truncated or, when the user changes
 * position, belong to a different board) instead of throwing.
 */
export function pvToSan(fen: string, pv: readonly string[], maxPlies = 40): PvConversion {
  const moves: PvMove[] = [];
  let chess: Chess;
  try {
    chess = new Chess(fen);
  } catch {
    return { moves, truncated: pv.length > 0 };
  }

  for (const uci of pv.slice(0, maxPlies)) {
    const parts = splitUci(uci);
    if (!parts) return { moves, truncated: true };
    const color = chess.turn();
    const moveNumber = chess.moveNumber();
    try {
      const move = chess.move(parts);
      moves.push({
        uci,
        san: move.san,
        fenAfter: chess.fen(),
        moveNumber,
        color,
        isCapture: move.isCapture() || move.isEnPassant(),
        isCheck: chess.inCheck(),
        isMate: chess.isCheckmate(),
      });
    } catch {
      return { moves, truncated: true };
    }
  }
  return { moves, truncated: false };
}

/** "12. Nf3 Nc6 13. Bb5" style text for a converted PV (starts with "12..." when Black is to move). */
export function formatPv(moves: readonly PvMove[], maxMoves = 12): string {
  const parts: string[] = [];
  moves.slice(0, maxMoves).forEach((m, index) => {
    if (m.color === 'w') parts.push(`${m.moveNumber}.`);
    else if (index === 0) parts.push(`${m.moveNumber}...`);
    parts.push(m.san);
  });
  return parts.join(' ');
}
