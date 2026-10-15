import { Chess } from 'chess.js';
import { fullMoveNumber, positionKey, sideToMove, START_FEN } from './fen';
import type {
  Color,
  GameStatus,
  GameTree,
  MoveInput,
  MoveNode,
  PgnHeaders,
  Shape,
} from '@/types/game';

/**
 * The game is a TREE of positions, not a list: the first child of a node is the
 * main continuation, any further children are variations. All functions here are
 * pure (they return a new tree) so React state stays predictable, and none of
 * them can leave the tree inconsistent: a move is only added after chess.js has
 * accepted it from the parent's position.
 */

export type AddMoveResult =
  | { ok: true; tree: GameTree; nodeId: string; created: boolean }
  | { ok: false; error: string };

export function createTree(startFen: string = START_FEN, headers: PgnHeaders = {}): GameTree {
  const rootId = 'n0';
  const root: MoveNode = {
    id: rootId,
    parentId: null,
    san: '',
    uci: '',
    fen: startFen,
    ply: 0,
    moveNumber: fullMoveNumber(startFen),
    comment: '',
    nags: [],
    shapes: [],
    children: [],
  };
  const tree: GameTree = { rootId, nodes: { [rootId]: root }, headers: { ...headers }, nextId: 1 };
  if (startFen !== START_FEN) {
    tree.headers['SetUp'] = '1';
    tree.headers['FEN'] = startFen;
  }
  return tree;
}

export function getNode(tree: GameTree, id: string): MoveNode {
  const node = tree.nodes[id];
  if (node === undefined) throw new Error(`Unknown node ${id}`);
  return node;
}

export function hasNode(tree: GameTree, id: string): boolean {
  return tree.nodes[id] !== undefined;
}

export function rootNode(tree: GameTree): MoveNode {
  return getNode(tree, tree.rootId);
}

export function startFenOf(tree: GameTree): string {
  return rootNode(tree).fen;
}

/** Replace one node immutably. */
function withNode(tree: GameTree, node: MoveNode): GameTree {
  return { ...tree, nodes: { ...tree.nodes, [node.id]: node } };
}

function uciOf(move: { from: string; to: string; promotion?: string | undefined }): string {
  return `${move.from}${move.to}${move.promotion ?? ''}`;
}

/**
 * Add a move after `parentId`. If the same move already exists as a child it is
 * reused (no duplicate variations). Illegal moves return `{ ok: false }` and the
 * original tree is untouched.
 */
export function addMove(tree: GameTree, parentId: string, input: MoveInput | string): AddMoveResult {
  const parent = tree.nodes[parentId];
  if (parent === undefined) return { ok: false, error: `Unknown position ${parentId}` };

  let chess: Chess;
  try {
    chess = new Chess(parent.fen);
  } catch {
    return { ok: false, error: 'The current position is invalid.' };
  }

  let played;
  try {
    played = chess.move(input);
  } catch {
    const text = typeof input === 'string' ? input : `${input.from}-${input.to}`;
    return { ok: false, error: `Illegal move: ${text}` };
  }

  const uci = uciOf(played);
  const existing = parent.children.find((childId) => tree.nodes[childId]?.uci === uci);
  if (existing !== undefined) return { ok: true, tree, nodeId: existing, created: false };

  const id = `n${tree.nextId}`;
  const node: MoveNode = {
    id,
    parentId,
    san: played.san,
    uci,
    fen: chess.fen(),
    ply: parent.ply + 1,
    color: played.color,
    moveNumber: fullMoveNumber(parent.fen),
    comment: '',
    nags: [],
    shapes: [],
    children: [],
  };
  const updatedParent: MoveNode = { ...parent, children: [...parent.children, id] };
  return {
    ok: true,
    nodeId: id,
    created: true,
    tree: {
      ...tree,
      nextId: tree.nextId + 1,
      nodes: { ...tree.nodes, [parentId]: updatedParent, [id]: node },
    },
  };
}

/** Whether a move is legal from the node's position (used by the board before it commits). */
export function isLegalMove(tree: GameTree, nodeId: string, input: MoveInput): boolean {
  const node = tree.nodes[nodeId];
  if (node === undefined) return false;
  try {
    const chess = new Chess(node.fen);
    chess.move(input);
    return true;
  } catch {
    return false;
  }
}

/** True when moving `from -> to` is a pawn reaching the last rank (needs a promotion choice). */
export function needsPromotion(fen: string, from: string, to: string): boolean {
  try {
    const chess = new Chess(fen);
    const piece = chess.get(from as never);
    if (piece === undefined || piece.type !== 'p') return false;
    const rank = to[1];
    if (!((piece.color === 'w' && rank === '8') || (piece.color === 'b' && rank === '1'))) return false;
    return chess.moves({ square: from as never, verbose: true }).some((m) => m.to === to);
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------ navigation

export function parentOf(tree: GameTree, id: string): string | null {
  return getNode(tree, id).parentId;
}

/** Ids from the root to `id`, inclusive. */
export function pathTo(tree: GameTree, id: string): string[] {
  const path: string[] = [];
  let cursor: string | null = id;
  while (cursor !== null) {
    path.push(cursor);
    cursor = getNode(tree, cursor).parentId;
  }
  return path.reverse();
}

/** Main line: follow the first child from the root. */
export function mainLine(tree: GameTree): string[] {
  const line: string[] = [tree.rootId];
  let cursor = rootNode(tree);
  while (cursor.children.length > 0) {
    const next = cursor.children[0];
    if (next === undefined) break;
    line.push(next);
    cursor = getNode(tree, next);
  }
  return line;
}

/** Continue from `id` along first children until the end of that line. */
export function lineEnd(tree: GameTree, id: string): string {
  let cursor = getNode(tree, id);
  while (cursor.children.length > 0) {
    const next = cursor.children[0];
    if (next === undefined) break;
    cursor = getNode(tree, next);
  }
  return cursor.id;
}

export function isOnMainLine(tree: GameTree, id: string): boolean {
  const path = pathTo(tree, id);
  for (let i = 1; i < path.length; i += 1) {
    const parent = getNode(tree, path[i - 1] as string);
    if (parent.children[0] !== path[i]) return false;
  }
  return true;
}

export function mainLineNodes(tree: GameTree): MoveNode[] {
  return mainLine(tree).map((id) => getNode(tree, id));
}

// --------------------------------------------------------------------- editing

/** Remove a node and everything after it. Returns the tree and the parent id (where the cursor should go). */
export function deleteNode(tree: GameTree, id: string): { tree: GameTree; parentId: string } {
  if (id === tree.rootId) throw new Error('The starting position cannot be deleted.');
  const node = getNode(tree, id);
  const parentId = node.parentId as string;
  const doomed = new Set<string>();
  const stack = [id];
  while (stack.length > 0) {
    const cur = stack.pop() as string;
    doomed.add(cur);
    for (const child of getNode(tree, cur).children) stack.push(child);
  }
  const nodes: Record<string, MoveNode> = {};
  for (const [nodeId, n] of Object.entries(tree.nodes)) {
    if (!doomed.has(nodeId)) nodes[nodeId] = n;
  }
  const parent = getNode(tree, parentId);
  nodes[parentId] = { ...parent, children: parent.children.filter((c) => c !== id) };
  return { tree: { ...tree, nodes }, parentId };
}

/** Truncate the line after `id` (delete all of its children). */
export function deleteAfter(tree: GameTree, id: string): GameTree {
  let result = tree;
  for (const child of [...getNode(tree, id).children]) {
    result = deleteNode(result, child).tree;
  }
  return result;
}

/**
 * "Promote variation": move the line containing `id` one level up, i.e. swap it with the
 * previous sibling at the nearest fork above (or at) this node. Returns the tree unchanged
 * if the node is already on the main line.
 */
export function promoteVariation(tree: GameTree, id: string): GameTree {
  let cursor: string | null = id;
  while (cursor !== null) {
    const node = getNode(tree, cursor);
    if (node.parentId === null) return tree;
    const parent = getNode(tree, node.parentId);
    const index = parent.children.indexOf(cursor);
    if (index > 0) {
      const children = [...parent.children];
      const previous = children[index - 1] as string;
      children[index - 1] = cursor;
      children[index] = previous;
      return withNode(tree, { ...parent, children });
    }
    cursor = node.parentId;
  }
  return tree;
}

/** "Make main line": promote the path to `id` at EVERY fork so it becomes the main line. */
export function makeMainLine(tree: GameTree, id: string): GameTree {
  const path = pathTo(tree, id);
  let result = tree;
  for (let i = 1; i < path.length; i += 1) {
    const parent = getNode(result, path[i - 1] as string);
    const child = path[i] as string;
    if (parent.children[0] !== child) {
      result = withNode(result, { ...parent, children: [child, ...parent.children.filter((c) => c !== child)] });
    }
  }
  return result;
}

export function setComment(tree: GameTree, id: string, comment: string): GameTree {
  return withNode(tree, { ...getNode(tree, id), comment });
}

export function setShapes(tree: GameTree, id: string, shapes: Shape[]): GameTree {
  return withNode(tree, { ...getNode(tree, id), shapes });
}

export function toggleNag(tree: GameTree, id: string, nag: number): GameTree {
  const node = getNode(tree, id);
  const nags = node.nags.includes(nag) ? node.nags.filter((n) => n !== nag) : [...node.nags, nag];
  return withNode(tree, { ...node, nags });
}

export function setHeaders(tree: GameTree, headers: PgnHeaders): GameTree {
  return { ...tree, headers: { ...headers } };
}

/** New tree whose starting position is `id`'s position (used for "continue from here"). */
export function treeFromNode(tree: GameTree, id: string): GameTree {
  const node = getNode(tree, id);
  return createTree(node.fen);
}

/** Copy of the sub-tree below `id` re-rooted at `id` (keeps variations, comments and annotations). */
export function subTreeFrom(tree: GameTree, id: string): GameTree {
  const start = getNode(tree, id);
  const result = createTree(start.fen, { ...tree.headers });
  if (id === tree.rootId) return { ...tree };
  const copy = (srcId: string, dstParentId: string, current: GameTree): GameTree => {
    let next = current;
    const src = getNode(tree, srcId);
    for (const childId of src.children) {
      const child = getNode(tree, childId);
      const added = addMove(next, dstParentId, child.uci.length === 5
        ? { from: child.uci.slice(0, 2) as never, to: child.uci.slice(2, 4) as never, promotion: child.uci.slice(4) as never }
        : { from: child.uci.slice(0, 2) as never, to: child.uci.slice(2, 4) as never });
      if (!added.ok) continue;
      next = setShapes(setComment(added.tree, added.nodeId, child.comment), added.nodeId, child.shapes);
      const node = getNode(next, added.nodeId);
      next = withNode(next, { ...node, nags: [...child.nags] });
      next = copy(childId, added.nodeId, next);
    }
    return next;
  };
  return copy(id, result.rootId, result);
}

// --------------------------------------------------------------------- status

/**
 * Game status at a node. Repetition needs the history of positions on the path
 * (a bare FEN cannot know it), so we count identical positions along the path.
 */
export function statusAt(tree: GameTree, id: string): GameStatus {
  const node = getNode(tree, id);
  let chess: Chess;
  try {
    chess = new Chess(node.fen);
  } catch {
    return { kind: 'ongoing', inCheck: false };
  }
  if (chess.isCheckmate()) {
    const loser: Color = sideToMove(node.fen);
    return { kind: 'checkmate', winner: loser === 'w' ? 'b' : 'w' };
  }
  if (chess.isStalemate()) return { kind: 'stalemate' };
  if (chess.isInsufficientMaterial()) return { kind: 'draw', reason: 'insufficient-material' };
  if (chess.isDrawByFiftyMoves()) return { kind: 'draw', reason: 'fifty-move' };

  const key = positionKey(node.fen);
  let occurrences = 0;
  for (const pathId of pathTo(tree, id)) {
    if (positionKey(getNode(tree, pathId).fen) === key) occurrences += 1;
  }
  if (occurrences >= 3) return { kind: 'draw', reason: 'threefold-repetition' };
  return { kind: 'ongoing', inCheck: chess.inCheck() };
}

export function describeStatus(status: GameStatus): string | null {
  switch (status.kind) {
    case 'checkmate':
      return `Checkmate - ${status.winner === 'w' ? 'White' : 'Black'} wins`;
    case 'stalemate':
      return 'Stalemate - draw';
    case 'draw':
      return {
        'insufficient-material': 'Draw - insufficient material',
        'fifty-move': 'Draw - fifty-move rule',
        'threefold-repetition': 'Draw - threefold repetition',
        draw: 'Draw',
      }[status.reason];
    default:
      return status.inCheck ? 'Check' : null;
  }
}

/** Number of half-moves in the main line. */
export function mainLineLength(tree: GameTree): number {
  return mainLine(tree).length - 1;
}

/** "12." / "12..." label for a move node, used by the move list. */
export function moveLabel(node: MoveNode, withEllipsis: boolean): string {
  if (node.color === 'w') return `${node.moveNumber}.`;
  return withEllipsis ? `${node.moveNumber}...` : '';
}

/** Legal destination squares for a piece on `from` at `fen`. */
export function legalTargets(fen: string, from: string): string[] {
  try {
    const chess = new Chess(fen);
    return chess.moves({ square: from as never, verbose: true }).map((m) => m.to);
  } catch {
    return [];
  }
}
