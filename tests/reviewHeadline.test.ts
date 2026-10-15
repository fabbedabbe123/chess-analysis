import { describe, expect, it } from 'vitest';
import { headline } from '@/components/ReviewPanel';
import type { ReviewResult } from '@/analysis/review';

const zero = { brilliant: 0, great: 0, best: 0, excellent: 0, good: 0, book: 0, inaccuracy: 0, mistake: 0, miss: 0, blunder: 0 };

describe('review headline', () => {
  it('names the errors of each side in plain words', () => {
    const summary = { grades: { w: { ...zero, mistake: 1, inaccuracy: 2 }, b: { ...zero } } } as unknown as ReviewResult['summary'];
    const t = headline(summary, 'Fabian', 'Opp');
    expect(t).toContain('Fabian: 1 mistake, 2 inaccuracies');
    expect(t).toContain('Opp: no errors');
  });
});
