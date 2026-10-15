import type { Color } from '@/types/engine';

/**
 * Game clocks for Play mode. All functions are pure so they can be tested without timers.
 * Clock rules used (Lichess-style): nothing runs until both sides have moved once; after that the side to move loses
 * real time, and the increment is added after each completed move. A flag fall loses, unless the opponent has no way to
 * checkmate at all (then it is a draw, see `canMate`).
 */

export type TimeControlId = 'none' | '3+2' | '5+0' | '10+0' | '15+10';

export interface TimeControl {
  id: TimeControlId;
  label: string;
  baseMs: number;
  incMs: number;
}

export const TIME_CONTROLS: Record<TimeControlId, TimeControl> = {
  none: { id: 'none', label: 'No clock', baseMs: 0, incMs: 0 },
  '3+2': { id: '3+2', label: '3 min + 2 s (blitz)', baseMs: 180_000, incMs: 2_000 },
  '5+0': { id: '5+0', label: '5 min (blitz)', baseMs: 300_000, incMs: 0 },
  '10+0': { id: '10+0', label: '10 min (rapid)', baseMs: 600_000, incMs: 0 },
  '15+10': { id: '15+10', label: '15 min + 10 s (rapid)', baseMs: 900_000, incMs: 10_000 },
};
export const TIME_CONTROL_IDS = Object.keys(TIME_CONTROLS) as TimeControlId[];

export function parseTimeControl(v: unknown): TimeControlId {
  return TIME_CONTROL_IDS.includes(v as TimeControlId) ? (v as TimeControlId) : 'none';
}

/** PGN TimeControl tag value ("180+2"). */
export function pgnTimeControl(tc: TimeControl): string {
  return tc.id === 'none' ? '-' : `${tc.baseMs / 1000}${tc.incMs > 0 ? `+${tc.incMs / 1000}` : ''}`;
}

export interface ClockState {
  w: number;
  b: number;
  /** Side whose clock is running; null until both sides have moved once. */
  turn: Color | null;
  /** Timestamp (ms) from which `turn`'s time is counted. */
  since: number;
}

export function newClock(tc: TimeControl): ClockState {
  return { w: tc.baseMs, b: tc.baseMs, turn: null, since: 0 };
}

/** Remaining time of both sides at `now` (the running side's live time is deducted; never below 0). */
export function remainingAt(c: ClockState, now: number): { w: number; b: number } {
  const live = (side: Color): number => {
    const t = c[side] - (c.turn === side ? Math.max(0, now - c.since) : 0);
    return Math.max(0, t);
  };
  return { w: live('w'), b: live('b') };
}

/**
 * The position changed because `mover` completed a move. `pliesPlayed` = half-moves since the start of the game
 * (including this one); `sideToMove` is who moves next. Returns the updated clock.
 */
export function afterMove(c: ClockState, tc: TimeControl, mover: Color, sideToMove: Color, pliesPlayed: number, now: number): ClockState {
  const next: ClockState = { ...c };
  if (c.turn !== null) {
    // The mover's clock was running: charge the thinking time, then add the increment.
    const spent = Math.max(0, now - c.since);
    next[mover] = Math.max(0, c[mover] - spent) + tc.incMs;
    next.turn = sideToMove;
    next.since = now;
  } else if (pliesPlayed >= 2) {
    next.turn = sideToMove;
    next.since = now;
  }
  return next;
}

/** Search time for the engine: its normal move time, but never more than a fraction of the time it has left. */
export function engineMovetime(normalMs: number, remainingMs: number, incMs: number): number {
  const budget = Math.floor(remainingMs / 30 + incMs * 0.6);
  return Math.max(30, Math.min(normalMs, budget));
}

/** Format milliseconds as m:ss (or s.t below 10 seconds). */
export function formatClock(ms: number): string {
  const t = Math.max(0, ms);
  if (t < 10_000) return `${Math.floor(t / 1000)}.${Math.floor((t % 1000) / 100)}`;
  const s = Math.ceil(t / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Can `side` still checkmate by any series of legal moves? Simplified FIDE rule: pawns, rooks, queens or two minor pieces
 * can; a single minor piece can only if the opponent has something other than a king (a helpmate is then possible); a bare
 * king cannot. (Rare cases such as same-coloured bishops against a bare king are treated as "can mate".)
 */
export function canMate(fen: string, side: Color): boolean {
  const board = fen.split(' ')[0] ?? '';
  const mine: Record<string, number> = {};
  let theirs = 0;
  for (const ch of board) {
    if (!/[a-zA-Z]/.test(ch)) continue;
    const isWhite = ch === ch.toUpperCase();
    const lower = ch.toLowerCase();
    if (lower === 'k') continue;
    if ((side === 'w') === isWhite) mine[lower] = (mine[lower] ?? 0) + 1;
    else theirs += 1;
  }
  if ((mine['p'] ?? 0) + (mine['r'] ?? 0) + (mine['q'] ?? 0) > 0) return true;
  const minors = (mine['n'] ?? 0) + (mine['b'] ?? 0);
  if (minors >= 2) return true;
  return minors === 1 && theirs > 0;
}
