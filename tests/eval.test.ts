import { describe, expect, it } from 'vitest';
import {
  checkmateScore,
  cpToWinPercent,
  describeScore,
  evalBarWhiteShare,
  formatScore,
  mateDistance,
  mateWinner,
  scoreSortKey,
  sideWinPercent,
  toWhiteScore,
  whiteWinPercent,
} from '@/analysis/eval';
import type { StmScore, WhiteScore } from '@/types/engine';

const stm = (kind: 'cp' | 'mate', value: number): StmScore => ({ pov: 'stm', kind, value });
const cp = (value: number): WhiteScore => ({ pov: 'white', kind: 'cp', value });
const mate = (value: number): WhiteScore => ({ pov: 'white', kind: 'mate', value });

describe('evaluation perspective conversion', () => {
  it('keeps the sign when White is to move', () => {
    expect(toWhiteScore(stm('cp', 50), 'w')).toEqual(cp(50));
    expect(toWhiteScore(stm('cp', -120), 'w')).toEqual(cp(-120));
  });

  it('flips the sign when Black is to move (engine +50 for Black = -50 for White)', () => {
    expect(toWhiteScore(stm('cp', 50), 'b')).toEqual(cp(-50));
    expect(toWhiteScore(stm('cp', -120), 'b')).toEqual(cp(120));
  });

  it('converts mate scores the same way', () => {
    expect(toWhiteScore(stm('mate', 3), 'w')).toEqual(mate(3));
    expect(toWhiteScore(stm('mate', 3), 'b')).toEqual(mate(-3)); // Black mates in 3
    expect(toWhiteScore(stm('mate', -2), 'w')).toEqual(mate(-2)); // White gets mated
    expect(toWhiteScore(stm('mate', -2), 'b')).toEqual(mate(2));
  });

  it('never produces negative zero', () => {
    const zero = toWhiteScore(stm('cp', 0), 'b');
    expect(Object.is(zero.value, 0)).toBe(true);
  });

  it('keeps the winner of a checkmate on the board (mate 0 has no sign)', () => {
    // White to move and checkmated -> Black delivered mate
    expect(toWhiteScore(stm('mate', 0), 'w')).toEqual({ pov: 'white', kind: 'mate', value: 0, winner: 'b' });
    expect(toWhiteScore(stm('mate', 0), 'b')).toEqual({ pov: 'white', kind: 'mate', value: 0, winner: 'w' });
    expect(checkmateScore('w').winner).toBe('b');
  });

  it('round-trips a full engine line: same position gives the same White-perspective score from both viewpoints', () => {
    // A position where Black is to move and Black is up a pawn: engine says +100 for the side to move.
    const white = toWhiteScore(stm('cp', 100), 'b');
    expect(white.value).toBe(-100);
    expect(sideWinPercent(white, 'b')).toBeGreaterThan(50);
    expect(sideWinPercent(white, 'w')).toBeLessThan(50);
  });
});

describe('formatting', () => {
  it('formats centipawns as pawns with a sign', () => {
    expect(formatScore(cp(65))).toBe('+0.65');
    expect(formatScore(cp(-120))).toBe('-1.20');
    expect(formatScore(cp(0))).toBe('0.00');
    expect(formatScore(cp(1234))).toBe('+12.34');
    expect(formatScore(cp(5))).toBe('+0.05');
  });

  it('supports centipawn and win-percentage display modes', () => {
    expect(formatScore(cp(65), 'centipawns')).toBe('+65');
    expect(formatScore(cp(-120), 'centipawns')).toBe('-120');
    expect(formatScore(cp(0), 'winpercent')).toBe('50%');
    expect(formatScore(cp(100), 'winpercent')).toBe('59%');
  });

  it('formats mate scores as M<n> / -M<n> in every display mode', () => {
    for (const mode of ['pawns', 'centipawns', 'winpercent'] as const) {
      expect(formatScore(mate(3), mode)).toBe('M3');
      expect(formatScore(mate(-4), mode)).toBe('-M4');
    }
  });

  it('formats an actual checkmate as a result', () => {
    expect(formatScore({ pov: 'white', kind: 'mate', value: 0, winner: 'w' })).toBe('1-0');
    expect(formatScore({ pov: 'white', kind: 'mate', value: 0, winner: 'b' })).toBe('0-1');
  });

  it('handles "no evaluation yet"', () => {
    expect(formatScore(null)).toBe('–');
    expect(describeScore(null)).toBe('No evaluation yet');
  });

  it('describes scores for assistive technology', () => {
    expect(describeScore(cp(65))).toBe('White is better by 0.65 pawns');
    expect(describeScore(cp(-300))).toBe('Black is better by 3.00 pawns');
    expect(describeScore(cp(0))).toBe('Equal position');
    expect(describeScore(mate(2))).toBe('White mates in 2');
    expect(describeScore(mate(-5))).toBe('Black mates in 5');
  });
});

describe('mate helpers', () => {
  it('reports winner and distance', () => {
    expect(mateWinner(mate(3))).toBe('w');
    expect(mateWinner(mate(-3))).toBe('b');
    expect(mateWinner(cp(900))).toBeNull();
    expect(mateDistance(mate(-7))).toBe(7);
    expect(mateDistance(cp(10))).toBeNull();
  });

  it('orders scores: faster mate > slower mate > material > equal > ... > being mated', () => {
    const ordered = [mate(2), mate(5), cp(900), cp(0), cp(-900), mate(-5), mate(-2)];
    const keys = ordered.map(scoreSortKey);
    expect([...keys].sort((a, b) => b - a)).toEqual(keys);
  });
});

describe('winning chances and the evaluation bar', () => {
  it('is 50% at equality and symmetric', () => {
    expect(cpToWinPercent(0)).toBe(50);
    for (const v of [25, 100, 300, 700]) {
      expect(cpToWinPercent(v) + cpToWinPercent(-v)).toBeCloseTo(100, 10);
    }
  });

  it('is strictly increasing and saturates beyond the clamp', () => {
    expect(cpToWinPercent(100)).toBeGreaterThan(cpToWinPercent(50));
    expect(cpToWinPercent(500)).toBeGreaterThan(cpToWinPercent(100));
    expect(cpToWinPercent(5000)).toBe(cpToWinPercent(1000));
    expect(cpToWinPercent(100)).toBeCloseTo(59.1, 1);
  });

  it('maps mates to 0 or 100', () => {
    expect(whiteWinPercent(mate(4))).toBe(100);
    expect(whiteWinPercent(mate(-4))).toBe(0);
    expect(whiteWinPercent({ pov: 'white', kind: 'mate', value: 0, winner: 'b' })).toBe(0);
  });

  it('gives the side-relative view', () => {
    expect(sideWinPercent(cp(100), 'w')).toBeCloseTo(59.1, 1);
    expect(sideWinPercent(cp(100), 'b')).toBeCloseTo(40.9, 1);
    expect(sideWinPercent(mate(-1), 'b')).toBe(100);
  });

  it('fills the bar with White share between 0 and 1, balanced when unknown', () => {
    expect(evalBarWhiteShare(null)).toBe(0.5);
    expect(evalBarWhiteShare(cp(0))).toBe(0.5);
    expect(evalBarWhiteShare(mate(2))).toBe(1);
    expect(evalBarWhiteShare(mate(-2))).toBe(0);
    const share = evalBarWhiteShare(cp(-150));
    expect(share).toBeGreaterThan(0);
    expect(share).toBeLessThan(0.5);
  });
});
