import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { classifyMove, GRADE_ORDER, GRADE_RULES, type ClassifyInput, type PositionEval } from '@/analysis/classify';
import { GRADE_HELP, GRADE_LABEL, GRADE_SYMBOL } from '@/analysis/gradeInfo';
import { netSacrifice, summarizeReview, type ReviewMove } from '@/analysis/review';
import type { WhiteScore } from '@/types/engine';

const cp = (value: number): WhiteScore => ({ pov: 'white', kind: 'cp', value });
const pos = (score: WhiteScore, bestMove: string | null = 'e2e4'): PositionEval => ({ score, bestMove, complete: true });
const grade = (o: Partial<ClassifyInput> & Pick<ClassifyInput, 'before' | 'after'>) =>
  classifyMove({ mover: 'w', playedUci: 'e2e4', ply: 30, bestMoveIsForcing: false, ...o });

describe('grades (Chess.com-style labels, our own documented rules)', () => {
  it('without grade inputs the grade is simply the base class; unclassified moves have none', () => {
    expect(grade({ before: pos(cp(30)), after: pos(cp(25)) }).grade).toBe('best');
    expect(grade({ playedUci: 'a2a3', before: pos(cp(100)), after: pos(cp(-300)) }).grade).toBe('blunder');
    expect(classifyMove({ mover: 'w', playedUci: 'a2a3', ply: 1, bestMoveIsForcing: false, before: { ...pos(cp(0)), complete: false }, after: pos(cp(0)) }).grade).toBeNull();
  });

  it('every grade has a label, a help text and a (possibly empty) symbol', () => {
    for (const g of GRADE_ORDER) {
      expect(GRADE_LABEL[g].length).toBeGreaterThan(2);
      expect(GRADE_HELP[g].length).toBeGreaterThan(10);
      expect(typeof GRADE_SYMBOL[g]).toBe('string');
    }
  });

  describe('book', () => {
    it('wins over everything, even a move the engine dislikes', () => {
      expect(grade({ playedUci: 'a2a3', before: pos(cp(100)), after: pos(cp(-300)), inBook: true }).grade).toBe('book');
    });
  });

  describe('brilliant', () => {
    const base = { before: pos(cp(30)), after: pos(cp(20)), sacrifice: 3 };
    it('a best move that gives up material while staying in the game', () => {
      expect(grade(base).grade).toBe('brilliant');
    });
    it('needs a real sacrifice', () => {
      expect(grade({ ...base, sacrifice: GRADE_RULES.brilliantMinSacrifice - 1 }).grade).toBe('best');
    });
    it('not when the position was already clearly winning', () => {
      expect(grade({ ...base, before: pos(cp(600)), after: pos(cp(590)) }).grade).toBe('best');
    });
    it('not when the sacrifice leaves the mover clearly worse', () => {
      expect(grade({ ...base, playedUci: 'e2e4', before: pos(cp(-100)), after: pos(cp(-250)) }).grade).not.toBe('brilliant');
    });
    it('not when the move is not near the engine best', () => {
      expect(grade({ ...base, playedUci: 'a2a3', before: pos(cp(100)), after: pos(cp(-100)) }).grade).toBe('mistake');
    });
    it('works for Black (scores are flipped to the mover once)', () => {
      expect(grade({ mover: 'b', before: pos(cp(-30)), after: pos(cp(-20)), sacrifice: 3 }).grade).toBe('brilliant');
      expect(grade({ mover: 'b', before: pos(cp(600)), after: pos(cp(590)), sacrifice: 3 }).grade).toBe('best');
    });
    it('a sacrifice that is the ONLY way to keep a won position / forced mate is brilliant', () => {
      const mate = (n: number): WhiteScore => ({ pov: 'white', kind: 'mate', value: n });
      const won = { before: pos(mate(4)), after: pos(mate(3)), sacrifice: 5, legalMoves: 30 };
      expect(grade({ ...won, onlyMoveGap: 40 }).grade).toBe('brilliant');
      // other moves win just as well -> an ordinary best move
      expect(grade({ ...won, onlyMoveGap: 3 }).grade).toBe('best');
      expect(grade({ ...won, onlyMoveGap: null }).grade).toBe('best');
    });
    it('wins over great', () => {
      expect(grade({ ...base, onlyMoveGap: 40, legalMoves: 30 }).grade).toBe('brilliant');
    });
  });

  describe('great (only move)', () => {
    const base = { before: pos(cp(30)), after: pos(cp(25)), onlyMoveGap: 25, legalMoves: 30 };
    it('best move with a clearly worse second-best', () => {
      expect(grade(base).grade).toBe('great');
    });
    it('not when the alternatives are close', () => {
      expect(grade({ ...base, onlyMoveGap: GRADE_RULES.greatMinGap - 1 }).grade).toBe('best');
    });
    it('not for forced replies with one or two legal moves', () => {
      expect(grade({ ...base, legalMoves: 2 }).grade).toBe('best');
    });
    it('never when the move allows a forced mate', () => {
      expect(grade({ ...base, before: pos(cp(250)), after: pos({ pov: 'white', kind: 'mate', value: 2 }), mover: 'b', onlyMoveGap: 30 }).grade).not.toBe('great');
    });
    it('not when already winning big or when the played move is not the best', () => {
      expect(grade({ ...base, before: pos(cp(700)), after: pos(cp(690)) }).grade).toBe('best');
      expect(grade({ ...base, playedUci: 'a2a3' }).grade).toBe('excellent');
    });
  });

  describe('miss', () => {
    it('an inaccuracy/mistake right after the opponent erred', () => {
      const r = grade({ playedUci: 'a2a3', before: pos(cp(100)), after: pos(cp(-100)), opponentLoss: 15 });
      expect(r.moveClass).toBe('mistake');
      expect(r.grade).toBe('miss');
    });
    it('also when a forced mate or clear win was not kept but the game is not lost', () => {
      const missedMate = grade({ playedUci: 'a2a3', before: pos({ pov: 'white', kind: 'mate', value: 2 }), after: pos(cp(30)) });
      expect(missedMate.tags).toContain('missed-mate');
      expect(missedMate.grade).toBe('miss');
      const missedWin = grade({ playedUci: 'a2a3', before: pos(cp(450)), after: pos(cp(80)) });
      expect(missedWin.tags).toContain('missed-win');
      expect(missedWin.grade).toBe('miss');
    });
    it('a collapse is still a blunder: the missed win turned into a lost game', () => {
      expect(grade({ playedUci: 'a2a3', before: pos(cp(450)), after: pos(cp(-300)) }).grade).toBe('blunder');
    });
    it('a blunder stays a blunder, and an ordinary mistake stays a mistake', () => {
      expect(grade({ playedUci: 'a2a3', before: pos(cp(100)), after: pos(cp(-400)), opponentLoss: 20 }).grade).toBe('blunder');
      expect(grade({ playedUci: 'a2a3', before: pos(cp(100)), after: pos(cp(-100)), opponentLoss: 3 }).grade).toBe('mistake');
    });
  });
});

describe('netSacrifice (material given up once the engine line has settled)', () => {
  const fenAfter = (sans: string) => {
    const c = new Chess();
    for (const m of sans.split(' ')) c.move(m);
    return c.fen();
  };
  it("Legal's trap: Nxe5 leaves the queen en prise, and mates two moves later (7 points down after the exchanges)", () => {
    const fen = fenAfter('e4 e5 Nf3 d6 Bc4 Bg4 Nc3 g6');
    expect(netSacrifice(fen, 'f3e5', ['g4d1', 'c4f7', 'e8e7', 'c3d5'], 'w')).toBeGreaterThanOrEqual(5);
  });
  it('an even exchange is not a sacrifice', () => {
    const fen = fenAfter('e4 d5');
    expect(netSacrifice(fen, 'e4d5', ['d8d5', 'b1c3', 'd5a5', 'g1f3'], 'w')).toBe(0);
  });
  it('a sacrifice that is won back within the line is not counted', () => {
    const fen = fenAfter('e4 e5 Nf3 Nc6 Bc4 Nf6');
    // 4.Ng5 d5 5.exd5 Nxd5 6.Nxf7 Kxf7: not a sacrifice by itself here, but illegal/short pv must never throw
    expect(netSacrifice(fen, 'f3g5', [], 'w')).toBe(0);
    expect(netSacrifice(fen, 'zzzz', ['a7a6'], 'w')).toBe(0);
  });
});

describe('summary counts grades once per move', () => {
  function mv(ply: number, g: Partial<ClassifyInput>, color: 'w' | 'b' = 'w'): ReviewMove {
    const classification = classifyMove({ mover: color, playedUci: 'e2e4', ply, bestMoveIsForcing: false, before: pos(cp(30)), after: pos(cp(25)), ...g });
    const rec = (score: WhiteScore) => ({ fen: 'x', score, bestMove: null, bestPv: [], depth: 1, complete: true, terminal: null });
    return { nodeId: `n${ply}`, ply, san: 'm', uci: 'e2e4', color, moveNumber: 1, fenBefore: 'x', before: rec(cp(30)), after: rec(cp(25)), classification, swing: 0 };
  }
  it('adds up to the number of classified moves and keeps the base counts', () => {
    const moves = [mv(1, { inBook: true }), mv(2, { inBook: true }, 'b'), mv(3, { sacrifice: 3 }), mv(4, { playedUci: 'a2a3' }, 'b'), mv(5, { onlyMoveGap: 30, legalMoves: 25 })];
    const s = summarizeReview(moves);
    expect(s.grades.w.book).toBe(1);
    expect(s.grades.w.brilliant).toBe(1);
    expect(s.grades.w.great).toBe(1);
    expect(s.grades.b.book).toBe(1);
    const total = (['w', 'b'] as const).reduce((n, c) => n + GRADE_ORDER.reduce((m, g) => m + s.grades[c][g], 0), 0);
    expect(total).toBe(s.movesAnalyzed);
    expect(s.counts.w.best).toBe(3); // base classes are unchanged
  });
});

describe('netSacrifice on a real game (Play vs Stockfish)', () => {
  it('25. Ne4 gives up material that is not back within two moves (a sacrifice)', () => {
    expect(netSacrifice("r3b1k1/1p1r1pp1/p3p2p/2bPB3/P1P2P2/2NB4/5RPP/R5K1 w - - 3 25", 'c3e4', ["c5f2", "g1f2", "e6d5", "e4c5", "d5c4", "c5d7"], 'w')).toBeGreaterThanOrEqual(3);
  });
  it('29. Bxf6 only looks like a hanging bishop: the engine line wins material back', () => {
    expect(netSacrifice("r3b1k1/1p1r2p1/p2Ppp1p/4B3/P1P1NP2/3B4/5KPP/R7 w - - 0 29", 'e5f6', ["g7f6", "e4f6", "g8f7", "f6d7", "e8d7", "a1b1"], 'w')).toBe(0);
  });
});
