import { describe, expect, it } from 'vitest';
import { buildMyPuzzle, decodePuzzleCode, encodePuzzleCode, parseMyPuzzles, puzzleIdFor, puzzleLink } from '@/puzzles/myPuzzles';

// White to play: Qh5+ is not needed, simple mate in 1 (back rank): Ra8#
const MATE1 = '6k1/5ppp/8/8/8/8/8/R3K3 w - - 0 1';

describe('own puzzles', () => {
  it('builds a valid puzzle and labels a mate with its depth', () => {
    const r = buildMyPuzzle({ fen: MATE1, solution: ['a1a8'], title: '  Back rank  ', explanation: 'The king has no escape squares.', difficulty: 'easy', exact: false });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.puzzle.theme).toBe('custom');
    expect(r.puzzle.title).toBe('Back rank');
    expect(r.puzzle.mateIn).toBe(1);
    expect(r.puzzle.sideToMove).toBe('w');
    expect(r.puzzle.id.startsWith('u-')).toBe(true);
  });
  it('rejects illegal, empty and even-length solutions', () => {
    const base = { fen: MATE1, title: '', explanation: '', difficulty: 'medium' as const, exact: false };
    expect(buildMyPuzzle({ ...base, solution: ['a1a5', 'g8g7'] }).ok).toBe(false); // ends on the opponent's move
    expect(buildMyPuzzle({ ...base, solution: [] }).ok).toBe(false);
    expect(buildMyPuzzle({ ...base, solution: ['a1h8'] }).ok).toBe(false); // illegal
  });
  it('the id depends only on the content, so an import twice does not duplicate', () => {
    expect(puzzleIdFor(MATE1, ['a1a8'])).toBe(puzzleIdFor(MATE1, ['a1a8']));
    expect(puzzleIdFor(MATE1, ['a1a8'])).not.toBe(puzzleIdFor(MATE1, ['e1e2']));
  });
  it('a code round-trips with name, explanation, difficulty and the exact flag', () => {
    const built = buildMyPuzzle({ fen: MATE1, solution: ['a1a8'], title: 'Matt på första raden åäö ♞', explanation: 'För att kungen saknar flyktrutor.', difficulty: 'hard', exact: true });
    if (!built.ok) throw new Error('build failed');
    const code = encodePuzzleCode(built.puzzle);
    expect(code.startsWith('cp1.')).toBe(true);
    const back = decodePuzzleCode(code);
    expect(back.ok).toBe(true);
    if (back.ok) expect(back.puzzle).toEqual(built.puzzle);
  });
  it('accepts a link or text around the code', () => {
    const built = buildMyPuzzle({ fen: MATE1, solution: ['a1a8'], title: 'x', explanation: '', difficulty: 'easy', exact: false });
    if (!built.ok) throw new Error('build failed');
    const link = puzzleLink(built.puzzle, 'https://example.test/chess-analysis/?x=1#old');
    expect(link.startsWith('https://example.test/chess-analysis/?x=1#p=cp1.')).toBe(true);
    expect(decodePuzzleCode(link).ok).toBe(true);
    expect(decodePuzzleCode(`Try this: ${encodePuzzleCode(built.puzzle)} thanks!`).ok).toBe(true);
  });
  it('rejects garbage, damaged and tampered codes (an illegal solution is caught on import)', () => {
    expect(decodePuzzleCode('hello').ok).toBe(false);
    expect(decodePuzzleCode('cp1.').ok).toBe(false);
    expect(decodePuzzleCode('cp1.!!!!').ok).toBe(false);
    const evil = 'cp1.' + btoa(JSON.stringify({ f: MATE1, s: ['a1h8'], d: 'easy' })).replace(/=+$/, '');
    expect(decodePuzzleCode(evil).ok).toBe(false);
    const noFen = 'cp1.' + btoa(JSON.stringify({ s: ['a1a8'], d: 'easy' })).replace(/=+$/, '');
    expect(decodePuzzleCode(noFen).ok).toBe(false);
  });
  it('stored data: only well-formed custom puzzles survive', () => {
    const good = buildMyPuzzle({ fen: MATE1, solution: ['a1a8'], title: 'a', explanation: '', difficulty: 'easy', exact: false });
    if (!good.ok) throw new Error('build failed');
    const text = JSON.stringify([good.puzzle, { id: 'x' }, { ...good.puzzle, id: 'b', theme: 'mate1' }, 'junk']);
    expect(parseMyPuzzles(text)).toEqual([good.puzzle]);
    expect(parseMyPuzzles(null)).toEqual([]);
    expect(parseMyPuzzles('not json')).toEqual([]);
  });
});
