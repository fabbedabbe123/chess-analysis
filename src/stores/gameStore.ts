import { storageGet, storageSet } from '@/utils/storage';
import { validateAndNormalizeFen, START_FEN } from '@/chess/fen';
import {
  addMove,
  createTree,
  deleteNode as deleteTreeNode,
  getNode,
  hasNode,
  lineEnd,
  makeMainLine as makeMainLineInTree,
  pathTo,
  promoteVariation as promoteVariationInTree,
  setComment as setTreeComment,
  setHeaders,
  setShapes as setTreeShapes,
  toggleNag as toggleTreeNag,
  treeFromNode,
} from '@/chess/gameTree';
import { exportPgn, parsePgn } from '@/pgn/pgn';
import type { GameTree, MoveInput, PgnHeaders, Shape } from '@/types/game';
import { createStore, useStore } from './createStore';

export type NoticeKind = 'error' | 'warning' | 'info';

export interface Notice {
  id: number;
  kind: NoticeKind;
  text: string;
}

export interface GameState {
  tree: GameTree;
  /** The ONE selected position. Board, move list, eval bar and engine all derive from this id. */
  currentId: string;
  /** Where "Redo" returns to after "Undo" (nodes we stepped back from, most recent last). */
  redoStack: string[];
  /** Snapshot of the game as it was loaded, so exploring variations never loses it. */
  original: GameTree | null;
  notice: Notice | null;
}

function freshState(tree: GameTree = createTree()): GameState {
  return { tree, currentId: tree.rootId, redoStack: [], original: null, notice: null };
}

export const gameStore = createStore<GameState>(freshState());

let noticeCounter = 0;
export function notify(kind: NoticeKind, text: string): void {
  noticeCounter += 1;
  gameStore.set({ notice: { id: noticeCounter, kind, text } });
}
export function dismissNotice(): void {
  gameStore.set({ notice: null });
}

// ----------------------------------------------------------------- selectors

export function useGame<S>(selector: (state: GameState) => S): S {
  return useStore(gameStore, selector);
}

export function currentFen(state: GameState = gameStore.get()): string {
  return getNode(state.tree, state.currentId).fen;
}

// ---------------------------------------------------------------- navigation

/** Jump to any node (clicking the move list). Clears the redo path. */
export function goTo(id: string): boolean {
  const { tree } = gameStore.get();
  if (!hasNode(tree, id)) return false;
  gameStore.set({ currentId: id, redoStack: [] });
  return true;
}

export function goStart(): void {
  goTo(gameStore.get().tree.rootId);
}

export function goEnd(): void {
  const { tree, currentId } = gameStore.get();
  goTo(lineEnd(tree, currentId));
}

export function goBack(): void {
  const { tree, currentId } = gameStore.get();
  const parentId = getNode(tree, currentId).parentId;
  if (parentId !== null) gameStore.set({ currentId: parentId, redoStack: [] });
}

/** Next move: follow the main continuation (first child) of the current position. */
export function goForward(): void {
  const { tree, currentId } = gameStore.get();
  const next = getNode(tree, currentId).children[0];
  if (next !== undefined) gameStore.set({ currentId: next, redoStack: [] });
}

/** Undo: step back one move but remember where we were. */
export function undo(): void {
  const { tree, currentId, redoStack } = gameStore.get();
  const parentId = getNode(tree, currentId).parentId;
  if (parentId === null) return;
  gameStore.set({ currentId: parentId, redoStack: [...redoStack, currentId] });
}

/** Redo: return along the path we undid (works inside variations, unlike `goForward`). */
export function redo(): void {
  const { tree, currentId, redoStack } = gameStore.get();
  const target = redoStack[redoStack.length - 1];
  if (target === undefined || !hasNode(tree, target) || getNode(tree, target).parentId !== currentId) {
    gameStore.set({ redoStack: [] });
    return;
  }
  gameStore.set({ currentId: target, redoStack: redoStack.slice(0, -1) });
}

export function canUndo(state: GameState): boolean {
  return getNode(state.tree, state.currentId).parentId !== null;
}

export function canRedo(state: GameState): boolean {
  const target = state.redoStack[state.redoStack.length - 1];
  return target !== undefined && hasNode(state.tree, target) && getNode(state.tree, target).parentId === state.currentId;
}

// ------------------------------------------------------------------- playing

export type PlayResult = { ok: true; nodeId: string; created: boolean } | { ok: false; error: string };

/** Play a move from the current position. Illegal moves leave the game untouched. */
export function playMove(input: MoveInput | string): PlayResult {
  const { tree, currentId } = gameStore.get();
  const result = addMove(tree, currentId, input);
  if (!result.ok) return result;
  gameStore.set({ tree: result.tree, currentId: result.nodeId, redoStack: [] });
  return { ok: true, nodeId: result.nodeId, created: result.created };
}

/**
 * Play a sequence of UCI moves (e.g. an engine principal variation) from the current position.
 * Stops at the first illegal move. Returns how many moves were played.
 */
export function playLine(uciMoves: readonly string[]): number {
  let played = 0;
  for (const uci of uciMoves) {
    if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) break;
    const input: MoveInput = {
      from: uci.slice(0, 2) as MoveInput['from'],
      to: uci.slice(2, 4) as MoveInput['to'],
      ...(uci.length === 5 ? { promotion: uci.slice(4) as NonNullable<MoveInput['promotion']> } : {}),
    };
    const result = playMove(input);
    if (!result.ok) break;
    played += 1;
  }
  return played;
}

// ------------------------------------------------------------------- editing

export function deleteFromHere(id: string): void {
  const state = gameStore.get();
  if (id === state.tree.rootId) return;
  const cursorInside = pathTo(state.tree, state.currentId).includes(id);
  const { tree, parentId } = deleteTreeNode(state.tree, id);
  gameStore.set({ tree, currentId: cursorInside ? parentId : state.currentId, redoStack: [] });
}

export function promoteVariation(id: string): void {
  const { tree } = gameStore.get();
  gameStore.set({ tree: promoteVariationInTree(tree, id) });
}

export function makeMainLine(id: string): void {
  const { tree } = gameStore.get();
  gameStore.set({ tree: makeMainLineInTree(tree, id) });
}

export function setComment(id: string, comment: string): void {
  const { tree } = gameStore.get();
  // PGN has no escape for "}" inside a comment; tell the user instead of changing text silently on export.
  const clean = comment.replace(/\}/g, ')');
  if (clean !== comment) notify('warning', 'PGN comments cannot contain "}" - it was replaced with ")".');
  gameStore.set({ tree: setTreeComment(tree, id, clean) });
}

export function toggleNag(id: string, nag: number): void {
  const { tree } = gameStore.get();
  gameStore.set({ tree: toggleTreeNag(tree, id, nag) });
}

export function setShapes(id: string, shapes: Shape[]): void {
  const { tree } = gameStore.get();
  gameStore.set({ tree: setTreeShapes(tree, id, shapes) });
}

export function updateHeaders(headers: PgnHeaders): void {
  const { tree } = gameStore.get();
  gameStore.set({ tree: setHeaders(tree, headers) });
}

// ------------------------------------------------------------------- loading

/** Load a parsed game; it is remembered as the "original" so it can be restored later. */
export function loadGame(tree: GameTree): void {
  gameStore.set({ tree, currentId: tree.rootId, redoStack: [], original: tree });
}

export function restoreOriginal(): boolean {
  const { original } = gameStore.get();
  if (original === null) return false;
  gameStore.set({ tree: original, currentId: original.rootId, redoStack: [] });
  return true;
}

export function hasChangedFromOriginal(state: GameState): boolean {
  return state.original !== null && state.original !== state.tree;
}

export function newGame(): void {
  gameStore.set({ ...freshState(), notice: gameStore.get().notice });
}

export function loadFen(input: string): { ok: true } | { ok: false; error: string } {
  const checked = validateAndNormalizeFen(input);
  if (!checked.ok) return checked;
  const tree = createTree(checked.fen === START_FEN ? START_FEN : checked.fen);
  gameStore.set({ tree, currentId: tree.rootId, redoStack: [], original: null });
  return { ok: true };
}

/** Start a fresh game from the currently selected position. */
export function continueFromHere(): void {
  const { tree, currentId } = gameStore.get();
  const next = treeFromNode(tree, currentId);
  gameStore.set({ tree: next, currentId: next.rootId, redoStack: [], original: null });
}

export function currentPgn(): string {
  return exportPgn(gameStore.get().tree);
}

// --------------------------------------------------------------- persistence

const GAME_KEY = 'chess-analysis:game:v1';

interface SavedGame {
  pgn: string;
  /** Child indexes from the root to the selected node. */
  cursor: number[];
  originalPgn: string | null;
}

function cursorOf(tree: GameTree, id: string): number[] {
  const path = pathTo(tree, id);
  const indexes: number[] = [];
  for (let i = 1; i < path.length; i += 1) {
    indexes.push(getNode(tree, path[i - 1] as string).children.indexOf(path[i] as string));
  }
  return indexes;
}

function followCursor(tree: GameTree, cursor: readonly number[]): string {
  let id = tree.rootId;
  for (const index of cursor) {
    const next = getNode(tree, id).children[index];
    if (next === undefined) break;
    id = next;
  }
  return id;
}

export function serializeGame(state: GameState): string {
  const saved: SavedGame = {
    pgn: exportPgn(state.tree),
    cursor: cursorOf(state.tree, state.currentId),
    originalPgn: state.original === null ? null : exportPgn(state.original),
  };
  return JSON.stringify(saved);
}

export function deserializeGame(text: string): GameState | null {
  try {
    const saved = JSON.parse(text) as Partial<SavedGame>;
    if (typeof saved.pgn !== 'string') return null;
    const parsed = parsePgn(saved.pgn).games[0];
    if (parsed === undefined) return null;
    const cursor = Array.isArray(saved.cursor) ? saved.cursor.filter((n): n is number => typeof n === 'number') : [];
    let original: GameTree | null = null;
    if (typeof saved.originalPgn === 'string' && saved.originalPgn === saved.pgn) original = parsed.tree; // untouched since import
    else if (typeof saved.originalPgn === 'string') original = parsePgn(saved.originalPgn).games[0]?.tree ?? null;
    return { tree: parsed.tree, currentId: followCursor(parsed.tree, cursor), redoStack: [], original, notice: null };
  } catch {
    return null;
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let persistenceSuspended = false;
let suspensions = 0;

function saveNow(): void {
  try {
    storageSet(GAME_KEY, serializeGame(gameStore.get()));
  } catch {
    // Ignore quota/privacy-mode errors; the game just won't survive a refresh.
  }
}

/**
 * Puzzle mode borrows the board; while suspended the user's real game on disk is left untouched
 * (a reload during a puzzle brings back the game, not the puzzle).
 */
export function setPersistenceSuspended(suspended: boolean): void {
  // Reference-counted: puzzles and play mode can both hold the board; saving resumes when the last one lets go.
  suspensions = Math.max(0, suspensions + (suspended ? 1 : -1));
  persistenceSuspended = suspensions > 0;
  if (persistenceSuspended) {
    if (saveTimer !== null) clearTimeout(saveTimer);
    saveTimer = null;
  } else if (persistenceStarted) saveNow();
}
let persistenceStarted = false;

/** Restore the last session (if any) and keep saving changes. Call once at startup in the browser. */
export function startGamePersistence(): void {
  if (persistenceStarted) return;
  persistenceStarted = true;
  try {
    const text = storageGet(GAME_KEY);
    if (text !== null) {
      const restored = deserializeGame(text);
      if (restored !== null) gameStore.replace(restored);
    }
  } catch {
    // Corrupt or inaccessible storage: start with a fresh game.
  }
  let lastTree = gameStore.get().tree;
  let lastCursor = gameStore.get().currentId;
  gameStore.subscribe(() => {
    const { tree, currentId } = gameStore.get();
    if (tree === lastTree && currentId === lastCursor) return;
    lastTree = tree;
    lastCursor = currentId;
    if (persistenceSuspended) return;
    if (saveTimer !== null) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (!persistenceSuspended) saveNow();
    }, 400);
  });
}

/** Test helper. */
export function resetGameStoreForTests(): void {
  gameStore.replace(freshState());
}
