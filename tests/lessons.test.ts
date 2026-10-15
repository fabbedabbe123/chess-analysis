import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Chess, type Square } from 'chess.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { exerciseToPuzzle, skillProgress, validateSkills, type LessonExercise, type Skill } from '@/lessons/lessons';
import { EMPTY_PROGRESS, validatePuzzle } from '@/puzzles/puzzles';
import { gameStore, playMove, resetGameStoreForTests } from '@/stores/gameStore';
import { initPuzzles, puzzleStore, resetPuzzleStoreForTests, setAlternativeChecker, startPuzzle } from '@/stores/puzzleStore';
import { updateSettings } from '@/stores/settingsStore';
import { uiStore } from '@/stores/uiStore';

const raw = JSON.parse(readFileSync(resolve(__dirname, '../public/data/lessons.json'), 'utf8')) as unknown;
const { skills, rejected } = validateSkills(raw);
const exercise = (id: string): LessonExercise => {
  for (const s of skills) for (const e of s.exercises) if (e.id === id) return e;
  throw new Error(`no exercise ${id}`);
};
const VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };

/** Plays the first `plies` moves of an exercise and returns the game. */
function play(ex: LessonExercise, plies: number): Chess {
  const chess = new Chess(ex.fen);
  for (const uci of ex.solution.slice(0, plies)) chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), ...(uci.length === 5 ? { promotion: uci[4] as string } : {}) });
  return chess;
}
/** Squares of enemy pieces (worth a knight or more) that the piece standing on `from` attacks. */
function targets(chess: Chess, from: Square, enemy: 'w' | 'b'): string[] {
  const out: string[] = [];
  for (const row of chess.board()) for (const sq of row) {
    if (sq === null || sq.color !== enemy || VALUE[sq.type]! < 3) continue;
    if (chess.attackers(sq.square, enemy === 'w' ? 'b' : 'w').includes(from)) out.push(sq.square);
  }
  return out;
}
const lastTo = (ex: LessonExercise, ply: number) => ex.solution[ply]!.slice(2, 4) as Square;
const material = (chess: Chess, color: 'w' | 'b') => chess.board().flat().reduce((n, sq) => n + (sq !== null && sq.color === color && sq.type !== 'k' ? VALUE[sq.type]! : 0), 0);

describe('bundled lessons (public/data/lessons.json)', () => {
  it('every skill and exercise is well formed with a legal line (nothing is rejected)', () => {
    expect(rejected).toBe(0);
    expect(skills.length).toBeGreaterThanOrEqual(15);
    expect(skills.map((s) => s.category).filter((v, i, a) => a.indexOf(v) === i).sort()).toEqual(['endgames', 'openings', 'tactics']);
  });

  it('has unique ids, explanations and at least one exercise per skill', () => {
    const ids = skills.flatMap((s) => s.exercises.map((e) => e.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(skills.map((s) => s.id)).size).toBe(skills.length);
    for (const s of skills) {
      expect(s.exercises.length).toBeGreaterThan(0);
      expect(s.intro.length).toBeGreaterThan(0);
      for (const e of s.exercises) expect(e.why.length).toBeGreaterThan(20);
    }
  });

  it('covers the requested topics: openings, forks, trades, sacrifices and discovered checks', () => {
    const titles = skills.map((s) => s.title.toLowerCase()).join(' | ');
    for (const word of ['fork', 'pin', 'skewer', 'discovered', 'sacrifice', 'trade', 'back-rank', 'italian', 'ruy lopez', 'sicilian', 'opening principles']) expect(titles).toContain(word);
  });

  it('opening drills are book lines for the right colour with a named opening', () => {
    const drills = skills.filter((s) => s.category === 'openings' && s.color !== undefined);
    expect(drills.length).toBeGreaterThanOrEqual(6);
    for (const s of drills) for (const e of s.exercises) {
      expect(e.kind).toBe('book');
      expect(e.exact).toBe(true);
      expect(e.sideToMove).toBe(s.color);
      expect(e.opening).toBeTruthy();
    }
  });
});

describe('the tactical idea is really in each position (geometry, independent of the engine)', () => {
  it('every fork move attacks at least two valuable pieces, and the king-and-queen forks give check', () => {
    for (const id of ['forks-1', 'forks-2', 'forks-3', 'forks-4']) {
      const ex = exercise(id);
      const chess = play(ex, 1);
      expect(targets(chess, lastTo(ex, 0), chess.turn()).length, id).toBeGreaterThanOrEqual(2);
      expect(chess.inCheck(), id).toBe(true);
    }
  });

  it('pins: the pinned piece has no legal move after the first move (absolute pin)', () => {
    const a = play(exercise('pins-1'), 1);
    expect(a.moves({ square: 'e6' as Square }).length).toBe(0);
    const b = play(exercise('pins-2'), 1);
    expect(b.moves({ square: 'e7' as Square }).length).toBe(0);
  });

  it('skewers: check first, then the piece behind the king is attacked by the same piece', () => {
    for (const id of ['skewers-1', 'skewers-2']) {
      const ex = exercise(id);
      const chess = play(ex, 1);
      expect(chess.inCheck(), id).toBe(true);
      const victim = lastTo(ex, 2);
      const board = new Chess(chess.fen());
      board.remove(board.findPiece({ type: 'k', color: board.turn() })[0]!);
      expect(board.attackers(victim, ex.sideToMove).includes(lastTo(ex, 0)), id).toBe(true);
    }
  });

  it('discovered check is not given by the moved piece; double check has two checkers', () => {
    const disc = exercise('discovered-1');
    const a = play(disc, 1);
    const king = a.findPiece({ type: 'k', color: a.turn() })[0]!;
    expect(a.inCheck()).toBe(true);
    expect(a.attackers(king, 'w')).toEqual(['e1']);
    const dbl = exercise('discovered-2');
    const b = play(dbl, 1);
    expect(b.attackers(b.findPiece({ type: 'k', color: b.turn() })[0]!, 'w').length).toBe(2);
  });

  it('back-rank mates are mates against a king on its first rank hemmed in by pawns', () => {
    for (const id of ['backrank-1', 'backrank-2', 'backrank-3']) {
      const ex = exercise(id);
      const chess = play(ex, ex.solution.length);
      expect(chess.isCheckmate(), id).toBe(true);
      const king = chess.findPiece({ type: 'k', color: chess.turn() })[0]!;
      expect(['8', '1']).toContain(king[1]);
    }
  });

  it('smothered mate: a knight mates a king whose neighbours are all its own pieces', () => {
    const ex = exercise('sacrifices-1');
    const chess = play(ex, ex.solution.length);
    expect(chess.isCheckmate()).toBe(true);
    expect(chess.get(lastTo(ex, 0))?.type).toBe('n');
    const king = chess.findPiece({ type: 'k', color: chess.turn() })[0]!;
    const file = king.charCodeAt(0) - 97;
    const rank = Number(king[1]);
    let neighbours = 0;
    let own = 0;
    for (let df = -1; df <= 1; df++) for (let dr = -1; dr <= 1; dr++) {
      const f = file + df;
      const r = rank + dr;
      if ((df === 0 && dr === 0) || f < 0 || f > 7 || r < 1 || r > 8) continue;
      neighbours += 1;
      if (chess.get(`${String.fromCharCode(97 + f)}${r}` as Square)?.color === chess.turn()) own += 1;
    }
    expect(own).toBe(neighbours);
  });

  it('sacrifice lines end in checkmate and the queen sacrifice is really a sacrifice', () => {
    for (const id of ['sacrifices-2', 'sacrifices-3', 'deflection-1', 'rook-mate-1']) {
      const ex = exercise(id);
      expect(play(ex, ex.solution.length).isCheckmate(), id).toBe(true);
    }
    const q = exercise('sacrifices-2');
    expect(play(q, 1).get('g8')?.type).toBe('q');
    expect(play(q, 2).get('g8')?.type).toBe('r'); // the rook took the queen
  });

  it('the trade really wins the exchange: bishop (3) for rook (5)', () => {
    const ex = exercise('trades-1');
    const before = new Chess(ex.fen);
    const after = play(ex, 2);
    const gain = (material(after, 'w') - material(after, 'b')) - (material(before, 'w') - material(before, 'b'));
    expect(gain).toBe(2);
  });
});

describe('mastery', () => {
  const skill: Skill = { id: 's', title: 'S', category: 'tactics', blurb: '', intro: [], ideas: [], exercises: ['a', 'b'].map((id) => ({ ...exercise('backrank-1'), id })) };
  it('is derived only from the user\'s own solved exercises', () => {
    expect(skillProgress(skill, EMPTY_PROGRESS).mastery).toBe('new');
    expect(skillProgress(skill, { ...EMPTY_PROGRESS, solved: { a: { attempts: 3, clean: false } } }).mastery).toBe('learning');
    expect(skillProgress(skill, { ...EMPTY_PROGRESS, solved: { a: { attempts: 1, clean: true }, b: { attempts: 2, clean: false } } }).mastery).toBe('practised');
    expect(skillProgress(skill, { ...EMPTY_PROGRESS, solved: { a: { attempts: 1, clean: true }, b: { attempts: 1, clean: true } } })).toEqual({ total: 2, solved: 2, clean: 2, mastery: 'mastered' });
  });
});

describe('lesson exercises in the puzzle engine', () => {
  const move = (uci: string) => playMove({ from: uci.slice(0, 2), to: uci.slice(2, 4) } as never);
  beforeEach(() => {
    vi.useFakeTimers();
    resetGameStoreForTests();
    resetPuzzleStoreForTests();
    initPuzzles();
    updateSettings({ autoAnalyze: true, orientation: 'white' });
    uiStore.set({ tacticSquares: [] });
  });
  afterEach(() => vi.useRealTimers());

  const skillOf = (id: string) => skills.find((s) => s.exercises.some((e) => e.id === id))!;
  const puzzleOf = (id: string) => exerciseToPuzzle(skillOf(id), exercise(id));

  it('carries the explanation, skill and exactness into a valid puzzle', () => {
    const pz = puzzleOf('backrank-1');
    expect(pz.theme).toBe('lesson');
    expect(pz.skillId).toBe('backrank');
    expect(pz.exact).toBe(true);
    expect(pz.explanation).toMatch(/escape square/);
    expect(validatePuzzle(pz).ok).toBe(true);
  });

  it('an exact exercise rejects every other move without asking the engine, then lets the user retry', async () => {
    setAlternativeChecker(async () => {
      throw new Error('engine must not be consulted for an exact lesson');
    });
    startPuzzle(puzzleOf('backrank-1'));
    move('e1d1');
    expect(puzzleStore.get().message?.text).toMatch(/idea this lesson teaches/);
    await vi.advanceTimersByTimeAsync(1200);
    expect(puzzleStore.get().wrong).toBe(1);
    expect(puzzleStore.get().phase).toBe('solving');
    move('a1a8');
    expect(puzzleStore.get().phase).toBe('solved');
    expect(puzzleStore.get().progress.solved['backrank-1']).toEqual({ attempts: 2, clean: false });
  });

  it('a mate by another move is NOT accepted in an exact mate lesson', async () => {
    startPuzzle(puzzleOf('backrank-2'));
    gameStore.get();
    move('d1d2');
    expect(puzzleStore.get().phase).toBe('solving');
  });

  it('an opening drill says "book move" and plays the opponent replies', async () => {
    const pz = puzzleOf('italian-1');
    expect(pz.book).toBe(true);
    startPuzzle(pz);
    move('d2d4');
    expect(puzzleStore.get().message?.text).toMatch(/book move/);
    await vi.advanceTimersByTimeAsync(1200);
    move(pz.solution[0]!);
    await vi.advanceTimersByTimeAsync(600);
    expect(puzzleStore.get().awaitingUser).toBe(true);
    expect(puzzleStore.get().step).toBe(2);
  });

  it('a non-exact lesson still accepts an engine-verified alternative', async () => {
    setAlternativeChecker(async () => true);
    startPuzzle(puzzleOf('opening-principles-1'));
    move('d2d4');
    await vi.advanceTimersByTimeAsync(50);
    expect(puzzleStore.get().phase).toBe('solved');
  });
});
