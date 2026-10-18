import { Chess } from 'chess.js';
import { mateDistance, sideWinPercent } from '@/analysis/eval';
import { pvToSan } from '@/analysis/pv';
import { reviewOptions, terminalScore } from '@/analysis/review';
import { createTree, getNode, hasNode } from '@/chess/gameTree';
import { THEME_LABEL, nextSrs, pickNextPuzzle, sanitizeProgress, loadPuzzles, type Puzzle, type PuzzleFilter, type PuzzleProgress, type SrsEntry } from '@/puzzles/puzzles';
import type { Color, WhiteScore } from '@/types/engine';
import type { GameTree } from '@/types/game';
import { storageGet, storageSet } from '@/utils/storage';
import { createStore, useStore } from './createStore';
import { ensureEngine, stopAnalysis } from './engineStore';
import { deleteFromHere, gameStore, playMove, setPersistenceSuspended } from './gameStore';
import { engineOptionsFrom, settingsStore, updateSettings } from './settingsStore';
import { flipPlayBoard, usePlay } from './playStore';
import { requestReanalysis, setTacticSquares } from './uiStore';

/**
 * Puzzle mode. It BORROWS the board: the user's real game is parked in `parked` and restored on exit,
 * live analysis is switched off (it would give the answer away) and nothing is written to the saved game
 * while a puzzle is open.
 *
 * Checking a move: the stored solution move is always accepted. Any other move is judged by Stockfish
 * (the shared engine): it is accepted if it mates at least as fast as the solution (mate puzzles), or if it keeps
 * the solver's winning chances within 4 percentage points of the solution move. An accepted alternative ends the
 * puzzle as solved (the scripted continuation no longer applies).
 */

export type PuzzlePhase = 'off' | 'solving' | 'solved' | 'revealed';
export interface PuzzleMessage {
  kind: 'info' | 'good' | 'bad';
  text: string;
}

export interface PuzzleState {
  phase: PuzzlePhase;
  puzzle: Puzzle | null;
  /** Index into puzzle.solution of the next expected SOLVER move. */
  step: number;
  /** Game-tree node the puzzle is currently at (the position the solver faces). */
  cursorId: string | null;
  awaitingUser: boolean;
  checking: boolean;
  wrong: number;
  hints: number;
  message: PuzzleMessage | null;
  /** Board side while a puzzle is open: the solver's side, flippable. Never written to the saved settings. */
  orientation: 'white' | 'black' | null;
  progress: PuzzleProgress;
  filter: PuzzleFilter;
  /** Solution in SAN, shown once the puzzle is over. */
  solutionSan: string | null;
  /** Puzzles still queued in a practice session. */
  sessionLeft: number;
}

const PROGRESS_KEY = 'chess-analysis:puzzles:v1';
const loadProgress = () => {
  try {
    const text = storageGet(PROGRESS_KEY);
    return sanitizeProgress(text === null ? null : (JSON.parse(text) as unknown));
  } catch {
    return sanitizeProgress(null);
  }
};

function initial(): PuzzleState {
  return {
    phase: 'off',
    puzzle: null,
    step: 0,
    cursorId: null,
    awaitingUser: false,
    checking: false,
    wrong: 0,
    hints: 0,
    message: null,
    orientation: null,
    progress: loadProgress(),
    filter: { difficulty: 'any', theme: 'any' },
    solutionSan: null,
    sessionLeft: 0,
  };
}

export const puzzleStore = createStore<PuzzleState>(initial());

export function usePuzzle<S>(selector: (s: PuzzleState) => S): S {
  return useStore(puzzleStore, selector);
}

/** True when the board must not accept moves. */
export function boardLocked(s: PuzzleState): boolean {
  return s.phase !== 'off' && !(s.phase === 'solving' && s.awaitingUser && !s.checking);
}

// ------------------------------------------------------------------ parked game

interface Parked {
  tree: GameTree;
  currentId: string;
  redoStack: string[];
  original: GameTree | null;
}
let parked: Parked | null = null;
let generation = 0;
/** True while the store itself changes the game (so its own moves are not mistaken for the user's). */
let internal = false;

function viaGame(fn: () => void): void {
  internal = true;
  try {
    fn();
  } finally {
    internal = false;
  }
}

// ------------------------------------------------------ alternative-move checker

export interface AlternativeQuery {
  fenBefore: string;
  playedUci: string;
  solutionUci: string;
  mover: Color;
}
export type AlternativeChecker = (q: AlternativeQuery) => Promise<boolean | null>;

function afterMove(fen: string, uci: string): string | null {
  try {
    const chess = new Chess(fen);
    chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), ...(uci.length === 5 ? { promotion: uci[4] as string } : {}) });
    return chess.fen();
  } catch {
    return null;
  }
}

async function engineEval(fen: string): Promise<WhiteScore | null> {
  const terminal = terminalScore(fen);
  if (terminal !== null) return terminal;
  const engine = await ensureEngine();
  const handle = engine.search({ fen, multiPv: 1, limits: { depth: 12 }, options: reviewOptions(engineOptionsFrom(settingsStore.get())) });
  const snapshot = await handle.result;
  return snapshot.lines[0]?.scoreWhite ?? null;
}

export type FirstMoveCheck =
  | { kind: 'best' }
  | { kind: 'fine'; best: string }
  | { kind: 'worse'; best: string }
  | { kind: 'unavailable' };

/**
 * Real Stockfish check of the author's first move (depth 14): is it the engine's choice, close enough to it, or clearly
 * worse? Used when someone makes their own puzzle.
 */
export async function checkFirstMove(fen: string, solutionUci: string): Promise<FirstMoveCheck> {
  try {
    const engine = await ensureEngine();
    const snapshot = await engine.search({ fen, multiPv: 1, limits: { depth: 14 }, options: reviewOptions(engineOptionsFrom(settingsStore.get())) }).result;
    const best = snapshot.lines[0]?.pv[0];
    if (best === undefined) return { kind: 'unavailable' };
    if (best === solutionUci) return { kind: 'best' };
    const bestEval = await engineEval(afterMove(fen, best) ?? fen);
    const mineEval = await engineEval(afterMove(fen, solutionUci) ?? fen);
    if (bestEval === null || mineEval === null) return { kind: 'unavailable' };
    const mover: Color = fen.split(' ')[1] === 'b' ? 'b' : 'w';
    return alternativeIsAcceptable(bestEval, mineEval, mover) ? { kind: 'fine', best } : { kind: 'worse', best };
  } catch {
    return { kind: 'unavailable' };
  }
}

/** Pure judgement used by the default checker (exported for tests). */
export function alternativeIsAcceptable(best: WhiteScore, alt: WhiteScore, mover: Color): boolean {
  const bestMate = best.kind === 'mate' && (best.value === 0 ? best.winner === mover : (best.value > 0) === (mover === 'w'));
  if (bestMate) {
    const altMate = alt.kind === 'mate' && (alt.value === 0 ? alt.winner === mover : (alt.value > 0) === (mover === 'w'));
    if (!altMate) return false;
    const d = mateDistance(alt);
    const bd = mateDistance(best);
    return d === null || bd === null || d <= bd;
  }
  return sideWinPercent(best, mover) - sideWinPercent(alt, mover) <= 4;
}

const defaultChecker: AlternativeChecker = async (q) => {
  const bestFen = afterMove(q.fenBefore, q.solutionUci);
  const altFen = afterMove(q.fenBefore, q.playedUci);
  if (bestFen === null || altFen === null) return false;
  try {
    const best = await engineEval(bestFen);
    const alt = await engineEval(altFen);
    if (best === null || alt === null) return null;
    return alternativeIsAcceptable(best, alt, q.mover);
  } catch {
    return null; // engine unavailable
  }
};

let checker: AlternativeChecker = defaultChecker;
export function setAlternativeChecker(fn: AlternativeChecker | null): void {
  checker = fn ?? defaultChecker;
}

// -------------------------------------------------------------------- actions

const REPLY_DELAY_MS = 450;
const RETRY_DELAY_MS = 900;

function saveProgress(): void {
  storageSet(PROGRESS_KEY, JSON.stringify(puzzleStore.get().progress));
}

export function startPuzzle(puzzle: Puzzle): void {
  generation += 1;
  if (puzzleStore.get().phase === 'off') {
    const g = gameStore.get();
    parked = { tree: g.tree, currentId: g.currentId, redoStack: g.redoStack, original: g.original };
    setPersistenceSuspended(true);
  }
  const tree = createTree(puzzle.fen);
  viaGame(() => gameStore.set({ tree, currentId: tree.rootId, redoStack: [], original: null }));
  stopAnalysis(); // useAutoAnalysis also stays off while a puzzle is open (it would give the answer away)
  setTacticSquares([]);
  puzzleStore.set({
    phase: 'solving',
    puzzle,
    step: 0,
    cursorId: tree.rootId,
    awaitingUser: true,
    checking: false,
    wrong: 0,
    hints: 0,
    solutionSan: null,
    orientation: puzzle.sideToMove === 'w' ? 'white' : 'black',
    message: { kind: 'info', text: `${puzzle.sideToMove === 'w' ? 'White' : 'Black'} to move. Find the best move.` },
  });
}

export function exitPuzzles(): void {
  generation += 1;
  sessionQueue = [];
  setTacticSquares([]);
  const p = parked;
  parked = null;
  puzzleStore.set({ phase: 'off', puzzle: null, cursorId: null, awaitingUser: false, checking: false, message: null, solutionSan: null, orientation: null, sessionLeft: 0 });
  if (p !== null) {
    viaGame(() => gameStore.set({ tree: p.tree, currentId: p.currentId, redoStack: p.redoStack, original: p.original }));
    requestReanalysis();
  }
  setPersistenceSuspended(false);
}

function solutionSanOf(puzzle: Puzzle): string {
  const conv = pvToSan(puzzle.fen, puzzle.solution, puzzle.solution.length);
  const first = conv.moves[0];
  return conv.moves.map((m, i) => `${m.color === 'w' ? `${m.moveNumber}.` : i === 0 ? `${m.moveNumber}...` : ''}${m.san}`).join(' ') || (first?.san ?? '');
}

/** Only bundled/online puzzles are scheduled: lesson exercises and one-off mistake puzzles cannot be rebuilt from an id. */
function withSrs(progress: PuzzleProgress, puzzle: Puzzle, success: boolean): { srs?: Record<string, SrsEntry> } {
  if ((puzzle.skillId !== undefined && puzzle.practice !== true) || puzzle.theme === 'mistake' || (puzzle.theme === 'lesson' && puzzle.practice !== true)) return progress.srs ? { srs: progress.srs } : {};
  return { srs: { ...(progress.srs ?? {}), [puzzle.id]: nextSrs(progress.srs?.[puzzle.id], success, Date.now()) } };
}

function finish(kind: 'solved' | 'revealed', text: string): void {
  const s = puzzleStore.get();
  if (s.puzzle === null) return;
  const puzzle = s.puzzle;
  setTacticSquares([]);
  if (kind === 'solved') {
    const clean = s.wrong === 0 && s.hints === 0;
    const streak = clean ? s.progress.streak + 1 : 0;
    const previous = s.progress.solved[puzzle.id];
    puzzleStore.set({
      progress: {
        solved: { ...s.progress.solved, [puzzle.id]: { attempts: s.wrong + 1, clean: clean || previous?.clean === true } },
        streak,
        bestStreak: Math.max(s.progress.bestStreak, streak),
        ...withSrs(s.progress, puzzle, clean),
      },
    });
  } else {
    puzzleStore.set({ progress: { ...s.progress, streak: 0, ...withSrs(s.progress, puzzle, false) } });
  }
  saveProgress();
  puzzleStore.set({ phase: kind, awaitingUser: false, checking: false, message: { kind: kind === 'solved' ? 'good' : 'info', text }, solutionSan: solutionSanOf(puzzle) });
}

function acceptStep(nodeId: string, gen: number): void {
  const s = puzzleStore.get();
  const puzzle = s.puzzle;
  if (puzzle === null || gen !== generation) return;
  const step = s.step + 1;
  if (step >= puzzle.solution.length) {
    puzzleStore.set({ step, cursorId: nodeId });
    finish('solved', s.wrong === 0 && s.hints === 0 ? 'Solved!' : 'Solved.');
    return;
  }
  puzzleStore.set({ step, cursorId: nodeId, awaitingUser: false, message: { kind: 'good', text: 'Correct! Keep going.' } });
  setTacticSquares([]);
  setTimeout(() => {
    if (gen !== generation) return;
    const reply = puzzle.solution[step];
    if (reply === undefined) return;
    let replyId: string | null = null;
    viaGame(() => {
      const r = playMove({ from: reply.slice(0, 2), to: reply.slice(2, 4), ...(reply.length === 5 ? { promotion: reply[4] } : {}) } as never);
      if (r.ok) replyId = r.nodeId;
    });
    if (replyId === null) return;
    puzzleStore.set({ step: step + 1, cursorId: replyId, awaitingUser: true, message: { kind: 'info', text: 'Your move.' } });
  }, REPLY_DELAY_MS);
}

function rejectMove(nodeId: string, gen: number, text: string): void {
  puzzleStore.set((s) => ({ wrong: s.wrong + 1, checking: false, message: { kind: 'bad', text } }));
  setTimeout(() => {
    if (gen !== generation) return;
    viaGame(() => deleteFromHere(nodeId));
    puzzleStore.set({ awaitingUser: true });
  }, RETRY_DELAY_MS);
}

function onUserMove(nodeId: string): void {
  const s = puzzleStore.get();
  const puzzle = s.puzzle;
  if (puzzle === null) return;
  const gen = generation;
  const node = getNode(gameStore.get().tree, nodeId);
  const expected = puzzle.solution[s.step];
  puzzleStore.set({ awaitingUser: false });
  setTacticSquares([]);

  if (node.uci === expected) {
    acceptStep(nodeId, gen);
    return;
  }
  // Lesson exercises that name one idea (exact) accept only the stored move; opening drills are plain book lines.
  if (puzzle.exact === true) {
    rejectMove(nodeId, gen, puzzle.book === true ? 'Not the book move for this line. Try again.' : puzzle.theme === 'custom' ? 'Not the move the author had in mind. Try again (use Hint if you are stuck).' : 'Not the idea this lesson teaches. Try again (use Hint if you are stuck).');
    return;
  }
  // Any checkmate is a valid answer to a mate puzzle.
  if (puzzle.theme.startsWith('mate') && new Chess(node.fen).isCheckmate()) {
    puzzleStore.set({ cursorId: nodeId });
    finish('solved', 'Checkmate! (a different mating move than the stored one)');
    return;
  }
  if (expected === undefined) return;
  puzzleStore.set({ checking: true, message: { kind: 'info', text: 'Not the stored move. Checking it with Stockfish…' } });
  const mover = puzzle.sideToMove;
  void checker({ fenBefore: getNode(gameStore.get().tree, s.cursorId ?? nodeId).fen, playedUci: node.uci, solutionUci: expected, mover }).then((ok) => {
    if (gen !== generation) return;
    if (ok === true) {
      puzzleStore.set({ cursorId: nodeId, checking: false });
      finish('solved', 'Solved! Not the stored move, but Stockfish confirms it is just as good.');
    } else if (ok === null) {
      rejectMove(nodeId, gen, 'The engine could not verify that move, so it was not counted. Try again.');
    } else {
      rejectMove(nodeId, gen, 'Not the best move. Try again.');
    }
  });
}

let subscribed = false;
/** Watches the game store for the solver's moves. Idempotent. */
export function initPuzzles(): void {
  if (subscribed) return;
  subscribed = true;
  gameStore.subscribe(() => {
    const s = puzzleStore.get();
    if (internal || s.phase !== 'solving' || s.cursorId === null) return;
    const g = gameStore.get();
    if (g.currentId === s.cursorId) return;
    if (!hasNode(g.tree, s.cursorId)) return;
    const node = getNode(g.tree, g.currentId);
    if (s.awaitingUser && !s.checking && node.parentId === s.cursorId) {
      onUserMove(node.id);
    } else if (!s.checking) {
      // Navigating away, or moving while it is not the solver's turn (e.g. via the opening book), is not allowed.
      viaGame(() => gameStore.set({ currentId: s.cursorId as string, redoStack: [] }));
    }
  });
}

export function hint(): void {
  const s = puzzleStore.get();
  const move = s.puzzle?.solution[s.step];
  if (s.phase !== 'solving' || move === undefined) return;
  const hints = Math.min(2, s.hints + 1);
  const from = move.slice(0, 2);
  const to = move.slice(2, 4);
  setTacticSquares(hints === 1 ? [from as never] : [from as never, to as never]);
  puzzleStore.set({ hints, message: { kind: 'info', text: hints === 1 ? 'Hint: this piece should move.' : 'Hint: move it to the highlighted square.' } });
}

export function revealSolution(): void {
  const s = puzzleStore.get();
  const puzzle = s.puzzle;
  if (puzzle === null || s.phase !== 'solving') return;
  generation += 1;
  // Drop any wrong attempt that is still on the board, then play the rest of the solution.
  viaGame(() => {
    const g = gameStore.get();
    if (s.cursorId !== null && hasNode(g.tree, s.cursorId)) gameStore.set({ currentId: s.cursorId, redoStack: [] });
    for (const uci of puzzle.solution.slice(s.step)) {
      playMove({ from: uci.slice(0, 2), to: uci.slice(2, 4), ...(uci.length === 5 ? { promotion: uci[4] } : {}) } as never);
    }
  });
  finish('revealed', 'Solution shown. This one does not count as solved.');
}

/** Practice session (e.g. recommended from a game): plays the given puzzles in order, then falls back to normal selection. */
let sessionQueue: Puzzle[] = [];
export function startPuzzleSession(puzzles: readonly Puzzle[]): void {
  const [first, ...rest] = puzzles;
  if (first === undefined) return;
  sessionQueue = rest;
  startPuzzle(first);
  puzzleStore.set({ sessionLeft: rest.length });
}

export function nextPuzzle(all: readonly Puzzle[]): boolean {
  const queued = sessionQueue.shift();
  if (queued !== undefined) {
    startPuzzle(queued);
    puzzleStore.set({ sessionLeft: sessionQueue.length });
    return true;
  }
  const s = puzzleStore.get();
  const next = pickNextPuzzle(all, s.progress, s.filter, s.puzzle?.id ?? null);
  if (next === null) return false;
  startPuzzle(next);
  return true;
}

export function setPuzzleFilter(filter: Partial<PuzzleFilter>): void {
  puzzleStore.set((s) => ({ filter: { ...s.filter, ...filter } }));
}

export function resetPuzzleProgress(): void {
  puzzleStore.set({ progress: sanitizeProgress(null) });
  saveProgress();
}

export const puzzleThemeLabel = (theme: keyof typeof THEME_LABEL) => THEME_LABEL[theme];
export { loadPuzzles };

export function resetPuzzleStoreForTests(): void {
  generation += 1;
  parked = null;
  internal = false;
  sessionQueue = [];
  checker = defaultChecker;
  puzzleStore.replace({ ...initial(), progress: sanitizeProgress(null) });
}

/** Board orientation: the puzzle's own while one is open, otherwise the saved setting. */
export function useOrientation(): 'white' | 'black' {
  const override = usePuzzle((s) => s.orientation);
  const playOverride = usePlay((s) => s.orientation);
  const saved = useStore(settingsStore, (s) => s.orientation);
  return override ?? playOverride ?? saved;
}

export function flipBoard(): void {
  const override = puzzleStore.get().orientation;
  if (override !== null) puzzleStore.set({ orientation: override === 'white' ? 'black' : 'white' });
  else if (flipPlayBoard()) return;
  else updateSettings({ orientation: settingsStore.get().orientation === 'white' ? 'black' : 'white' });
}
