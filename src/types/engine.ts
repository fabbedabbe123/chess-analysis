/**
 * EVALUATION CONVENTION (read this before touching scores)
 * ---------------------------------------------------------
 * Stockfish reports every score from the point of view of the SIDE TO MOVE
 * ("stm"): +100 means the player whose turn it is is better by ~1 pawn.
 *
 * Everything the application stores, compares, formats or draws uses WHITE'S
 * point of view instead: positive = White is better, negative = Black is better.
 *
 * The two are different types on purpose (`pov` is a literal discriminant), so
 * the compiler rejects passing a raw engine score where a White-perspective
 * score is expected. The ONLY place that converts between them is
 * `toWhiteScore()` in `analysis/eval.ts`, which needs the side to move.
 *
 * Mate scores: `value` is the number of full moves to mate. Positive = the
 * (POV) player delivers mate, negative = the (POV) player gets mated.
 * `mate 0` (a checkmated side to move) has no sign, so White-POV mate scores
 * with value 0 carry an explicit `winner`.
 */

export type ScoreKind = 'cp' | 'mate';
export type Color = 'w' | 'b';

/** Score exactly as the engine printed it: side-to-move perspective. */
export interface StmScore {
  readonly pov: 'stm';
  readonly kind: ScoreKind;
  readonly value: number;
}

/** Score from White's perspective (positive = good for White). */
export interface WhiteScore {
  readonly pov: 'white';
  readonly kind: ScoreKind;
  readonly value: number;
  /** Only set for `mate 0` (checkmate on the board): who delivered it. */
  readonly winner?: Color;
}

export type ScoreBound = 'exact' | 'lower' | 'upper';

/** One parsed UCI `info` line (raw, engine perspective). */
export interface UciInfo {
  depth: number;
  seldepth?: number;
  multipv: number;
  score: StmScore;
  bound: ScoreBound;
  nodes?: number;
  nps?: number;
  timeMs?: number;
  hashfull?: number;
  tbhits?: number;
  /** Win/draw/loss per mille, side-to-move perspective (needs UCI_ShowWDL). */
  wdl?: [number, number, number];
  /** Principal variation in UCI long algebraic notation (e2e4, e7e8q ...). */
  pv: string[];
}

export interface UciBestMove {
  /** `null` when the engine answered `bestmove (none)` / `0000` (no legal move). */
  move: string | null;
  ponder: string | null;
}

export interface UciOptionSpec {
  name: string;
  type: 'check' | 'spin' | 'combo' | 'button' | 'string';
  default?: string;
  min?: number;
  max?: number;
  vars?: string[];
}

/** One candidate line, with the score already converted to White's perspective. */
export interface EngineLine {
  multipv: number;
  depth: number;
  seldepth?: number;
  scoreWhite: WhiteScore;
  bound: ScoreBound;
  /** UCI moves of the principal variation, starting at the analysed position. */
  pv: string[];
  nodes?: number;
  nps?: number;
  timeMs?: number;
  wdlWhite?: [number, number, number];
}

export type EngineFlavor = 'single' | 'multi';

export interface EngineCapabilities {
  name: string;
  flavor: EngineFlavor;
  maxThreads: number;
  maxMultiPv: number;
  supportsSkillLevel: boolean;
  supportsLimitStrength: boolean;
  minElo: number;
  maxElo: number;
  supportsWdl: boolean;
  /** Raw option list as reported by the engine. */
  options: UciOptionSpec[];
}

/** Engine-wide options (applied via `setoption`, only when changed). */
export interface EngineOptions {
  hashMb: number;
  threads: number;
  /** 0..20; 20 = full strength. Ignored when `limitStrength` is true. */
  skillLevel: number;
  limitStrength: boolean;
  elo: number;
  showWdl: boolean;
}

export interface SearchLimits {
  /** `go depth N` */
  depth?: number;
  /** `go movetime N` (milliseconds) */
  movetimeMs?: number;
  /** `go infinite` (until stopped). Used when neither depth nor movetime is set. */
  infinite?: boolean;
}

export interface SearchRequest {
  /** Full FEN of the position to analyse. */
  fen: string;
  multiPv: number;
  limits: SearchLimits;
  options: EngineOptions;
  /** Force `ucinewgame` (clears hash) before this search, e.g. for reviews. */
  newGame?: boolean;
}

export type SearchEndReason = 'completed' | 'stopped';

export interface SearchSnapshot {
  searchId: number;
  fen: string;
  sideToMove: Color;
  /** Lines of the deepest completed iteration, sorted by multipv. */
  lines: EngineLine[];
  depth: number;
  seldepth?: number;
  nodes: number;
  nps: number;
  timeMs: number;
  hashfull?: number;
  /** True once the engine has sent `bestmove` for this search. */
  done: boolean;
  endReason?: SearchEndReason;
  bestMove: string | null;
  ponder: string | null;
  /**
   * Fingerprint of everything that influences the result (MultiPV, limits and
   * engine options). Results with different keys must never be treated as
   * interchangeable (see the evaluation cache).
   */
  settingsKey: string;
}

export type EngineStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'searching'
  | 'error'
  | 'terminated';

export class EngineError extends Error {
  constructor(
    message: string,
    readonly code: 'init-timeout' | 'worker-error' | 'terminated' | 'not-ready' | 'unsupported',
  ) {
    super(message);
    this.name = 'EngineError';
  }
}

/** Rejection reason for a search that was replaced by a newer request. */
export class SearchSupersededError extends Error {
  constructor() {
    super('Search superseded by a newer request');
    this.name = 'SearchSupersededError';
  }
}
