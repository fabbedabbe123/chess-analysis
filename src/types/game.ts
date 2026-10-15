import type { Color } from './engine';

export type { Color };

export type FileLetter = 'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g' | 'h';
export type RankDigit = '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8';
export type Square = `${FileLetter}${RankDigit}`;
export type PieceType = 'p' | 'n' | 'b' | 'r' | 'q' | 'k';
export type PromotionPiece = 'q' | 'r' | 'b' | 'n';

export interface MoveInput {
  from: Square;
  to: Square;
  promotion?: PromotionPiece;
}

export type ShapeColor = 'green' | 'red' | 'blue' | 'yellow';

export interface Shape {
  /** Square highlight when `to` is undefined, otherwise an arrow from `from` to `to`. */
  from: Square;
  to?: Square;
  color: ShapeColor;
}

/** One node of the game tree. The root node represents the starting position (no move). */
export interface MoveNode {
  id: string;
  parentId: string | null;
  /** SAN of the move that led here ('' for the root). */
  san: string;
  /** UCI of the move that led here ('' for the root). */
  uci: string;
  /** Position AFTER the move. */
  fen: string;
  /** Number of half-moves from the root (root = 0). */
  ply: number;
  /** Colour that played the move (undefined for the root). */
  color?: Color;
  /** Full-move number of the move (the one printed in the move list). */
  moveNumber: number;
  /** Free-text comment attached after the move (engine commands like [%clk] are kept verbatim). */
  comment: string;
  /** Numeric Annotation Glyphs ($1 = !, $2 = ?, ...). */
  nags: number[];
  shapes: Shape[];
  /** Child ids; the FIRST one is the main continuation, the rest are variations. */
  children: string[];
}

export type PgnHeaders = Record<string, string>;

export interface GameTree {
  rootId: string;
  nodes: Record<string, MoveNode>;
  headers: PgnHeaders;
  /** Counter used to mint node ids. */
  nextId: number;
}

export type GameResultText = '1-0' | '0-1' | '1/2-1/2' | '*';

export type GameStatus =
  | { kind: 'ongoing'; inCheck: boolean }
  | { kind: 'checkmate'; winner: Color }
  | { kind: 'stalemate' }
  | { kind: 'draw'; reason: 'insufficient-material' | 'fifty-move' | 'threefold-repetition' | 'draw' };
