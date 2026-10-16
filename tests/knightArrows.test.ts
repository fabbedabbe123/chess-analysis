import { describe, expect, it } from 'vitest';
import { knightPath } from '@/utils/knightArrows';

describe('knightPath', () => {
  it('bends a knight move into an L: two squares along the long side first', () => {
    // g1 -> f3 (white's view): from (2.5,3.5) to (1.5,1.5); end pulled back along the line like Chessground does
    const d = knightPath(2.5, 3.5, 1.6, 1.8);
    expect(d?.startsWith('M 2.5 3.5 L 2.5 1.5 L ')).toBe(true);
  });
  it('goes horizontally first for a 2-across, 1-up move', () => {
    const d = knightPath(-3.5, 3.5, -1.6, 2.7);
    expect(d?.startsWith('M -3.5 3.5 L -1.5 3.5 L ')).toBe(true);
  });
  it('ends the head short of the target centre along the last segment', () => {
    const d = knightPath(0.5, 0.5, 1.4, 2.4) as string; // ends 0.1 before... pull ~ distance to (1.5,2.5)
    const [, , , , ex, ey] = d.replace(/[ML]/g, '').trim().split(/\s+/).map(Number) as number[];
    expect(ey).toBeCloseTo(2.5, 5); // last segment is horizontal along y = 2.5
    expect(ex).toBeCloseTo(1.5 - Math.hypot(0.1, 0.1), 3); // pulled back by the same distance Chessground used
  });
  it('leaves other arrows straight', () => {
    expect(knightPath(0.5, 0.5, 0.5, 2.5)).toBeNull(); // rook
    expect(knightPath(0.5, 0.5, 2.3, 2.3)).toBeNull(); // bishop
    expect(knightPath(0.5, 0.5, 1.5, 3.5)).toBeNull(); // 1 x 3
    expect(knightPath(0.5, 0.5, 0.5, 0.5)).toBeNull();
  });
});
