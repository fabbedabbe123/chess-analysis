import type { Color, StmScore, WhiteScore } from '@/types/engine';

/** How scores are shown in the UI. */
export type EvalDisplayMode = 'pawns' | 'centipawns' | 'winpercent';

/**
 * The single place where an engine score (side-to-move perspective) becomes a
 * White-perspective score. `sideToMove` MUST be the side to move in the FEN
 * that was searched - not the side that just moved, not the current board
 * orientation.
 */
export function toWhiteScore(score: StmScore, sideToMove: Color): WhiteScore {
  if (score.kind === 'mate' && score.value === 0) {
    // `mate 0`: the side to move is checkmated, so the OTHER side delivered it.
    return { pov: 'white', kind: 'mate', value: 0, winner: sideToMove === 'w' ? 'b' : 'w' };
  }
  const value = sideToMove === 'w' ? score.value : -score.value;
  return { pov: 'white', kind: score.kind, value: value === 0 ? 0 : value };
}

/** Terminal-position scores that never need an engine search. */
export function checkmateScore(sideToMove: Color): WhiteScore {
  return toWhiteScore({ pov: 'stm', kind: 'mate', value: 0 }, sideToMove);
}

export function drawScore(): WhiteScore {
  return { pov: 'white', kind: 'cp', value: 0 };
}

/** Which colour is winning by force (`null` for centipawn scores). */
export function mateWinner(score: WhiteScore): Color | null {
  if (score.kind !== 'mate') return null;
  if (score.value === 0) return score.winner ?? null;
  return score.value > 0 ? 'w' : 'b';
}

/** Number of full moves until mate (0 for an actual checkmate); `null` for cp scores. */
export function mateDistance(score: WhiteScore): number | null {
  return score.kind === 'mate' ? Math.abs(score.value) : null;
}

const CP_CLAMP = 1000;

/**
 * Logistic win-probability model: White's winning chances in percent (0..100)
 * from a centipawn score. Constant 0.00368208 is the fit published by Lichess
 * (open source); it is a statistical model, not an engine output.
 */
export function cpToWinPercent(cp: number): number {
  const clamped = Math.max(-CP_CLAMP, Math.min(CP_CLAMP, cp));
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * clamped)) - 1);
}

/** White's winning chances (0..100). Forced mates map to 0 or 100. */
export function whiteWinPercent(score: WhiteScore): number {
  if (score.kind === 'cp') return cpToWinPercent(score.value);
  const winner = mateWinner(score);
  if (winner === 'w') return 100;
  if (winner === 'b') return 0;
  return 50;
}

/** Winning chances (0..100) from the point of view of `side`. */
export function sideWinPercent(score: WhiteScore, side: Color): number {
  const white = whiteWinPercent(score);
  return side === 'w' ? white : 100 - white;
}

/** Fraction of the evaluation bar filled with White (0..1). `null` = no data yet -> balanced. */
export function evalBarWhiteShare(score: WhiteScore | null): number {
  if (score === null) return 0.5;
  return whiteWinPercent(score) / 100;
}

/** Monotonic number for ordering scores (higher = better for White). Mates dominate cp. */
export function scoreSortKey(score: WhiteScore): number {
  if (score.kind === 'cp') return score.value;
  const winner = mateWinner(score);
  const dist = Math.abs(score.value);
  if (winner === 'w') return 1_000_000 - dist;
  if (winner === 'b') return -1_000_000 + dist;
  return 0;
}

function signed(text: string, positive: boolean, zero: boolean): string {
  if (zero) return text;
  return `${positive ? '+' : '-'}${text}`;
}

/**
 * Format a White-perspective score.
 *  - pawns:       +0.65 / -1.20
 *  - centipawns:  +65 / -120
 *  - winpercent:  White's winning chances, e.g. 58%
 * Mates are always `M3` (White mates in 3) / `-M3` (Black mates in 3), and
 * `1-0` / `0-1` for an actual checkmate on the board.
 */
export function formatScore(score: WhiteScore | null, mode: EvalDisplayMode = 'pawns'): string {
  if (score === null) return '–';
  if (score.kind === 'mate') {
    if (score.value === 0) return score.winner === 'b' ? '0-1' : '1-0';
    return score.value > 0 ? `M${score.value}` : `-M${Math.abs(score.value)}`;
  }
  if (mode === 'winpercent') return `${Math.round(whiteWinPercent(score))}%`;
  if (mode === 'centipawns') return signed(String(Math.abs(score.value)), score.value > 0, score.value === 0);
  return signed((Math.abs(score.value) / 100).toFixed(2), score.value > 0, score.value === 0);
}

/** Accessible description, e.g. "White is better by 0.65 pawns" / "Black mates in 3". */
export function describeScore(score: WhiteScore | null): string {
  if (score === null) return 'No evaluation yet';
  if (score.kind === 'mate') {
    if (score.value === 0) return `${score.winner === 'b' ? 'Black' : 'White'} has checkmated`;
    const who = score.value > 0 ? 'White' : 'Black';
    return `${who} mates in ${Math.abs(score.value)}`;
  }
  if (score.value === 0) return 'Equal position';
  const who = score.value > 0 ? 'White' : 'Black';
  return `${who} is better by ${(Math.abs(score.value) / 100).toFixed(2)} pawns`;
}
