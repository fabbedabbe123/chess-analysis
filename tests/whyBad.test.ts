import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { explainBadMove, materialAlong } from '@/analysis/whyBad';
import type { PositionRecord, ReviewMove } from '@/analysis/review';
import type { WhiteScore } from '@/types/engine';

const cp = (value: number): WhiteScore => ({ pov: 'white', kind: 'cp', value });
const rec = (fen: string, score: WhiteScore, bestMove: string | null, bestPv: string[]): PositionRecord => ({ fen, score, bestMove, bestPv, depth: 16, complete: true, terminal: null });

function move(fenBefore: string, uci: string, before: PositionRecord, afterScore: WhiteScore, afterPv: string[], over: Partial<ReviewMove['classification']> = {}): ReviewMove {
  const c = new Chess(fenBefore);
  const mv = c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4) });
  const after = rec(c.fen(), afterScore, afterPv[0] ?? null, afterPv);
  return {
    nodeId: 'n1', ply: 5, san: mv.san, uci, color: mv.color, moveNumber: 3, fenBefore, before, after,
    classification: { moveClass: 'blunder', winBefore: 55, winAfter: 8, winLoss: 47, accuracy: 5, isEngineBest: false, tags: [], grade: 'blunder', ...over },
    swing: -47,
  };
}

const HANG = 'r1bqkbnr/pppp1ppp/2n5/4p2Q/4P3/8/PPPP1PPP/RNB1KBNR w KQkq - 2 3';

describe('explainBadMove', () => {
  it('names the refutation, the captured piece and the material lost, using only the engine lines', () => {
    const m = move(HANG, 'h5e5', rec(HANG, cp(40), 'f1c4', ['f1c4', 'g8f6']), cp(-800), ['c6e5']);
    const r = explainBadMove(m);
    const text = r.map((x) => x.text).join(' | ');
    expect(r[0]?.kind).toBe('eval');
    expect(text).toContain('55% to 8%');
    expect(text).toMatch(/best reply is Nxe5/);
    expect(r.some((x) => x.kind === 'hanging' && /queen/.test(x.text) && /e5/.test(x.text))).toBe(true);
    expect(r.some((x) => x.kind === 'material' && /9 pawns/.test(x.text))).toBe(true);
    expect(r.some((x) => x.kind === 'quiet')).toBe(false);
  });
  it('reports a missed mate and an allowed mate from the tags', () => {
    const missed = move(HANG, 'a2a3', rec(HANG, { pov: 'white', kind: 'mate', value: 2 }, 'h5f7', ['h5f7']), cp(100), ['g8f6'], { tags: ['missed-mate'], moveClass: 'mistake', grade: 'mistake' });
    expect(explainBadMove(missed).some((x) => x.kind === 'mate' && /forced mate in 2/.test(x.text))).toBe(true);
    const allowed = move(HANG, 'a2a3', rec(HANG, cp(30), 'f1c4', ['f1c4']), { pov: 'white', kind: 'mate', value: -1 }, ['d8h4'], { tags: ['allowed-mate'] });
    expect(explainBadMove(allowed).some((x) => x.kind === 'mate' && /mate in 1/.test(x.text))).toBe(true);
  });
  it('says plainly when the lines show no concrete loss', () => {
    const m = move('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 'a2a3', rec('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', cp(30), 'e2e4', ['e2e4']), cp(-30), ['e7e5'], { moveClass: 'inaccuracy', grade: 'inaccuracy', winLoss: 6 });
    const r = explainBadMove(m);
    expect(r.at(-1)?.kind).toBe('quiet');
    expect(r.at(-1)?.text).toMatch(/no immediate loss of material/);
  });
  it('counts material along a line, extending through a capture sequence', () => {
    // after 1.e4 d5: exd5 Qxd5 Nc3 -> White wins a pawn then loses it back
    const fen = 'rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2';
    expect(materialAlong(fen, ['e4d5', 'd8d5'], 'w', 1)?.delta).toBe(0); // extended one more ply because the first move captured
    expect(materialAlong(fen, ['e4d5'], 'w', 4)?.delta).toBe(1);
    expect(materialAlong('bad fen', ['e2e4'], 'w')).toBeNull();
  });
});
