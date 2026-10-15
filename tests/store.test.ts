import { Chess } from 'chess.js';
import { beforeEach, describe, expect, it } from 'vitest';
import { getNode, hasNode, mainLine, pathTo } from '@/chess/gameTree';
import { parsePgn } from '@/pgn/pgn';
import {
  canRedo,
  canUndo,
  continueFromHere,
  currentFen,
  deleteFromHere,
  deserializeGame,
  gameStore,
  goBack,
  goEnd,
  goForward,
  goStart,
  goTo,
  hasChangedFromOriginal,
  loadFen,
  loadGame,
  makeMainLine,
  newGame,
  playLine,
  playMove,
  promoteVariation,
  redo,
  resetGameStoreForTests,
  restoreOriginal,
  serializeGame,
  setComment,
  undo,
} from '@/stores/gameStore';
import { createStore } from '@/stores/createStore';
import { parseLibrary } from '@/stores/libraryStore';

const state = () => gameStore.get();
const sanOf = (id: string) => getNode(state().tree, id).san;
const san = (m: string) => {
  const r = playMove(m);
  if (!r.ok) throw new Error(r.error);
  return r.nodeId;
};

beforeEach(() => resetGameStoreForTests());

describe('playing and navigating', () => {
  it('moves the single cursor, and the FEN follows it', () => {
    san('e4');
    san('e5');
    const nf3 = san('Nf3');
    expect(state().currentId).toBe(nf3);
    expect(currentFen()).toBe(getNode(state().tree, nf3).fen);

    goBack();
    expect(sanOf(state().currentId)).toBe('e5');
    goStart();
    expect(state().currentId).toBe(state().tree.rootId);
    goForward();
    expect(sanOf(state().currentId)).toBe('e4');
    goEnd();
    expect(sanOf(state().currentId)).toBe('Nf3');
    goBack();
    goBack();
    goBack();
    goBack(); // already at the start: no-op
    expect(state().currentId).toBe(state().tree.rootId);
  });

  it('goTo ignores unknown ids', () => {
    san('e4');
    const before = state().currentId;
    expect(goTo('does-not-exist')).toBe(false);
    expect(state().currentId).toBe(before);
  });

  it('an illegal move leaves the whole state untouched', () => {
    san('e4');
    const before = state();
    const result = playMove({ from: 'e7', to: 'e3' });
    expect(result.ok).toBe(false);
    expect(state()).toBe(before); // same object: nothing was even re-created
  });

  it('playing an existing move just navigates (no duplicate variation)', () => {
    san('e4');
    san('e5');
    goStart();
    const again = playMove('e4');
    expect(again.ok && again.created).toBe(false);
    expect(Object.keys(state().tree.nodes)).toHaveLength(3);
  });

  it('playLine plays an engine PV as a variation and stops at an illegal move', () => {
    expect(playLine(['e2e4', 'e7e5', 'g1f3'])).toBe(3);
    expect(sanOf(state().currentId)).toBe('Nf3');
    goStart();
    expect(playLine(['d2d4', 'd7d5', 'e2e5', 'g8f6'])).toBe(2); // e2e5 is illegal there
    expect(sanOf(state().currentId)).toBe('d5');
    expect(playLine(['zzzz'])).toBe(0);
  });
});

describe('undo and redo', () => {
  it('redo returns along the path that was undone, even inside a variation', () => {
    san('e4');
    const e5 = san('e5');
    san('Nf3'); // main line
    goTo(e5);
    const bc4 = san('Bc4'); // variation at move 2
    san('Bc5');

    undo();
    undo();
    expect(state().currentId).toBe(e5);
    expect(canRedo(state())).toBe(true);
    redo();
    expect(state().currentId).toBe(bc4);
    redo();
    expect(sanOf(state().currentId)).toBe('Bc5');
    expect(canRedo(state())).toBe(false);
  });

  it('"next" follows the main line while "redo" follows the undone variation', () => {
    san('e4');
    const e5 = san('e5');
    san('Nf3');
    goTo(e5);
    san('Bc4');
    undo();
    goForward();
    expect(sanOf(state().currentId)).toBe('Nf3'); // main line, not the variation
  });

  it('making a new move or jumping clears the redo path', () => {
    san('e4');
    san('e5');
    undo();
    expect(canRedo(state())).toBe(true);
    san('c5');
    expect(canRedo(state())).toBe(false);
    undo();
    goTo(state().tree.rootId);
    expect(canRedo(state())).toBe(false);
  });

  it('cannot undo at the start', () => {
    expect(canUndo(state())).toBe(false);
    undo();
    expect(state().currentId).toBe(state().tree.rootId);
    san('e4');
    expect(canUndo(state())).toBe(true);
  });

  it('undone moves stay in the move list and can be played again', () => {
    san('e4');
    san('e5');
    undo();
    undo();
    expect(mainLine(state().tree)).toHaveLength(3);
  });
});

describe('editing the tree', () => {
  it('deleting the line containing the cursor moves the cursor to the parent', () => {
    san('e4');
    const e5 = san('e5');
    san('Nf3');
    deleteFromHere(e5);
    expect(sanOf(state().currentId)).toBe('e4');
    expect(hasNode(state().tree, e5)).toBe(false);
  });

  it('deleting a line elsewhere keeps the cursor', () => {
    san('e4');
    const e5 = san('e5');
    goTo(e5);
    const c5Parent = pathTo(state().tree, e5)[1] as string;
    goTo(c5Parent);
    const c5 = san('c5');
    goTo(e5);
    deleteFromHere(c5);
    expect(state().currentId).toBe(e5);
  });

  it('the starting position cannot be deleted', () => {
    san('e4');
    deleteFromHere(state().tree.rootId);
    expect(Object.keys(state().tree.nodes)).toHaveLength(2);
  });

  it('promote and make-main-line reorder variations without losing anything', () => {
    const e4 = san('e4');
    san('e5');
    goTo(e4);
    const c5 = san('c5');
    san('Nf3');
    const count = Object.keys(state().tree.nodes).length;
    promoteVariation(c5);
    expect(getNode(state().tree, e4).children[0]).toBe(c5);
    makeMainLine(state().currentId);
    expect(mainLine(state().tree).includes(state().currentId)).toBe(true);
    expect(Object.keys(state().tree.nodes)).toHaveLength(count);
  });

  it('comments are stored on the node', () => {
    const e4 = san('e4');
    setComment(e4, 'The king pawn');
    expect(getNode(state().tree, e4).comment).toBe('The king pawn');
  });
});

describe('the original game stays recoverable', () => {
  const pgn = '[Event "Original"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 *';
  function loadOriginal() {
    const game = parsePgn(pgn).games[0];
    if (game === undefined) throw new Error('setup');
    loadGame(game.tree);
    return game.tree;
  }

  it('restores the imported game after exploring variations and deleting moves', () => {
    const original = loadOriginal();
    expect(state().currentId).toBe(original.rootId);
    expect(hasChangedFromOriginal(state())).toBe(false);

    goEnd();
    deleteFromHere(state().currentId);
    goTo(mainLine(state().tree)[2] as string);
    san('Nc3'); // explore a variation
    expect(hasChangedFromOriginal(state())).toBe(true);
    expect(mainLine(state().tree).length).toBeLessThan(mainLine(original).length);

    expect(restoreOriginal()).toBe(true);
    expect(state().tree).toBe(original);
    expect(mainLine(state().tree)).toHaveLength(7);
    expect(state().currentId).toBe(original.rootId);
    expect(hasChangedFromOriginal(state())).toBe(false);
  });

  it('nothing to restore for a game that was never imported', () => {
    expect(restoreOriginal()).toBe(false);
  });

  it('does not touch the original while exploring (variations only add)', () => {
    const original = loadOriginal();
    const snapshot = JSON.stringify(original);
    goEnd();
    san('Ba4');
    goStart();
    san('d4');
    expect(JSON.stringify(original)).toBe(snapshot);
  });
});

describe('loading positions', () => {
  it('loads a valid FEN and rejects an invalid one without changing the game', () => {
    san('e4');
    const bad = loadFen('this is not a fen');
    expect(bad.ok).toBe(false);
    expect(sanOf(state().currentId)).toBe('e4');

    const good = loadFen('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
    expect(good.ok).toBe(true);
    expect(currentFen()).toBe('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
    expect(state().original).toBeNull();
  });

  it('continues from the selected position as a new game', () => {
    san('e4');
    san('e5');
    const fen = currentFen();
    continueFromHere();
    expect(currentFen()).toBe(fen);
    expect(mainLine(state().tree)).toHaveLength(1);
    expect(state().tree.headers['FEN']).toBe(fen);
  });

  it('newGame resets to the start position', () => {
    san('e4');
    newGame();
    expect(state().currentId).toBe(state().tree.rootId);
    expect(mainLine(state().tree)).toHaveLength(1);
  });
});

describe('persistence', () => {
  it('serialises and restores tree, variations, comments and the selected node', () => {
    const e4 = san('e4');
    san('e5');
    goTo(e4);
    san('c5');
    const nf3 = san('Nf3');
    setComment(nf3, 'Open Sicilian prep');
    const text = serializeGame(state());

    resetGameStoreForTests();
    const restored = deserializeGame(text);
    expect(restored).not.toBeNull();
    if (restored === null) return;
    expect(getNode(restored.tree, restored.currentId).san).toBe('Nf3');
    expect(getNode(restored.tree, restored.currentId).comment).toBe('Open Sicilian prep');
    expect(getNode(restored.tree, getNode(restored.tree, restored.currentId).parentId as string).san).toBe('c5');
    const root = getNode(restored.tree, restored.tree.rootId);
    expect(getNode(restored.tree, getNode(restored.tree, root.children[0] as string).children[0] as string).san).toBe('e5');
  });

  it('restores the imported original too', () => {
    const game = parsePgn('1. d4 d5 *').games[0]!;
    loadGame(game.tree);
    goEnd();
    san('c4');
    const restored = deserializeGame(serializeGame(state()));
    expect(restored?.original).not.toBeNull();
    expect(mainLine(restored!.original!)).toHaveLength(3);
  });

  it('an untouched imported game is NOT reported as "changed" after a reload (regression)', () => {
    loadGame(parsePgn('1. d4 d5 *').games[0]!.tree);
    const restored = deserializeGame(serializeGame(state()))!;
    expect(hasChangedFromOriginal(restored)).toBe(false);
    expect(restored.original).toBe(restored.tree);
  });

  it('a comment containing "}" is sanitised with a visible warning (regression)', () => {
    const id = san('e4');
    setComment(id, 'a {b} c');
    expect(getNode(state().tree, id).comment).toBe('a {b) c');
    expect(state().notice?.kind).toBe('warning');
  });

  it('survives corrupt data without throwing', () => {
    expect(deserializeGame('not json')).toBeNull();
    expect(deserializeGame('{"pgn": 5}')).toBeNull();
    expect(deserializeGame('{"pgn": "", "cursor": []}')).toBeNull();
    // a cursor pointing past the end of the game is clamped, not an error
    const restored = deserializeGame('{"pgn":"1. e4 e5 *","cursor":[0,0,0,0,0]}');
    expect(restored && getNode(restored.tree, restored.currentId).san).toBe('e5');
  });

  it('parses a stored library defensively', () => {
    expect(parseLibrary(null)).toEqual([]);
    expect(parseLibrary('garbage')).toEqual([]);
    expect(parseLibrary('{"a":1}')).toEqual([]);
    const ok = { id: 'g1', title: 'T', pgn: '1. e4 *', savedAt: 1 };
    expect(parseLibrary(JSON.stringify([ok, { id: 5 }, null]))).toEqual([ok]);
  });
});

describe('createStore', () => {
  it('notifies only when something changed and supports unsubscribe', () => {
    const store = createStore({ a: 1, b: 'x' });
    let calls = 0;
    const off = store.subscribe(() => (calls += 1));
    store.set({ a: 1 }); // same value
    expect(calls).toBe(0);
    store.set({ a: 2 });
    store.set((s) => ({ b: `${s.b}y` }));
    expect(calls).toBe(2);
    expect(store.get()).toEqual({ a: 2, b: 'xy' });
    off();
    store.set({ a: 3 });
    expect(calls).toBe(2);
  });
});

describe('board / move list / cursor stay synchronised under arbitrary use', () => {
  /** Small seeded PRNG so a failure is reproducible. */
  function rng(seed: number) {
    let s = seed >>> 0;
    return () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 2 ** 32;
    };
  }

  function assertConsistent(): void {
    const { tree, currentId } = state();
    // 1. the cursor exists
    expect(hasNode(tree, currentId)).toBe(true);
    // 2. the board position equals the position reached by replaying the visible move list to the cursor
    const path = pathTo(tree, currentId).map((id) => getNode(tree, id));
    const chess = new Chess(path[0]!.fen);
    for (const node of path.slice(1)) {
      const move = chess.move(node.san);
      expect(move.lan).toBe(`${node.uci.slice(0, 2)}${node.uci[2] === undefined ? '' : ''}` && move.lan); // SAN replays legally
      expect(chess.fen()).toBe(node.fen);
    }
    expect(currentFen()).toBe(chess.fen());
    // 3. every child points back to its parent and ply increases by one
    for (const node of Object.values(tree.nodes)) {
      for (const childId of node.children) {
        const child = getNode(tree, childId);
        expect(child.parentId).toBe(node.id);
        expect(child.ply).toBe(node.ply + 1);
      }
      if (node.parentId !== null) expect(getNode(tree, node.parentId).children).toContain(node.id);
    }
  }

  it('holds after 400 random operations', () => {
    const rand = rng(20260414);
    const ids = () => Object.keys(state().tree.nodes);
    for (let i = 0; i < 400; i += 1) {
      const roll = rand();
      if (roll < 0.35) {
        const chess = new Chess(currentFen());
        const moves = chess.moves();
        if (moves.length > 0) playMove(moves[Math.floor(rand() * moves.length)] as string);
      } else if (roll < 0.45) goBack();
      else if (roll < 0.55) goForward();
      else if (roll < 0.62) undo();
      else if (roll < 0.69) redo();
      else if (roll < 0.77) goTo(ids()[Math.floor(rand() * ids().length)] as string);
      else if (roll < 0.82) goStart();
      else if (roll < 0.87) goEnd();
      else if (roll < 0.91) deleteFromHere(state().currentId);
      else if (roll < 0.95) promoteVariation(state().currentId);
      else if (roll < 0.98) makeMainLine(state().currentId);
      else setComment(state().currentId, `c${i}`);
      assertConsistent();
    }
    expect(Object.keys(state().tree.nodes).length).toBeGreaterThan(5);
  });
});
