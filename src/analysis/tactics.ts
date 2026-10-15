import { Chess } from 'chess.js';
import type { Color, PieceType, Square } from '@/types/game';

/**
 * TACTICAL PATTERN DETECTION - HEURISTIC, NOT COMPLETE
 * ----------------------------------------------------
 * What is detected here (static geometry on the board, no search):
 *   - hanging pieces      attacked and undefended, or attacked by a less valuable piece
 *   - absolute pins       a piece pinned against its own king by a rook/bishop/queen
 *   - fork opportunities  a legal move after which the moved piece attacks 2+ valuable targets
 *                         and is not obviously lost
 * NOT detected: skewers, discovered attacks, relative pins, overloaded/deflected pieces,
 * x-rays, back-rank motifs, zwischenzugs. Static patterns can be wrong (they ignore what
 * happens after the first capture), so every item is labelled as a heuristic. Move
 * quality and "is this actually winning" always come from Stockfish, never from here.
 */

export const TACTICS_DISCLAIMER =
  'Pattern hints come from simple board geometry (hanging pieces, absolute pins, fork chances). They are heuristics and can be wrong or incomplete - the engine evaluation is the source of truth.';

export type TacticKind = 'hanging' | 'threatened' | 'pin' | 'fork';

export interface TacticalFeature {
  kind: TacticKind;
  /** Side the feature is about (owner of the weak/pinned piece, or the side that can fork). */
  color: Color;
  squares: Square[];
  text: string;
}

const VALUE: Record<PieceType, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };
const NAME: Record<PieceType, string> = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
const COLOR_NAME: Record<Color, string> = { w: 'White', b: 'Black' };
const FILES = 'abcdefgh';

const sq = (file: number, rank: number): Square | null =>
  file < 0 || file > 7 || rank < 0 || rank > 7 ? null : (`${FILES[file] as string}${rank + 1}` as Square);

function coords(square: string): { file: number; rank: number } {
  return { file: FILES.indexOf(square[0] as string), rank: Number.parseInt(square[1] as string, 10) - 1 };
}

function pieceAt(chess: Chess, square: Square): { type: PieceType; color: Color } | undefined {
  const p = chess.get(square);
  return p === undefined ? undefined : { type: p.type as PieceType, color: p.color as Color };
}

function allPieces(chess: Chess): { square: Square; type: PieceType; color: Color }[] {
  const out: { square: Square; type: PieceType; color: Color }[] = [];
  chess.board().forEach((row) =>
    row.forEach((cell) => {
      if (cell !== null) out.push({ square: cell.square as Square, type: cell.type as PieceType, color: cell.color as Color });
    }),
  );
  return out;
}

function minAttackerValue(chess: Chess, target: Square, by: Color): number {
  let min = Number.POSITIVE_INFINITY;
  for (const from of chess.attackers(target, by)) {
    const p = pieceAt(chess, from as Square);
    if (p !== undefined) min = Math.min(min, VALUE[p.type]);
  }
  return min;
}

function detectHanging(chess: Chess, turn: Color): TacticalFeature[] {
  const features: TacticalFeature[] = [];
  for (const piece of allPieces(chess)) {
    if (piece.type === 'k') continue;
    const enemy: Color = piece.color === 'w' ? 'b' : 'w';
    const attackers = chess.attackers(piece.square, enemy);
    if (attackers.length === 0) continue;
    const defenders = chess.attackers(piece.square, piece.color);
    const lowestAttacker = minAttackerValue(chess, piece.square, enemy);
    const name = `${COLOR_NAME[piece.color]}'s ${NAME[piece.type]} on ${piece.square}`;
    const toMove = piece.color === turn;

    if (defenders.length === 0) {
      features.push({
        kind: 'hanging',
        color: piece.color,
        squares: [piece.square],
        text: toMove ? `${name} is attacked and undefended.` : `${name} is attacked and undefended - it can be captured.`,
      });
    } else if (lowestAttacker < VALUE[piece.type]) {
      features.push({
        kind: 'threatened',
        color: piece.color,
        squares: [piece.square],
        text: `${name} is attacked by a less valuable piece.`,
      });
    }
  }
  return features;
}

const DIRECTIONS: readonly { df: number; dr: number; sliders: readonly PieceType[] }[] = [
  { df: 1, dr: 0, sliders: ['r', 'q'] },
  { df: -1, dr: 0, sliders: ['r', 'q'] },
  { df: 0, dr: 1, sliders: ['r', 'q'] },
  { df: 0, dr: -1, sliders: ['r', 'q'] },
  { df: 1, dr: 1, sliders: ['b', 'q'] },
  { df: 1, dr: -1, sliders: ['b', 'q'] },
  { df: -1, dr: 1, sliders: ['b', 'q'] },
  { df: -1, dr: -1, sliders: ['b', 'q'] },
];

function detectPins(chess: Chess): TacticalFeature[] {
  const features: TacticalFeature[] = [];
  for (const color of ['w', 'b'] as const) {
    const king = chess.findPiece({ type: 'k', color })[0];
    if (king === undefined) continue;
    const { file, rank } = coords(king);
    for (const dir of DIRECTIONS) {
      let pinned: { square: Square; type: PieceType } | null = null;
      for (let step = 1; step < 8; step += 1) {
        const target = sq(file + dir.df * step, rank + dir.dr * step);
        if (target === null) break;
        const piece = pieceAt(chess, target);
        if (piece === undefined) continue;
        if (pinned === null) {
          if (piece.color !== color) break; // enemy piece directly attacking = check, not a pin
          pinned = { square: target, type: piece.type };
          continue;
        }
        if (piece.color !== color && dir.sliders.includes(piece.type)) {
          features.push({
            kind: 'pin',
            color,
            squares: [pinned.square, target],
            text: `${COLOR_NAME[color]}'s ${NAME[pinned.type]} on ${pinned.square} is pinned to the king by the ${NAME[piece.type]} on ${target}.`,
          });
        }
        break;
      }
    }
  }
  return features;
}

/** Fork opportunities for the side to move (legal moves only). */
function detectForks(chess: Chess, turn: Color): TacticalFeature[] {
  const features: TacticalFeature[] = [];
  const enemy: Color = turn === 'w' ? 'b' : 'w';
  const seen = new Set<string>();

  for (const move of chess.moves({ verbose: true })) {
    if (move.isKingsideCastle() || move.isQueensideCastle()) continue;
    const movedValue = VALUE[move.piece as PieceType];
    chess.move(move.san);
    try {
      const to = move.to as Square;
      const targets: { square: Square; type: PieceType }[] = [];
      for (const enemyPiece of allPieces(chess)) {
        if (enemyPiece.color !== enemy) continue;
        if (!chess.attackers(enemyPiece.square, turn).includes(to)) continue;
        const defended = chess.attackers(enemyPiece.square, enemy).length > 0;
        const valuable = enemyPiece.type === 'k' || VALUE[enemyPiece.type] > movedValue || !defended;
        if (!valuable) continue;
        // A piece "forking" mere pawns is rarely a real fork.
        if (enemyPiece.type === 'p' && movedValue > VALUE.p) continue;
        targets.push({ square: enemyPiece.square, type: enemyPiece.type });
      }
      if (targets.length < 2) continue;

      const attackedBy = minAttackerValue(chess, to, enemy);
      const defendedByUs = chess.attackers(to, turn).length > 1; // the mover itself is not a defender
      const safe = attackedBy === Number.POSITIVE_INFINITY || (defendedByUs && attackedBy >= movedValue);
      if (!safe) continue;

      const key = `${move.piece}${to}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const list = targets.map((t) => `${NAME[t.type]} on ${t.square}`).join(' and ');
      features.push({
        kind: 'fork',
        color: turn,
        squares: [to, ...targets.map((t) => t.square)],
        text: `${COLOR_NAME[turn]} can play ${move.san}, attacking the ${list} at once (possible fork).`,
      });
    } finally {
      chess.undo();
    }
  }
  return features.slice(0, 4);
}

/** Heuristic tactical hints for a position. Never throws; returns [] for an invalid FEN. */
export function detectTactics(fen: string): TacticalFeature[] {
  let chess: Chess;
  try {
    chess = new Chess(fen);
  } catch {
    return [];
  }
  const turn = chess.turn() as Color;
  return [...detectHanging(chess, turn), ...detectPins(chess), ...detectForks(chess, turn)];
}
