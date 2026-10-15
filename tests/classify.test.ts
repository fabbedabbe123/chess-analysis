import { describe, expect, it } from 'vitest';
import {
  classifyMove,
  DEFAULT_THRESHOLDS,
  isForcingMove,
  moveAccuracy,
  normalizeThresholds,
  type ClassifyInput,
  type PositionEval,
} from '@/analysis/classify';
import { cpToWinPercent } from '@/analysis/eval';
import type { Color, WhiteScore } from '@/types/engine';

const cp = (value: number): WhiteScore => ({ pov: 'white', kind: 'cp', value });
const mate = (value: number): WhiteScore => ({ pov: 'white', kind: 'mate', value });
const pos = (score: WhiteScore, bestMove: string | null = 'e2e4', complete = true): PositionEval => ({ score, bestMove, complete });

function classify(overrides: Partial<ClassifyInput> & Pick<ClassifyInput, 'before' | 'after'>) {
  return classifyMove({ mover: 'w', playedUci: 'a2a3', ply: 30, bestMoveIsForcing: false, ...overrides });
}

describe('move classes from the winning-chance loss (White moving)', () => {
  it('"best" when the played move is the engine first choice', () => {
    const r = classify({ playedUci: 'e2e4', before: pos(cp(30)), after: pos(cp(25)) });
    expect(r.moveClass).toBe('best');
    expect(r.isEngineBest).toBe(true);
    expect(r.tags).toEqual([]);
  });

  it.each([
    // [before cp, after cp, expected class]
    [30, 20, 'excellent'], //  loss ~0.4
    [100, 50, 'good'], //       59.1 -> 54.6 = 4.5
    [100, 0, 'inaccuracy'], //  59.1 -> 50.0 = 9.1
    [100, -100, 'mistake'], //  59.1 -> 40.9 = 18.2
    [100, -300, 'blunder'], //  59.1 -> 24.9 = 34.2
  ])('cp %i -> %i is %s', (before, after, expected) => {
    expect(classify({ before: pos(cp(before)), after: pos(cp(after)) }).moveClass).toBe(expected);
  });

  it('an improving move is never penalised (loss floors at 0)', () => {
    const r = classify({ before: pos(cp(0)), after: pos(cp(300)) });
    expect(r.winLoss).toBe(0);
    expect(r.moveClass).toBe('excellent');
    expect(r.accuracy).toBeGreaterThan(99.9);
  });

  it('losing a queen in an already won position is not flagged (winning chances barely move)', () => {
    const r = classify({ before: pos(cp(2500)), after: pos(cp(1200)) });
    expect(r.moveClass).toBe('excellent');
  });
});

describe('perspective: the side that moved decides the sign', () => {
  const side = (mover: Color) => (white: number, afterWhite: number) =>
    classify({ mover, before: pos(cp(white)), after: pos(cp(afterWhite)) });

  it('Black moving: White-perspective +100 -> -100 is an IMPROVEMENT for Black', () => {
    const r = side('b')(100, -100);
    expect(r.winLoss).toBe(0);
    expect(r.winBefore).toBeCloseTo(40.9, 1);
    expect(r.winAfter).toBeCloseTo(59.1, 1);
  });

  it('Black moving: White-perspective -100 -> +100 is a mistake for Black', () => {
    const r = side('b')(-100, 100);
    expect(r.moveClass).toBe('mistake');
    expect(r.winLoss).toBeCloseTo(18.2, 1);
  });

  it('the same evaluation change is judged identically for both colours', () => {
    const asWhite = side('w')(100, -100).winLoss;
    const asBlack = side('b')(-100, 100).winLoss;
    expect(asWhite).toBeCloseTo(asBlack, 10);
  });
});

describe('mate handling', () => {
  it('flags a missed forced mate and still classifies by winning chances', () => {
    const r = classify({ before: pos(mate(3)), after: pos(cp(300)) });
    expect(r.tags).toContain('missed-mate');
    expect(r.winBefore).toBe(100);
    expect(r.moveClass).toBe('blunder'); // 100 -> 75.1
  });

  it('flags a missed mate even if the position stays totally winning', () => {
    // cp is clamped at +-1000 (97.5% winning chances), so the loss vs. a forced mate is ~2.5 points:
    // the CLASS stays mild while the TAG still reports the missed mate separately.
    const r = classify({ before: pos(mate(2)), after: pos(cp(1500)) });
    expect(r.tags).toContain('missed-mate');
    expect(r.winLoss).toBeCloseTo(2.46, 1);
    expect(r.moveClass).toBe('good');
  });

  it('a slower but still forced mate is not a missed mate', () => {
    const r = classify({ before: pos(mate(3)), after: pos(mate(5)) });
    expect(r.tags).not.toContain('missed-mate');
    expect(r.winLoss).toBe(0);
  });

  it('flags allowing a forced mate that was not there before', () => {
    const r = classify({ before: pos(cp(0)), after: pos(mate(-2)) });
    expect(r.tags).toContain('allowed-mate');
    expect(r.moveClass).toBe('blunder');
  });

  it('does not flag "allowed mate" when the mover was already getting mated', () => {
    const r = classify({ before: pos(mate(-3)), after: pos(mate(-2)) });
    expect(r.tags).not.toContain('allowed-mate');
    expect(r.winLoss).toBe(0);
  });

  it('works for Black: White mating after a Black move is "allowed-mate"', () => {
    const r = classify({ mover: 'b', before: pos(cp(0)), after: pos(mate(4)) });
    expect(r.tags).toContain('allowed-mate');
  });

  it('delivering checkmate is a perfect move', () => {
    const r = classify({
      before: pos(mate(1), 'h5f7'),
      after: pos({ pov: 'white', kind: 'mate', value: 0, winner: 'w' }, null),
      playedUci: 'h5f7',
    });
    expect(r.moveClass).toBe('best');
    expect(r.winAfter).toBe(100);
    expect(r.tags).toEqual([]);
  });
});

describe('other tags', () => {
  it('flags a missed win when a clearly winning position slips to roughly equal', () => {
    const r = classify({ before: pos(cp(500)), after: pos(cp(100)) });
    expect(r.winBefore).toBeGreaterThan(80);
    expect(r.winAfter).toBeLessThan(60);
    expect(r.tags).toContain('missed-win');
  });

  it('does not flag a missed win when the advantage mostly remains', () => {
    expect(classify({ before: pos(cp(500)), after: pos(cp(350)) }).tags).not.toContain('missed-win');
  });

  it('tags opening mistakes only in the first 10 moves and only for mistakes/blunders', () => {
    const early = classify({ ply: 14, before: pos(cp(30)), after: pos(cp(-250)) });
    expect(early.moveClass).toBe('blunder');
    expect(early.tags).toContain('opening');
    expect(classify({ ply: 30, before: pos(cp(30)), after: pos(cp(-250)) }).tags).not.toContain('opening');
    expect(classify({ ply: 14, before: pos(cp(30)), after: pos(cp(10)) }).tags).not.toContain('opening');
  });

  it('tags tactical errors only when the engine move was forcing and the played move was a mistake', () => {
    const serious = { before: pos(cp(300)), after: pos(cp(-100)) };
    expect(classify({ ...serious, bestMoveIsForcing: true }).tags).toContain('tactical');
    expect(classify({ ...serious, bestMoveIsForcing: false }).tags).not.toContain('tactical');
    expect(classify({ before: pos(cp(30)), after: pos(cp(20)), bestMoveIsForcing: true }).tags).not.toContain('tactical');
  });
});

describe('incomplete engine output is never classified', () => {
  it('returns null class and NaN accuracy when either evaluation is incomplete', () => {
    for (const [before, after] of [
      [pos(cp(30), 'e2e4', false), pos(cp(20))],
      [pos(cp(30)), pos(cp(20), null, false)],
    ] as const) {
      const r = classify({ before, after });
      expect(r.moveClass).toBeNull();
      expect(r.unclassifiedReason).toBe('incomplete-engine-output');
      expect(Number.isNaN(r.accuracy)).toBe(true);
      expect(r.tags).toEqual([]);
    }
  });
});

describe('thresholds are configurable', () => {
  const input = { before: pos(cp(100)), after: pos(cp(0)) }; // loss 9.1

  it('uses the default thresholds', () => {
    expect(classify(input).moveClass).toBe('inaccuracy');
  });

  it('stricter thresholds turn the same move into a blunder', () => {
    const strict = { excellent: 1, good: 2, inaccuracy: 3, mistake: 5 };
    expect(classify({ ...input, thresholds: strict }).moveClass).toBe('blunder');
  });

  it('looser thresholds make it merely good', () => {
    const loose = { excellent: 5, good: 12, inaccuracy: 20, mistake: 40 };
    expect(classify({ ...input, thresholds: loose }).moveClass).toBe('good');
  });

  it('normalises out-of-order, negative and NaN thresholds', () => {
    const fixed = normalizeThresholds({ excellent: 8, good: 3, inaccuracy: -1, mistake: Number.NaN });
    expect(fixed.excellent).toBe(8);
    expect(fixed.good).toBeGreaterThanOrEqual(fixed.excellent);
    expect(fixed.inaccuracy).toBeGreaterThanOrEqual(fixed.good);
    expect(fixed.mistake).toBeGreaterThanOrEqual(fixed.inaccuracy);
    expect(normalizeThresholds(DEFAULT_THRESHOLDS)).toEqual(DEFAULT_THRESHOLDS);
  });
});

describe('accuracy per move', () => {
  it('is ~100 for no loss, decreases monotonically, and is bounded to 0..100', () => {
    expect(moveAccuracy(0)).toBeGreaterThan(99.99);
    let previous = 101;
    for (const loss of [0, 1, 2, 5, 10, 20, 40, 80, 100]) {
      const a = moveAccuracy(loss);
      expect(a).toBeLessThan(previous);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThanOrEqual(100);
      previous = a;
    }
    expect(moveAccuracy(100)).toBe(0);
    expect(moveAccuracy(-5)).toBe(moveAccuracy(0));
  });

  it('matches the documented formula', () => {
    expect(moveAccuracy(10)).toBeCloseTo(103.1668 * Math.exp(-0.4354) - 3.1669, 6);
    expect(cpToWinPercent(0)).toBe(50);
  });
});

describe('isForcingMove', () => {
  const start = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  it('recognises captures, checks and mating scores', () => {
    expect(isForcingMove(start, 'e2e4', false)).toBe(false);
    expect(isForcingMove(start, 'e2e4', true)).toBe(true);
    // 1.e4 d5 2.exd5 is a capture
    expect(isForcingMove('rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2', 'e4d5', false)).toBe(true);
    // Qh5+ is a check
    expect(isForcingMove('rnbqkbnr/ppppp1pp/8/5p2/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2', 'd1h5', false)).toBe(true);
  });

  it('is false for illegal or malformed moves instead of throwing', () => {
    expect(isForcingMove(start, 'e2e5', false)).toBe(false);
    expect(isForcingMove('garbage', 'e2e4', false)).toBe(false);
  });
});
