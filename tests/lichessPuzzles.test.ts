import { describe, expect, it } from 'vitest';
import { difficultyOf, fetchLichessPuzzles, loadSavedLichessPuzzles, mergeLichessPuzzles, parseLichessPuzzle, PuzzleFetchError, saveLichessPuzzles } from '@/puzzles/lichessPuzzles';
import { duePuzzles, nextDueTime, nextSrs, sanitizeProgress, SRS_DAYS, validatePuzzle, type Puzzle } from '@/puzzles/puzzles';

// A real entry from https://lichess.org/api/puzzle/batch/mix (fetched in a browser): black to move, mate in 3.
const REAL = {
  game: { pgn: 'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6 f3 e5 Nb3 Be6 Bg5 Be7 Bxf6 Bxf6 Nd5 Bxd5 Qxd5 Nc6 Bc4 O-O O-O Rc8 a3 b5 Be2 Kh8 Rfd1 Be7 c3 f5 Nd2 f4 c4 Rf6 cxb5 axb5 Bxb5 Qb6+ Kh1 Nd4 a4 Rg6 Nc4 Qd8 a5 Bh4 Nb6 Rc2 Bf1 Rh6 b4 Bg3 h3' },
  puzzle: { id: '3mKyB', rating: 1566, plays: 2906, solution: ['h6h3', 'g2h3', 'c2h2', 'h1g1', 'd4f3'], themes: ['middlegame', 'long', 'mateIn3', 'sacrifice', 'kingsideAttack', 'cornerMate'], initialPly: 56 },
};

describe('Lichess puzzles', () => {
  it('replays the game to the puzzle position and keeps the solution', () => {
    const p = parseLichessPuzzle(REAL);
    expect(p).toMatchObject({ id: 'li-3mKyB', theme: 'mate3', mateIn: 3, difficulty: 'medium', sideToMove: 'b' });
    expect(p?.solution).toEqual(REAL.puzzle.solution);
    expect(p?.fen.split(' ')[0]).toBe('3q3k/6pp/1N1p3r/P2Qp3/1P1nPp2/5PbP/2r3P1/R2R1B1K');
    expect(validatePuzzle(p).ok).toBe(true);
  });
  it('rejects bad entries', () => {
    expect(parseLichessPuzzle(null)).toBeNull();
    expect(parseLichessPuzzle({ game: { pgn: 'e4 e4' }, puzzle: REAL.puzzle })).toBeNull(); // illegal game
    expect(parseLichessPuzzle({ game: REAL.game, puzzle: { ...REAL.puzzle, solution: ['h6h3', 'g2h3'] } })).toBeNull(); // must end on the solver
    expect(parseLichessPuzzle({ game: REAL.game, puzzle: { ...REAL.puzzle, solution: ['h6h8'] } })).toBeNull(); // illegal move
    expect(parseLichessPuzzle({ game: REAL.game, puzzle: { ...REAL.puzzle, id: '../x' } })).toBeNull();
  });
  it('maps difficulty and non-mate themes', () => {
    expect([1000, 1500, 2100].map(difficultyOf)).toEqual(['easy', 'medium', 'hard']);
    const t = parseLichessPuzzle({ game: REAL.game, puzzle: { ...REAL.puzzle, themes: ['fork', 'defensiveMove'] } });
    expect(t?.theme).toBe('defence');
    expect(parseLichessPuzzle({ game: REAL.game, puzzle: { ...REAL.puzzle, themes: ['fork'] } })?.theme).toBe('tactic');
  });
  it('fetches, skips invalid entries and maps errors', async () => {
    const ok = (async () => new Response(JSON.stringify({ puzzles: [REAL, { junk: 1 }] }), { status: 200 })) as unknown as typeof fetch;
    const r = await fetchLichessPuzzles(20, ok);
    expect(r.puzzles).toHaveLength(1);
    expect(r.rejected).toBe(1);
    await expect(fetchLichessPuzzles(20, (async () => new Response('', { status: 429 })) as unknown as typeof fetch)).rejects.toBeInstanceOf(PuzzleFetchError);
    await expect(fetchLichessPuzzles(20, (async () => { throw new TypeError('blocked'); }) as unknown as typeof fetch)).rejects.toThrow(/bundled puzzles still work/);
    await expect(fetchLichessPuzzles(20, (async () => new Response('{"x":1}', { status: 200 })) as unknown as typeof fetch)).rejects.toBeInstanceOf(PuzzleFetchError);
  });
  it('merges without duplicates and keeps the newest within the cap', () => {
    const p = parseLichessPuzzle(REAL) as Puzzle;
    expect(mergeLichessPuzzles([p], [p])).toHaveLength(1);
    const many = Array.from({ length: 305 }, (_, i) => ({ ...p, id: `li-${i}` }));
    const merged = mergeLichessPuzzles([], many);
    expect(merged).toHaveLength(300);
    expect(merged[299]?.id).toBe('li-304');
  });
  it('re-validates what it loads from storage', () => {
    const store = new Map<string, string>();
    (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
    const p = parseLichessPuzzle(REAL) as Puzzle;
    expect(saveLichessPuzzles([p, { ...p, id: 'p001' }, { ...p, id: 'li-bad', solution: ['a1a1'] }])).toBe(true);
    expect(loadSavedLichessPuzzles().map((x) => x.id)).toEqual(['li-3mKyB']);
    store.set('chess-analysis:lichess-puzzles:v1', 'not json');
    expect(loadSavedLichessPuzzles()).toEqual([]);
  });
});

describe('spaced repetition', () => {
  const DAY = 86_400_000;
  const mk = (id: string): Puzzle => ({ ...(parseLichessPuzzle(REAL) as Puzzle), id });
  it('moves up a box on success and back to box 1 on a miss', () => {
    const a = nextSrs(undefined, true, 0);
    expect(a).toEqual({ box: 1, due: SRS_DAYS[0] * DAY });
    const b = nextSrs(a, true, 10 * DAY);
    expect(b.box).toBe(2);
    expect(b.due).toBe(10 * DAY + SRS_DAYS[1] * DAY);
    expect(nextSrs({ box: 5, due: 0 }, true, 0).box).toBe(5);
    expect(nextSrs({ box: 4, due: 0 }, false, 0).box).toBe(1);
  });
  it('lists due puzzles, most overdue first, and finds the next time', () => {
    const all = [mk('a'), mk('b'), mk('c')];
    const progress = { solved: {}, streak: 0, bestStreak: 0, srs: { a: { box: 1, due: 500 }, b: { box: 2, due: 100 }, c: { box: 1, due: 9000 } } };
    expect(duePuzzles(all, progress, 1000).map((p) => p.id)).toEqual(['b', 'a']);
    expect(nextDueTime(all, progress)).toBe(100);
    expect(duePuzzles(all, { solved: {}, streak: 0, bestStreak: 0 }, 1000)).toEqual([]);
  });
  it('sanitizes stored schedules', () => {
    const r = sanitizeProgress({ solved: {}, srs: { ok: { box: 3, due: 5 }, bad1: { box: 9, due: 5 }, bad2: { box: 1 }, bad3: 'x', bad4: { box: 1.5, due: 1 } } });
    expect(r.srs).toEqual({ ok: { box: 3, due: 5 } });
    expect(sanitizeProgress({ solved: {} }).srs).toBeUndefined();
  });
});
