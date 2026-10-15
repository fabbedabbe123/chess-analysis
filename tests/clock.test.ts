import { describe, expect, it } from 'vitest';
import { afterMove, canMate, engineMovetime, formatClock, newClock, parseTimeControl, pgnTimeControl, remainingAt, TIME_CONTROLS } from '@/play/clock';

const tc = TIME_CONTROLS['3+2'];

describe('clock', () => {
  it('does not run until both sides have moved, then charges time and adds the increment', () => {
    let c = newClock(tc);
    c = afterMove(c, tc, 'w', 'b', 1, 1000);
    expect(c.turn).toBeNull();
    expect(remainingAt(c, 99_000)).toEqual({ w: 180_000, b: 180_000 });
    c = afterMove(c, tc, 'b', 'w', 2, 5000);
    expect(c.turn).toBe('w');
    expect(c.since).toBe(5000);
    expect(remainingAt(c, 15_000).w).toBe(170_000);
    c = afterMove(c, tc, 'w', 'b', 3, 15_000);
    expect(c.w).toBe(170_000 + 2000);
    expect(c.turn).toBe('b');
    expect(remainingAt(c, 20_000)).toEqual({ w: 172_000, b: 175_000 });
  });
  it('never goes below zero', () => {
    const c = { w: 1000, b: 1000, turn: 'w' as const, since: 0 };
    expect(remainingAt(c, 5000).w).toBe(0);
    expect(afterMove(c, tc, 'w', 'b', 5, 5000).w).toBe(2000);
  });
  it('limits engine thinking time by what it has left', () => {
    expect(engineMovetime(1000, 180_000, 2000)).toBe(1000);
    expect(engineMovetime(1000, 6000, 0)).toBe(200);
    expect(engineMovetime(1000, 100, 0)).toBe(30);
  });
  it('formats clocks', () => {
    expect(formatClock(180_000)).toBe('3:00');
    expect(formatClock(65_400)).toBe('1:06');
    expect(formatClock(9_870)).toBe('9.8');
    expect(formatClock(-5)).toBe('0.0');
  });
  it('parses ids and PGN tags', () => {
    expect(parseTimeControl('5+0')).toBe('5+0');
    expect(parseTimeControl('nonsense')).toBe('none');
    expect(pgnTimeControl(TIME_CONTROLS['3+2'])).toBe('180+2');
    expect(pgnTimeControl(TIME_CONTROLS['10+0'])).toBe('600');
    expect(pgnTimeControl(TIME_CONTROLS.none)).toBe('-');
  });
});

describe('canMate (flag fall result)', () => {
  it('a bare king or a lone minor against a bare king cannot mate', () => {
    expect(canMate('8/8/8/4k3/8/8/8/4K3 w - - 0 1', 'w')).toBe(false);
    expect(canMate('8/8/8/4k3/8/8/8/3BK3 w - - 0 1', 'w')).toBe(false);
    expect(canMate('8/8/8/4k3/8/8/8/3NK3 w - - 0 1', 'w')).toBe(false);
  });
  it('a pawn, rook, queen or two minors can', () => {
    expect(canMate('8/8/8/4k3/8/8/4P3/4K3 w - - 0 1', 'w')).toBe(true);
    expect(canMate('8/8/8/4k3/8/8/8/R3K3 w - - 0 1', 'w')).toBe(true);
    expect(canMate('8/8/8/4k3/8/8/8/2BNK3 w - - 0 1', 'w')).toBe(true);
  });
  it('a lone minor can if the opponent still has material', () => {
    expect(canMate('8/8/8/4k3/8/8/6p1/3BK3 w - - 0 1', 'w')).toBe(true);
    expect(canMate('8/8/8/4k3/8/8/6p1/3BK3 w - - 0 1', 'b')).toBe(true); // black pawn
  });
});
