import { Chess } from 'chess.js';
import { describe, expect, it } from 'vitest';
import { START_FEN, validateAndNormalizeFen } from '@/chess/fen';
import {
  addMove,
  createTree,
  deleteAfter,
  deleteNode,
  describeStatus,
  getNode,
  isLegalMove,
  isOnMainLine,
  legalTargets,
  lineEnd,
  mainLine,
  makeMainLine,
  needsPromotion,
  pathTo,
  promoteVariation,
  setComment,
  statusAt,
  subTreeFrom,
  toggleNag,
  treeFromNode,
} from '@/chess/gameTree';
import type { GameTree } from '@/types/game';

/** Play SAN moves in sequence from a node; returns the final tree and node id. */
function play(tree: GameTree, from: string, ...sans: string[]): { tree: GameTree; id: string } {
  let current = tree;
  let id = from;
  for (const san of sans) {
    const result = addMove(current, id, san);
    if (!result.ok) throw new Error(`Could not play ${san}: ${result.error}`);
    current = result.tree;
    id = result.nodeId;
  }
  return { tree: current, id };
}

describe('legal and illegal moves', () => {
  it('accepts a legal move and records SAN, UCI and the resulting FEN', () => {
    const tree = createTree();
    const result = addMove(tree, tree.rootId, { from: 'e2', to: 'e4' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const node = getNode(result.tree, result.nodeId);
    expect(node.san).toBe('e4');
    expect(node.uci).toBe('e2e4');
    expect(node.ply).toBe(1);
    expect(node.color).toBe('w');
    expect(node.fen).toBe('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1');
  });

  it('rejects illegal moves and leaves the tree untouched (same reference)', () => {
    const tree = createTree();
    for (const bad of [
      { from: 'e2', to: 'e5' }, // pawn cannot jump three squares
      { from: 'e7', to: 'e5' }, // wrong side to move
      { from: 'a1', to: 'a3' }, // rook blocked by its own pawn
      { from: 'e1', to: 'e2' }, // king onto its own pawn
    ] as const) {
      const result = addMove(tree, tree.rootId, bad);
      expect(result.ok).toBe(false);
    }
    expect(addMove(tree, tree.rootId, 'Nf6').ok).toBe(false);
    expect(Object.keys(tree.nodes)).toHaveLength(1);
    expect(tree.nextId).toBe(1);
  });

  it('refuses a move that leaves the own king in check', () => {
    // White king e1 pinned rook e2 against black rook e8
    const tree = createTree('4r1k1/8/8/8/8/8/4R3/4K3 w - - 0 1');
    expect(isLegalMove(tree, tree.rootId, { from: 'e2', to: 'a2' })).toBe(false);
    expect(isLegalMove(tree, tree.rootId, { from: 'e2', to: 'e5' })).toBe(true);
  });

  it('reuses an existing child instead of creating duplicate variations', () => {
    const first = play(createTree(), 'n0', 'e4');
    const again = addMove(first.tree, 'n0', 'e4');
    expect(again.ok && again.created).toBe(false);
    expect(again.ok && again.nodeId).toBe(first.id);
    expect(getNode(first.tree, 'n0').children).toHaveLength(1);
  });

  it('lists legal targets for the board', () => {
    expect(legalTargets(START_FEN, 'e2').sort()).toEqual(['e3', 'e4']);
    expect(legalTargets(START_FEN, 'g1').sort()).toEqual(['f3', 'h3']);
    expect(legalTargets(START_FEN, 'e5')).toEqual([]);
  });
});

describe('game end states', () => {
  it("detects checkmate (fool's mate) and names the winner", () => {
    const { tree, id } = play(createTree(), 'n0', 'f3', 'e5', 'g4', 'Qh4#');
    expect(getNode(tree, id).san).toBe('Qh4#');
    const status = statusAt(tree, id);
    expect(status).toEqual({ kind: 'checkmate', winner: 'b' });
    expect(describeStatus(status)).toBe('Checkmate - Black wins');
  });

  it('detects stalemate', () => {
    const tree = createTree('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
    expect(statusAt(tree, tree.rootId)).toEqual({ kind: 'stalemate' });
  });

  it('detects insufficient material and the fifty-move rule', () => {
    const kk = createTree('8/8/8/4k3/8/3K4/8/8 w - - 0 1');
    expect(statusAt(kk, kk.rootId)).toEqual({ kind: 'draw', reason: 'insufficient-material' });
    const fifty = createTree('8/8/8/4k3/8/3K4/R7/8 w - - 100 80');
    expect(statusAt(fifty, fifty.rootId)).toEqual({ kind: 'draw', reason: 'fifty-move' });
  });

  it('detects threefold repetition from the path of positions (not just the FEN)', () => {
    const { tree, id } = play(createTree(), 'n0', 'Nf3', 'Nf6', 'Ng1', 'Ng8', 'Nf3', 'Nf6', 'Ng1', 'Ng8');
    expect(statusAt(tree, id)).toEqual({ kind: 'draw', reason: 'threefold-repetition' });
    // after only one cycle the start position has occurred twice: still ongoing
    const early = pathTo(tree, id)[4] as string;
    expect(statusAt(tree, early).kind).toBe('ongoing');
  });

  it('reports check as ongoing with inCheck', () => {
    const { tree, id } = play(createTree(), 'n0', 'e4', 'f5', 'Qh5+');
    expect(statusAt(tree, id)).toEqual({ kind: 'ongoing', inCheck: true });
  });
});

describe('special moves', () => {
  const castlingFen = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1';

  it('castles kingside and queenside (UCI uses the king move)', () => {
    const tree = createTree(castlingFen);
    const king = addMove(tree, tree.rootId, 'O-O');
    expect(king.ok).toBe(true);
    if (king.ok) {
      const node = getNode(king.tree, king.nodeId);
      expect(node.uci).toBe('e1g1');
      expect(node.fen.startsWith('r3k2r/8/8/8/8/8/8/R4RK1 b kq')).toBe(true);
    }
    const queen = addMove(tree, tree.rootId, { from: 'e1', to: 'c1' });
    expect(queen.ok && getNode(queen.tree, queen.nodeId).san).toBe('O-O-O');
  });

  it('forbids castling through an attacked square', () => {
    const tree = createTree('r3k2r/8/8/8/8/8/5r2/R3K2R w KQkq - 0 1');
    expect(addMove(tree, tree.rootId, 'O-O').ok).toBe(false);
    expect(addMove(tree, tree.rootId, 'O-O-O').ok).toBe(true);
  });

  it('forbids castling after the king has moved', () => {
    const { tree, id } = play(createTree(castlingFen), 'n0', 'Kd1', 'Kd8', 'Ke1', 'Ke8');
    expect(addMove(tree, id, 'O-O').ok).toBe(false);
  });

  it('plays en passant and removes the captured pawn', () => {
    const { tree, id } = play(createTree(), 'n0', 'e4', 'a6', 'e5', 'd5');
    const ep = addMove(tree, id, { from: 'e5', to: 'd6' });
    expect(ep.ok).toBe(true);
    if (!ep.ok) return;
    const node = getNode(ep.tree, ep.nodeId);
    expect(node.san).toBe('exd6');
    const board = new Chess(node.fen);
    expect(board.get('d5')).toBeUndefined();
    expect(board.get('d6')).toEqual({ type: 'p', color: 'w' });
  });

  it('only allows en passant immediately after the double push', () => {
    const { tree, id } = play(createTree(), 'n0', 'e4', 'a6', 'e5', 'd5', 'Nf3', 'a5');
    expect(addMove(tree, id, { from: 'e5', to: 'd6' }).ok).toBe(false);
  });

  it('requires a promotion piece and supports under-promotion', () => {
    const tree = createTree('8/P6k/8/8/8/8/7K/8 w - - 0 1');
    expect(needsPromotion(getNode(tree, tree.rootId).fen, 'a7', 'a8')).toBe(true);
    expect(needsPromotion(START_FEN, 'e2', 'e4')).toBe(false);
    expect(addMove(tree, tree.rootId, { from: 'a7', to: 'a8' }).ok).toBe(false);

    const queen = addMove(tree, tree.rootId, { from: 'a7', to: 'a8', promotion: 'q' });
    expect(queen.ok && getNode(queen.tree, queen.nodeId).san).toBe('a8=Q');
    expect(queen.ok && getNode(queen.tree, queen.nodeId).uci).toBe('a7a8q');

    const knight = addMove(tree, tree.rootId, { from: 'a7', to: 'a8', promotion: 'n' });
    expect(knight.ok && getNode(knight.tree, knight.nodeId).san).toBe('a8=N');
  });
});

describe('FEN parsing and serialisation', () => {
  it('round-trips the start position', () => {
    const result = validateAndNormalizeFen(START_FEN);
    expect(result).toEqual({ ok: true, fen: START_FEN });
  });

  it('accepts a 4-field FEN and adds default counters', () => {
    const result = validateAndNormalizeFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -');
    expect(result).toEqual({ ok: true, fen: START_FEN });
  });

  it('trims and collapses whitespace', () => {
    const result = validateAndNormalizeFen(`  ${START_FEN.replace(/ /g, '   ')}  `);
    expect(result).toEqual({ ok: true, fen: START_FEN });
  });

  it('keeps side to move, castling rights and move counters', () => {
    const fen = 'r3k2r/8/8/8/8/8/8/R3K2R b Kq - 12 34';
    const result = validateAndNormalizeFen(fen);
    expect(result).toEqual({ ok: true, fen });
  });

  it('keeps a legal en passant square and drops an unusable one', () => {
    const legal = validateAndNormalizeFen('rnbqkbnr/ppp1pppp/8/3pP3/8/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 3');
    expect(legal.ok && legal.fen).toContain(' d6 ');
    const unusable = validateAndNormalizeFen('rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2');
    expect(unusable.ok && unusable.fen).toBe('rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2');
  });

  it.each([
    ['', 'empty'],
    ['hello world', 'garbage'],
    ['rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0', 'five fields'],
    ['rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBN w KQkq - 0 1', 'short rank'],
    ['rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR x KQkq - 0 1', 'bad side'],
    ['4k3/8/8/8/8/8/8/8 w - - 0 1', 'missing white king'],
    ['4k3/4k3/8/8/8/8/8/4K3 w - - 0 1', 'two black kings'],
    ['4k3/8/8/8/8/8/4R3/4K3 w - - 0 1', 'side not to move is in check'],
  ])('rejects invalid FEN: %s (%s)', (fen) => {
    const result = validateAndNormalizeFen(fen);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.length).toBeGreaterThan(0);
  });
});

describe('navigation and variations', () => {
  function sample() {
    // 1. e4 e5 2. Nf3, plus variation 1... c5 2. Nc3 at e4, and 2. Bc4 at e5
    const main = play(createTree(), 'n0', 'e4', 'e5', 'Nf3');
    const e4 = pathTo(main.tree, main.id)[1] as string;
    const e5 = pathTo(main.tree, main.id)[2] as string;
    const c5 = play(main.tree, e4, 'c5');
    const bc4 = play(c5.tree, e5, 'Bc4');
    return { tree: bc4.tree, e4, e5, nf3: main.id, c5: c5.id, bc4: bc4.id };
  }

  it('keeps the first continuation as the main line and others as variations', () => {
    const { tree, e4, e5, nf3, c5, bc4 } = sample();
    expect(getNode(tree, e4).children[0]).toBe(e5);
    expect(getNode(tree, e4).children).toEqual([e5, c5]);
    expect(getNode(tree, e5).children).toEqual([nf3, bc4]);
    expect(mainLine(tree)).toEqual(['n0', e4, e5, nf3]);
    expect(isOnMainLine(tree, nf3)).toBe(true);
    expect(isOnMainLine(tree, c5)).toBe(false);
    expect(isOnMainLine(tree, bc4)).toBe(false);
  });

  it('computes paths and line ends', () => {
    const { tree, e4, e5, bc4, nf3 } = sample();
    expect(pathTo(tree, bc4)).toEqual(['n0', e4, e5, bc4]);
    expect(lineEnd(tree, e4)).toBe(nf3);
    expect(lineEnd(tree, bc4)).toBe(bc4);
  });

  it('promotes a variation one level (swap with the previous sibling)', () => {
    const { tree, e4, e5, bc4, nf3 } = sample();
    const promoted = promoteVariation(tree, bc4);
    expect(getNode(promoted, e5).children).toEqual([bc4, nf3]);
    expect(isOnMainLine(promoted, bc4)).toBe(true);
    // nothing to promote on the main line
    expect(promoteVariation(promoted, bc4)).toBe(promoted);
    expect(getNode(promoted, e4).children[0]).toBe(e5);
  });

  it('makes a deep variation the main line at every fork', () => {
    const { tree, e4, c5 } = sample();
    const deep = play(tree, c5, 'Nc3', 'Nc6');
    const result = makeMainLine(deep.tree, deep.id);
    expect(getNode(result, e4).children[0]).toBe(c5);
    expect(mainLine(result)).toEqual(pathTo(result, deep.id));
    // the original line is not lost, only demoted
    expect(Object.keys(result.nodes)).toHaveLength(Object.keys(deep.tree.nodes).length);
  });

  it('deletes a node together with everything after it', () => {
    const { tree, e4, e5, nf3 } = sample();
    const { tree: after, parentId } = deleteNode(tree, e5);
    expect(parentId).toBe(e4);
    expect(after.nodes[e5]).toBeUndefined();
    expect(after.nodes[nf3]).toBeUndefined();
    expect(getNode(after, e4).children).toHaveLength(1); // only the c5 variation remains
    expect(() => deleteNode(tree, tree.rootId)).toThrow();
  });

  it('truncates a line with deleteAfter', () => {
    const { tree, e5 } = sample();
    const truncated = deleteAfter(tree, e5);
    expect(getNode(truncated, e5).children).toEqual([]);
  });

  it('does not mutate the previous tree (immutability)', () => {
    const { tree, e4, c5 } = sample();
    const before = JSON.stringify(tree);
    promoteVariation(tree, c5);
    setComment(tree, e4, 'x');
    toggleNag(tree, e4, 1);
    deleteNode(tree, c5);
    expect(JSON.stringify(tree)).toBe(before);
  });

  it('stores comments and NAGs and toggles NAGs off again', () => {
    const { tree, e4 } = sample();
    const commented = setComment(tree, e4, 'King pawn');
    expect(getNode(commented, e4).comment).toBe('King pawn');
    const nag = toggleNag(commented, e4, 1);
    expect(getNode(nag, e4).nags).toEqual([1]);
    expect(getNode(toggleNag(nag, e4, 1), e4).nags).toEqual([]);
  });

  it('continues from any position as a new game', () => {
    const { tree, e5 } = sample();
    const fresh = treeFromNode(tree, e5);
    expect(getNode(fresh, fresh.rootId).fen).toBe(getNode(tree, e5).fen);
    expect(fresh.headers['SetUp']).toBe('1');
    expect(fresh.headers['FEN']).toBe(getNode(tree, e5).fen);
    expect(mainLine(fresh)).toEqual([fresh.rootId]);
  });

  it('copies a sub-tree with variations and annotations', () => {
    const { tree, e4, c5 } = sample();
    const annotated = setComment(toggleNag(tree, c5, 2), c5, 'Sicilian');
    const sub = subTreeFrom(annotated, e4);
    expect(getNode(sub, sub.rootId).fen).toBe(getNode(annotated, e4).fen);
    const kids = getNode(sub, sub.rootId).children.map((id) => getNode(sub, id));
    expect(kids.map((k) => k.san)).toEqual(['e5', 'c5']);
    expect(kids[1]?.comment).toBe('Sicilian');
    expect(kids[1]?.nags).toEqual([2]);
  });

  it('numbers moves correctly for both colours', () => {
    const { tree, id } = play(createTree(), 'n0', 'e4', 'e5', 'Nf3', 'Nc6');
    const nodes = pathTo(tree, id).map((nid) => getNode(tree, nid));
    expect(nodes.slice(1).map((n) => [n.moveNumber, n.color])).toEqual([
      [1, 'w'],
      [1, 'b'],
      [2, 'w'],
      [2, 'b'],
    ]);
  });

  it('numbers moves from a custom position (Black to move, move 17)', () => {
    const tree = createTree('r3k2r/8/8/8/8/8/8/R3K2R b KQkq - 5 17');
    const move = addMove(tree, tree.rootId, 'Kd7');
    expect(move.ok && getNode(move.tree, move.nodeId).moveNumber).toBe(17);
    expect(move.ok && getNode(move.tree, move.nodeId).color).toBe('b');
  });
});
