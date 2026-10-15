import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EMPTY_PROGRESS,
  pickNextPuzzle,
  puzzleFromMistake,
  sanitizeProgress,
  validatePuzzle,
  validatePuzzles,
  type Puzzle,
} from '@/puzzles/puzzles';
import type { ReviewMove } from '@/analysis/review';
import { getNode } from '@/chess/gameTree';
import { gameStore, loadGame, playMove, resetGameStoreForTests } from '@/stores/gameStore';
import {
  alternativeIsAcceptable,
  boardLocked,
  exitPuzzles,
  flipBoard,
  hint,
  initPuzzles,
  puzzleStore,
  resetPuzzleStoreForTests,
  revealSolution,
  setAlternativeChecker,
  startPuzzle,
} from '@/stores/puzzleStore';
import { settingsStore, updateSettings } from '@/stores/settingsStore';
import { uiStore } from '@/stores/uiStore';
import { parsePgn } from '@/pgn/pgn';
import type { WhiteScore } from '@/types/engine';

const MATE1 = { id: 't1', fen: '6k1/5ppp/8/8/8/8/8/R3K3 w - - 0 1', solution: ['a1a8'], theme: 'mate1', difficulty: 'easy' };
const MATE2 = { id: 't2', fen: '7k/8/8/8/8/8/1R6/R3K3 w - - 0 1', solution: ['a1a7', 'h8g8', 'b2b8'], theme: 'mate2', difficulty: 'easy' };
const TWO_MATES = { id: 't3', fen: '6k1/5ppp/8/8/8/8/1R6/R3K3 w - - 0 1', solution: ['a1a8'], theme: 'mate1', difficulty: 'easy' };
const TACTIC = { id: 't4', fen: '6k1/5ppp/8/8/8/8/1R6/R3K3 w - - 0 1', solution: ['a1a8'], theme: 'tactic', difficulty: 'medium' };

const p = (raw: unknown): Puzzle => {
  const r = validatePuzzle(raw);
  if (!r.ok) throw new Error(r.error);
  return r.puzzle;
};
const move = (uci: string) => playMove({ from: uci.slice(0, 2), to: uci.slice(2, 4) } as never);
const cur = () => getNode(gameStore.get().tree, gameStore.get().currentId);

beforeEach(() => {
  vi.useFakeTimers();
  resetGameStoreForTests();
  resetPuzzleStoreForTests();
  initPuzzles();
  updateSettings({ autoAnalyze: true, orientation: 'white' });
  uiStore.set({ tacticSquares: [] });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('puzzle validation', () => {
  it('accepts a well-formed puzzle and derives the side to move', () => {
    expect(p(MATE1).sideToMove).toBe('w');
    expect(p({ ...MATE1, fen: '6k1/5ppp/8/8/8/8/8/R3K3 b - - 0 1', solution: ['g8f8'] }).sideToMove).toBe('b');
  });

  it.each([
    ['illegal solution move', { ...MATE1, solution: ['a1h8'] }],
    ['even-length solution (must end on the solver)', { ...MATE2, solution: ['a1a7', 'h8g8'] }],
    ['empty solution', { ...MATE1, solution: [] }],
    ['bad fen', { ...MATE1, fen: 'nonsense' }],
    ['unknown theme', { ...MATE1, theme: 'x' }],
    ['not an object', 5],
  ])('rejects: %s', (_name, raw) => {
    expect(validatePuzzle(raw).ok).toBe(false);
  });

  it('drops invalid entries from a set and counts them', () => {
    const r = validatePuzzles([MATE1, { ...MATE1, id: 'bad', solution: ['h1h8'] }, MATE2]);
    expect(r.puzzles.map((x) => x.id)).toEqual(['t1', 't2']);
    expect(r.rejected).toBe(1);
  });
});

describe('progress and selection', () => {
  it('sanitises stored progress', () => {
    expect(sanitizeProgress('x')).toEqual(EMPTY_PROGRESS);
    const r = sanitizeProgress({ solved: { a: { attempts: 2, clean: true }, b: 5 }, streak: -3, bestStreak: 4.7 });
    expect(r.solved).toEqual({ a: { attempts: 2, clean: true } });
    expect(r.streak).toBe(0);
    expect(r.bestStreak).toBe(4);
  });

  it('prefers unsolved puzzles that match the filter and avoids the current one', () => {
    const all = [p(MATE1), p(MATE2), p(TACTIC)];
    const progress = { solved: { t1: { attempts: 1, clean: true } }, streak: 0, bestStreak: 0 };
    expect(pickNextPuzzle(all, progress, { difficulty: 'any', theme: 'any' }, null)?.id).toBe('t2');
    expect(pickNextPuzzle(all, progress, { difficulty: 'medium', theme: 'any' }, null)?.id).toBe('t4');
    expect(pickNextPuzzle(all, progress, { difficulty: 'hard', theme: 'any' }, null)).toBeNull();
    const done = { solved: { t1: { attempts: 1, clean: true }, t2: { attempts: 1, clean: true }, t4: { attempts: 1, clean: true } }, streak: 0, bestStreak: 0 };
    expect(pickNextPuzzle(all, done, { difficulty: 'any', theme: 'any' }, 't1')?.id).not.toBe('t1');
  });

  it('builds a puzzle from a reviewed mistake and skips moves that were already best', () => {
    const base = {
      nodeId: 'n3',
      fenBefore: MATE1.fen,
      moveNumber: 1,
      color: 'w',
      san: 'Kd2',
      before: { bestMove: 'a1a8' },
      classification: { isEngineBest: false, moveClass: 'blunder' },
    } as unknown as ReviewMove;
    expect(puzzleFromMistake(base)?.solution).toEqual(['a1a8']);
    expect(puzzleFromMistake({ ...base, classification: { isEngineBest: true } } as unknown as ReviewMove)).toBeNull();
    expect(puzzleFromMistake({ ...base, before: { bestMove: null } } as unknown as ReviewMove)).toBeNull();
  });
});

describe('judging alternative moves', () => {
  const cp = (value: number): WhiteScore => ({ pov: 'white', kind: 'cp', value });
  const mate = (value: number): WhiteScore => ({ pov: 'white', kind: 'mate', value });
  it('mate puzzles need an equally fast mate', () => {
    expect(alternativeIsAcceptable(mate(2), mate(2), 'w')).toBe(true);
    expect(alternativeIsAcceptable(mate(2), mate(1), 'w')).toBe(true);
    expect(alternativeIsAcceptable(mate(2), mate(3), 'w')).toBe(false);
    expect(alternativeIsAcceptable(mate(2), cp(900), 'w')).toBe(false);
    expect(alternativeIsAcceptable(mate(-2), mate(-2), 'b')).toBe(true); // Black mating, White-perspective sign
    expect(alternativeIsAcceptable(mate(-2), mate(2), 'b')).toBe(false);
  });
  it('other puzzles allow a tiny loss of winning chances, from the solver\'s side', () => {
    expect(alternativeIsAcceptable(cp(300), cp(290), 'w')).toBe(true);
    expect(alternativeIsAcceptable(cp(300), cp(-100), 'w')).toBe(false);
    expect(alternativeIsAcceptable(cp(-300), cp(-290), 'b')).toBe(true);
    expect(alternativeIsAcceptable(cp(-300), cp(100), 'b')).toBe(false);
  });
});

describe('puzzle session', () => {
  it('parks the real game, runs the puzzle and restores everything on exit', () => {
    loadGame(parsePgn('1. e4 e5 *').games[0]!.tree);
    const before = gameStore.get().tree;
    updateSettings({ orientation: 'black' });
    startPuzzle(p(MATE1));
    expect(cur().fen).toBe(p(MATE1).fen);
    expect(puzzleStore.get().orientation).toBe('white'); // solver's side, as an override
    // the saved settings are NOT touched (they persist across reloads)
    expect(settingsStore.get().autoAnalyze).toBe(true);
    expect(settingsStore.get().orientation).toBe('black');
    flipBoard();
    expect(puzzleStore.get().orientation).toBe('black');
    exitPuzzles();
    expect(gameStore.get().tree).toBe(before);
    expect(puzzleStore.get().orientation).toBeNull();
    expect(settingsStore.get().orientation).toBe('black');
    expect(puzzleStore.get().phase).toBe('off');
  });

  it('solves a one-move puzzle with the stored move, records progress and locks the board', () => {
    startPuzzle(p(MATE1));
    expect(boardLocked(puzzleStore.get())).toBe(false);
    move('a1a8');
    const s = puzzleStore.get();
    expect(s.phase).toBe('solved');
    expect(s.progress.solved['t1']).toEqual({ attempts: 1, clean: true });
    expect(s.progress.streak).toBe(1);
    expect(s.solutionSan).toContain('Ra8#');
    expect(boardLocked(s)).toBe(true);
  });

  it('plays the opponent reply by itself in a multi-move puzzle', async () => {
    startPuzzle(p(MATE2));
    move('a1a7');
    expect(puzzleStore.get().phase).toBe('solving');
    expect(boardLocked(puzzleStore.get())).toBe(true); // opponent is "thinking"
    await vi.advanceTimersByTimeAsync(600);
    expect(cur().uci).toBe('h8g8');
    expect(boardLocked(puzzleStore.get())).toBe(false);
    move('b2b8');
    expect(puzzleStore.get().phase).toBe('solved');
  });

  it('rejects a wrong move, takes it back and lets the user retry; streak is not extended', async () => {
    setAlternativeChecker(async () => false);
    startPuzzle(p(MATE1));
    const root = gameStore.get().currentId;
    move('e1d1');
    expect(puzzleStore.get().checking).toBe(true);
    await vi.advanceTimersByTimeAsync(50);
    expect(puzzleStore.get().message?.kind).toBe('bad');
    await vi.advanceTimersByTimeAsync(1200);
    expect(gameStore.get().currentId).toBe(root);
    expect(Object.keys(gameStore.get().tree.nodes)).toHaveLength(1); // the wrong move is gone
    expect(puzzleStore.get().awaitingUser).toBe(true);
    move('a1a8');
    const s = puzzleStore.get();
    expect(s.phase).toBe('solved');
    expect(s.wrong).toBe(1);
    expect(s.progress.solved['t1']?.clean).toBe(false);
    expect(s.progress.streak).toBe(0);
  });

  it('accepts any checkmate in a mate puzzle without asking the engine', () => {
    setAlternativeChecker(async () => {
      throw new Error('engine must not be needed');
    });
    startPuzzle(p(TWO_MATES));
    move('b2b8');
    expect(puzzleStore.get().phase).toBe('solved');
    expect(puzzleStore.get().message?.text).toMatch(/different mating move/);
  });

  it('accepts an engine-verified alternative and ends the puzzle as solved', async () => {
    const seen: unknown[] = [];
    setAlternativeChecker(async (q) => {
      seen.push(q);
      return true;
    });
    startPuzzle(p(TACTIC));
    move('b2b8');
    await vi.advanceTimersByTimeAsync(50);
    expect(puzzleStore.get().phase).toBe('solved');
    expect(seen).toEqual([{ fenBefore: p(TACTIC).fen, playedUci: 'b2b8', solutionUci: 'a1a8', mover: 'w' }]);
  });

  it('does not count a move the engine could not verify as wrong progress', async () => {
    setAlternativeChecker(async () => null);
    startPuzzle(p(TACTIC));
    move('e1d1');
    await vi.advanceTimersByTimeAsync(50);
    expect(puzzleStore.get().message?.text).toMatch(/could not verify/);
    await vi.advanceTimersByTimeAsync(1200);
    expect(puzzleStore.get().phase).toBe('solving');
  });

  it('hints highlight the piece and then the target square', () => {
    startPuzzle(p(MATE1));
    hint();
    expect(uiStore.get().tacticSquares).toEqual(['a1']);
    hint();
    hint();
    expect(uiStore.get().tacticSquares).toEqual(['a1', 'a8']);
    expect(puzzleStore.get().hints).toBe(2);
    move('a1a8');
    expect(puzzleStore.get().progress.solved['t1']?.clean).toBe(false);
    expect(uiStore.get().tacticSquares).toEqual([]);
  });

  it('showing the solution plays it, resets the streak and does not mark the puzzle solved', () => {
    startPuzzle(p(MATE2));
    revealSolution();
    const s = puzzleStore.get();
    expect(s.phase).toBe('revealed');
    expect(s.progress.solved['t2']).toBeUndefined();
    expect(s.progress.streak).toBe(0);
    expect(cur().uci).toBe('b2b8');
    expect(s.solutionSan).toContain('Rb8#');
  });

  it('does not let the user wander off the puzzle position while solving', () => {
    startPuzzle(p(MATE2));
    const root = gameStore.get().currentId;
    gameStore.set({ currentId: root }); // no-op
    move('a1a7');
    vi.advanceTimersByTime(10);
    // jump back to root while the reply is pending: it is restored to the puzzle cursor
    gameStore.set({ currentId: root });
    expect(gameStore.get().currentId).not.toBe(root);
  });

  it('a move made while it is not the solver\'s turn (e.g. from the opening book) is taken back', async () => {
    startPuzzle(p(MATE2));
    move('a1a7'); // opponent reply pending
    const afterUser = gameStore.get().currentId;
    move('h8g8'); // someone plays the reply for the opponent through another panel
    expect(gameStore.get().currentId).toBe(afterUser);
    await vi.advanceTimersByTimeAsync(600);
    expect(cur().uci).toBe('h8g8'); // the scripted reply still arrives exactly once
    expect(puzzleStore.get().awaitingUser).toBe(true);
  });

  it('a stale timer from an abandoned puzzle cannot touch the next one', async () => {
    startPuzzle(p(MATE2));
    move('a1a7'); // reply is scheduled
    startPuzzle(p(MATE1)); // user skips immediately
    await vi.advanceTimersByTimeAsync(2000);
    expect(cur().fen).toBe(p(MATE1).fen);
    expect(Object.keys(gameStore.get().tree.nodes)).toHaveLength(1);
  });
});

describe('bundled puzzle set (public/data/puzzles.json)', async () => {
  const { readFileSync } = await import('node:fs');
  const { resolve } = await import('node:path');
  const raw = JSON.parse(readFileSync(resolve(__dirname, '../public/data/puzzles.json'), 'utf8')) as unknown[];
  const { puzzles, rejected } = validatePuzzles(raw);

  it('every puzzle is well formed with a legal solution (nothing is rejected)', () => {
    expect(rejected).toBe(0);
    expect(puzzles.length).toBeGreaterThanOrEqual(60);
  });
  it('has unique ids and unique positions', () => {
    expect(new Set(puzzles.map((x) => x.id)).size).toBe(puzzles.length);
    expect(new Set(puzzles.map((x) => x.fen.split(' ').slice(0, 4).join(' '))).size).toBe(puzzles.length);
  });
  it('covers all difficulties and the main themes', () => {
    for (const d of ['easy', 'medium', 'hard']) expect(puzzles.some((x) => x.difficulty === d)).toBe(true);
    for (const t of ['mate2', 'mate3', 'tactic', 'defence']) expect(puzzles.some((x) => x.theme === t)).toBe(true);
  });
  it('mate puzzles really end in checkmate', async () => {
    const { Chess } = await import('chess.js');
    for (const x of puzzles.filter((q) => q.theme.startsWith('mate'))) {
      const c = new Chess(x.fen);
      for (const m of x.solution) c.move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m[4] });
      expect(c.isCheckmate(), x.id).toBe(true);
      expect(Math.ceil(x.solution.length / 2), x.id).toBe(x.mateIn);
    }
  });
});
