import { classifyMove, type MoveClass, type MoveTag } from '@/analysis/classify';
import { sideWinPercent, formatScore } from '@/analysis/eval';
import { pvToSan } from '@/analysis/pv';
import { reviewOptions, terminalScore, toPositionRecord, type PositionRecord } from '@/analysis/review';
import { createTree, getNode, hasNode, lineEnd, mainLine, statusAt } from '@/chess/gameTree';
import { START_FEN } from '@/chess/fen';
import { createBrowserEngine, type StockfishEngine } from '@/engine/StockfishEngine';
import { buildCoachReport, type CoachReport } from '@/play/coach';
import { buildHint, type HintContent } from '@/play/hints';
import { addGameRecord, attachReview } from '@/stores/historyStore';
import { DEFAULT_CUSTOM, sanitizeCustom, specFor, strengthFor, type CustomLevel, type LevelId } from '@/play/strength';
import { openingAt, loadOpeningBook } from '@/analysis/openings';
import { SearchSupersededError, type Color, type WhiteScore } from '@/types/engine';
import type { GameTree } from '@/types/game';
import { storageGet, storageRemove, storageSet } from '@/utils/storage';
import { exportPgn, parsePgn } from '@/pgn/pgn';
import { createStore, useStore } from './createStore';
import { ensureEngine, stopAnalysis } from './engineStore';
import { deleteFromHere, gameStore, playMove, setPersistenceSuspended, updateHeaders } from './gameStore';
import { cancelReview, mainLineSignature, reviewStore, startReview } from './reviewStore';
import { engineOptionsFrom, settingsStore, updateSettings } from './settingsStore';
import { addFromReview } from './strengthStore';
import { requestReanalysis, setTacticSquares } from './uiStore';

/**
 * Play mode. Like puzzles it BORROWS the board (the user's own game is parked and restored on exit, nothing is saved
 * to the stored game meanwhile). Two engines are used:
 *   - a dedicated "opponent" engine, strength-limited via real UCI options (see play/strength.ts), that chooses the
 *     engine's moves from the actual position;
 *   - the shared full-strength engine for hints, the evaluation bar and move feedback (depth FEEDBACK_DEPTH).
 * Every asynchronous result is guarded by `generation` and by the FEN it was computed for, so a stale answer can never
 * be applied to a different position.
 */

export type FeedbackMode = 'none' | 'every' | 'significant' | 'after';
export type PlayPhase = 'off' | 'playing' | 'finished';

export interface PlaySettings {
  level: LevelId;
  custom: CustomLevel;
  color: Color | 'random';
  practice: boolean;
  hints: boolean;
  feedback: FeedbackMode;
  showEval: boolean;
}

export const DEFAULT_PLAY_SETTINGS: PlaySettings = { level: 'intermediate', custom: DEFAULT_CUSTOM, color: 'w', practice: true, hints: true, feedback: 'every', showEval: true };
const SETTINGS_KEY = 'chess-analysis:play-settings:v1';

export function sanitizePlaySettings(raw: unknown): PlaySettings {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const levels: LevelId[] = ['beginner', 'easy', 'intermediate', 'advanced', 'expert', 'maximum', 'custom'];
  const fb: FeedbackMode[] = ['none', 'every', 'significant', 'after'];
  return {
    level: levels.includes(r['level'] as LevelId) ? (r['level'] as LevelId) : DEFAULT_PLAY_SETTINGS.level,
    custom: sanitizeCustom(r['custom']),
    color: r['color'] === 'b' || r['color'] === 'random' ? (r['color'] as Color | 'random') : 'w',
    practice: typeof r['practice'] === 'boolean' ? r['practice'] : DEFAULT_PLAY_SETTINGS.practice,
    hints: typeof r['hints'] === 'boolean' ? r['hints'] : DEFAULT_PLAY_SETTINGS.hints,
    feedback: fb.includes(r['feedback'] as FeedbackMode) ? (r['feedback'] as FeedbackMode) : DEFAULT_PLAY_SETTINGS.feedback,
    showEval: typeof r['showEval'] === 'boolean' ? r['showEval'] : DEFAULT_PLAY_SETTINGS.showEval,
  };
}

export interface MoveFeedback {
  nodeId: string;
  san: string;
  moveClass: MoveClass | null;
  winLoss: number;
  tags: MoveTag[];
  bestSan: string | null;
  bestUci: string | null;
  bestLine: string;
  text: string;
  depth: number;
  fenBefore: string;
}

export interface GameResultInfo {
  outcome: 'win' | 'draw' | 'loss';
  /** e.g. "Checkmate", "Resignation", "Draw by agreement" */
  reason: string;
  text: string;
}

export interface HintState {
  fen: string;
  level: 0 | 1 | 2 | 3;
  busy: boolean;
  content: HintContent | null;
  depth: number | null;
  error: string | null;
}

export interface PlayState {
  phase: PlayPhase;
  settings: PlaySettings;
  userColor: Color;
  levelLabel: string;
  strengthNote: string;
  thinking: boolean;
  tipId: string | null;
  message: string | null;
  error: string | null;
  /** Evaluation (White's view, full-strength engine at FEEDBACK_DEPTH) by FEN. */
  evals: Record<string, { score: WhiteScore; depth: number }>;
  hint: HintState | null;
  feedback: Record<string, MoveFeedback>;
  result: GameResultInfo | null;
  recordId: string | null;
  review: 'idle' | 'running' | 'done' | 'error';
  report: CoachReport | null;
  reviewError: string | null;
  orientation: 'white' | 'black' | null;
}

export const FEEDBACK_DEPTH = 12;
const MIN_REPLY_MS = 350;

// ------------------------------------------------------------ resumable game
const SESSION_KEY = 'chess-analysis:play-session:v1';

export interface SavedSession {
  pgn: string;
  userColor: Color;
  level: LevelId;
  plies: number;
  savedAt: number;
}

export function sanitizeSession(raw: unknown): SavedSession | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const levels: LevelId[] = ['beginner', 'easy', 'intermediate', 'advanced', 'expert', 'maximum', 'custom'];
  if (typeof r['pgn'] !== 'string' || (r['userColor'] !== 'w' && r['userColor'] !== 'b') || !levels.includes(r['level'] as LevelId)) return null;
  const parsed = parsePgn(r['pgn']);
  const game = parsed.games[0];
  if (game === undefined) return null;
  return { pgn: r['pgn'], userColor: r['userColor'], level: r['level'] as LevelId, plies: mainLine(game.tree).length - 1, savedAt: typeof r['savedAt'] === 'number' ? r['savedAt'] : 0 };
}

function readSession(): SavedSession | null {
  try {
    const t = storageGet(SESSION_KEY);
    return t === null ? null : sanitizeSession(JSON.parse(t) as unknown);
  } catch {
    return null;
  }
}

/** The unfinished game left over from a previous visit (null if none). Reactive. */
export const savedSessionStore = createStore<{ session: SavedSession | null }>({ session: readSession() });
export const useSavedSession = (): SavedSession | null => useStore(savedSessionStore, (s) => s.session);

function persistSession(): void {
  const s = playStore.get();
  if (s.phase !== 'playing') return;
  const { tree } = gameStore.get();
  const plies = mainLine(tree).length - 1;
  if (plies === 0) return;
  const session: SavedSession = { pgn: exportPgn(tree), userColor: s.userColor, level: s.settings.level, plies, savedAt: Date.now() };
  storageSet(SESSION_KEY, JSON.stringify(session));
  savedSessionStore.set({ session });
}

function clearSession(): void {
  storageRemove(SESSION_KEY);
  savedSessionStore.set({ session: null });
}

export function discardSavedSession(): void {
  clearSession();
}

function load(): PlaySettings {
  try {
    const t = storageGet(SETTINGS_KEY);
    return sanitizePlaySettings(t === null ? null : (JSON.parse(t) as unknown));
  } catch {
    return DEFAULT_PLAY_SETTINGS;
  }
}

function initial(settings: PlaySettings = load()): PlayState {
  return {
    phase: 'off', settings, userColor: 'w', levelLabel: '', strengthNote: '', thinking: false, tipId: null, message: null, error: null,
    evals: {}, hint: null, feedback: {}, result: null, recordId: null, review: 'idle', report: null, reviewError: null, orientation: null,
  };
}

export const playStore = createStore<PlayState>(initial());
export const usePlay = <S,>(sel: (s: PlayState) => S): S => useStore(playStore, sel);

export function updatePlaySettings(patch: Partial<PlaySettings>): void {
  const next = sanitizePlaySettings({ ...playStore.get().settings, ...patch });
  playStore.set({ settings: next });
  storageSet(SETTINGS_KEY, JSON.stringify(next));
}

// -------------------------------------------------------------- derived helpers

export const sideToMoveOf = (fen: string): Color => (fen.split(' ')[1] === 'b' ? 'b' : 'w');

/** True when the user must not move the pieces right now. */
export function playBoardLocked(s: PlayState): boolean {
  if (s.phase === 'off') return false;
  const g = gameStore.get();
  if (s.phase === 'finished') return g.currentId === s.tipId; // finished: explore variations, but do not extend the game
  if (s.thinking || s.tipId === null || g.currentId !== s.tipId || !hasNode(g.tree, s.tipId)) return true;
  return sideToMoveOf(getNode(g.tree, s.tipId).fen) !== s.userColor;
}

export function engineColorOf(s: PlayState): Color {
  return s.userColor === 'w' ? 'b' : 'w';
}

// ----------------------------------------------------------------- internals

interface Parked { tree: GameTree; currentId: string; redoStack: string[]; original: GameTree | null }
let parked: Parked | null = null;
let generation = 0;
let internal = false;
let known = 0;
let playEngine: EngineLike | null = null;
let firstEngineSearch = true;
const records = new Map<string, PositionRecord>();
const queue: string[] = [];
let pumping = false;
let hintBusy = false;

const nodeCount = (tree: GameTree): number => Object.keys(tree.nodes).length;
function viaGame<T>(fn: () => T): T {
  internal = true;
  try {
    return fn();
  } finally {
    internal = false;
  }
}
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function terminalRecord(fen: string): PositionRecord | null {
  const score = terminalScore(fen);
  if (score === null) return null;
  return { fen, score, bestMove: null, bestPv: [], depth: 0, complete: true, terminal: null };
}

/** Test seams: lets unit tests supply scripted engines (the real ones need a browser Worker). */
type EngineLike = Pick<StockfishEngine, 'search' | 'stop' | 'terminate' | 'getStatus' | 'getCapabilities'>;
let opponentFactory: () => Promise<EngineLike> = createBrowserEngine;
let analysisProvider: () => Promise<EngineLike> = ensureEngine;
let replyDelayMs = MIN_REPLY_MS;
export function setPlayEnginesForTests(opponent: (() => Promise<EngineLike>) | null, analysis: (() => Promise<EngineLike>) | null, delayMs = MIN_REPLY_MS): void {
  opponentFactory = opponent ?? createBrowserEngine;
  analysisProvider = analysis ?? ensureEngine;
  replyDelayMs = delayMs;
}

async function ensurePlayEngine(): Promise<EngineLike> {
  if (playEngine !== null && playEngine.getStatus() !== 'error' && playEngine.getStatus() !== 'terminated') return playEngine;
  playEngine?.terminate();
  playEngine = await opponentFactory();
  firstEngineSearch = true;
  return playEngine;
}

function disposePlayEngine(): void {
  playEngine?.terminate();
  playEngine = null;
}

/** Evaluate `fen` with the full-strength shared engine. Cached; null on failure. */
export async function evaluateFen(fen: string, depth = FEEDBACK_DEPTH): Promise<PositionRecord | null> {
  const cached = records.get(fen);
  if (cached !== undefined && cached.complete) return cached;
  const terminal = terminalRecord(fen);
  if (terminal !== null) {
    records.set(fen, terminal);
    return terminal;
  }
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const engine = await analysisProvider();
      const snapshot = await engine.search({ fen, multiPv: 1, limits: { depth }, options: reviewOptions(engineOptionsFrom(settingsStore.get())) }).result;
      const rec = toPositionRecord(fen, snapshot, depth);
      if (rec.complete) {
        records.set(fen, rec);
        return rec;
      }
    } catch (e) {
      if (!(e instanceof SearchSupersededError)) return null;
      await sleep(60);
    }
  }
  return null;
}

function enqueue(fen: string): void {
  if (!records.has(fen) && !queue.includes(fen)) queue.push(fen);
  void pump();
}

async function pump(): Promise<void> {
  if (pumping) return;
  pumping = true;
  const gen = generation;
  try {
    while (queue.length > 0 && gen === generation && playStore.get().phase !== 'off') {
      if (hintBusy) {
        await sleep(80);
        continue;
      }
      const fen = queue[0] as string;
      const rec = await evaluateFen(fen);
      if (gen !== generation) return;
      if (hintBusy && rec === null) continue;
      queue.shift();
      if (rec === null) {
        playStore.set({ message: 'Position analysis is unavailable right now (engine error); hints and feedback are paused.' });
        continue;
      }
      playStore.set((s) => ({ evals: { ...s.evals, [fen]: { score: rec.score, depth: rec.depth } } }));
      computeFeedback();
    }
  } finally {
    pumping = false;
  }
}

// ------------------------------------------------------------------ feedback

const sanOf = (fen: string, uci: string | null): string | null => {
  if (uci === null) return null;
  return pvToSan(fen, [uci], 1).moves[0]?.san ?? null;
};

function explain(m: { san: string; moveNumber: number; color: Color; winBefore: number; winAfter: number; winLoss: number; moveClass: MoveClass | null; tags: MoveTag[]; bestSan: string | null; before: WhiteScore; after: WhiteScore }): string {
  const label = `${m.moveNumber}${m.color === 'w' ? '.' : '...'} ${m.san}`;
  if (m.moveClass === null) return `${label}: the engine analysis was not complete, so this move is not classified.`;
  const swing = `${formatScore(m.before)} → ${formatScore(m.after)}`;
  if (m.moveClass === 'best') return `${label} is the engine's top choice (${swing}).`;
  if (m.moveClass === 'excellent' || m.moveClass === 'good') return `${label} is ${m.moveClass}: it costs about ${Math.round(m.winLoss)}% winning chances at most (${swing}).`;
  const better = m.bestSan !== null ? ` Stockfish preferred ${m.bestSan}.` : '';
  const mate = m.tags.includes('missed-mate') ? ' You had a forced mate.' : m.tags.includes('allowed-mate') ? ' This allows a forced mate.' : m.tags.includes('missed-win') ? ' You were winning and this lets it slip.' : '';
  return `${label} is ${m.moveClass === 'inaccuracy' ? 'an inaccuracy' : `a ${m.moveClass}`}: your winning chances fell from ${Math.round(m.winBefore)}% to ${Math.round(m.winAfter)}% (${swing}).${better}${mate}`;
}

/** Classify every user move whose before/after evaluations are both available. Safe to call repeatedly. */
export function computeFeedback(): void {
  const s = playStore.get();
  if (s.phase === 'off' || s.settings.feedback === 'none' || s.settings.feedback === 'after') return;
  const { tree } = gameStore.get();
  const thresholds = settingsStore.get().thresholds;
  const add: Record<string, MoveFeedback> = {};
  for (const id of mainLine(tree)) {
    const node = getNode(tree, id);
    if (node.parentId === null || node.color !== s.userColor || s.feedback[id] !== undefined) continue;
    const parent = getNode(tree, node.parentId);
    const before = records.get(parent.fen);
    const after = records.get(node.fen);
    if (before === undefined || after === undefined) continue;
    const forcing = before.bestMove !== null && before.score.kind === 'mate';
    const cls = classifyMove({ mover: node.color, playedUci: node.uci, before, after, ply: node.ply, bestMoveIsForcing: forcing, thresholds });
    const bestSan = cls.isEngineBest ? null : sanOf(parent.fen, before.bestMove);
    const conv = before.bestMove === null || cls.isEngineBest ? null : pvToSan(parent.fen, before.bestPv.length > 0 ? before.bestPv : [before.bestMove], 5);
    const bestLine = conv === null ? '' : conv.moves.map((x, i) => `${x.color === 'w' ? `${x.moveNumber}.` : i === 0 ? `${x.moveNumber}...` : ''}${x.san}`).join(' ');
    add[id] = {
      nodeId: id, san: node.san, moveClass: cls.moveClass, winLoss: cls.winLoss, tags: cls.tags, bestSan, bestUci: cls.isEngineBest ? null : before.bestMove, bestLine, depth: Math.min(before.depth, after.depth), fenBefore: parent.fen,
      text: explain({ san: node.san, moveNumber: node.moveNumber, color: node.color, winBefore: cls.winBefore, winAfter: cls.winAfter, winLoss: cls.winLoss, moveClass: cls.moveClass, tags: cls.tags, bestSan, before: before.score, after: after.score }),
    };
  }
  if (Object.keys(add).length > 0) playStore.set((st) => ({ feedback: { ...st.feedback, ...add } }));
}

/** Feedback to show for the latest user move, honouring the feedback mode. */
export function visibleFeedback(s: PlayState): MoveFeedback | null {
  if (s.settings.feedback === 'none' || s.settings.feedback === 'after') return null;
  const { tree } = gameStore.get();
  const ids = mainLine(tree);
  for (let i = ids.length - 1; i > 0; i -= 1) {
    const node = getNode(tree, ids[i] as string);
    if (node.color !== s.userColor) continue;
    const fb = s.feedback[node.id];
    if (fb === undefined) return null;
    if (s.settings.feedback === 'significant' && !(fb.moveClass === 'mistake' || fb.moveClass === 'blunder' || fb.tags.includes('missed-mate') || fb.tags.includes('allowed-mate'))) return null;
    return fb;
  }
  return null;
}

// ------------------------------------------------------------------ game flow

const RESULT_TEXT = { w: '1-0', b: '0-1' } as const;

function finishGame(outcome: GameResultInfo['outcome'], reason: string, pgnResult: '1-0' | '0-1' | '1/2-1/2'): void {
  const s = playStore.get();
  if (s.phase !== 'playing') return;
  generation += 1; // drop any search still in flight
  playEngine?.stop();
  clearSession();
  setTacticSquares([]);
  const text = outcome === 'win' ? `You won — ${reason}` : outcome === 'loss' ? `You lost — ${reason}` : `Draw — ${reason}`;
  viaGame(() => updateHeaders({ Result: pgnResult, Termination: reason }));
  const id = `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  playStore.set({ phase: 'finished', thinking: false, result: { outcome, reason, text }, recordId: id, hint: null, message: null });
  const { tree } = gameStore.get();
  const plies = mainLine(tree).length - 1;
  void saveRecord(id, outcome, reason, plies, tree);
}

async function saveRecord(id: string, outcome: GameResultInfo['outcome'], reason: string, plies: number, tree: GameTree): Promise<void> {
  const { exportPgn } = await import('@/pgn/pgn');
  let opening: string | null = null;
  try {
    const book = await loadOpeningBook();
    const fens = mainLine(tree).map((n) => getNode(tree, n).fen);
    for (let i = fens.length - 1; i >= 0 && opening === null; i -= 1) opening = openingAt(book, fens[i] as string)?.name ?? null;
  } catch {
    opening = null;
  }
  const s = playStore.get();
  addGameRecord({ id, endedAt: Date.now(), userColor: s.userColor, levelId: s.settings.level, levelLabel: s.levelLabel, result: outcome, reason, plies, pgn: exportPgn(tree), opening, review: null });
}

function checkEnd(): boolean {
  const s = playStore.get();
  const { tree } = gameStore.get();
  if (s.tipId === null || !hasNode(tree, s.tipId)) return false;
  const st = statusAt(tree, s.tipId);
  if (st.kind === 'checkmate') {
    finishGame(st.winner === s.userColor ? 'win' : 'loss', 'Checkmate', RESULT_TEXT[st.winner]);
    return true;
  }
  if (st.kind === 'stalemate') {
    finishGame('draw', 'Stalemate', '1/2-1/2');
    return true;
  }
  if (st.kind === 'draw') {
    const why = { 'insufficient-material': 'Insufficient material', 'fifty-move': 'Fifty-move rule', 'threefold-repetition': 'Threefold repetition', draw: 'Draw' }[st.reason];
    finishGame('draw', why, '1/2-1/2');
    return true;
  }
  return false;
}

function advance(): void {
  const s = playStore.get();
  if (s.phase !== 'playing' || s.tipId === null) return;
  const { tree } = gameStore.get();
  if (!hasNode(tree, s.tipId)) return;
  const fen = getNode(tree, s.tipId).fen;
  enqueue(fen);
  if (checkEnd()) return;
  persistSession();
  if (sideToMoveOf(fen) !== s.userColor) void engineMove(generation);
  else playStore.set({ thinking: false, message: 'Your move.' });
}

async function engineMove(gen: number): Promise<void> {
  const s0 = playStore.get();
  if (s0.thinking || s0.tipId === null) return;
  const { tree } = gameStore.get();
  const tip = s0.tipId;
  const fen = getNode(tree, tip).fen;
  playStore.set({ thinking: true, error: null, message: 'Stockfish is thinking…' });
  try {
    const engine = await ensurePlayEngine();
    if (gen !== generation) return;
    const spec = specFor(s0.settings.level, s0.settings.custom);
    const st = strengthFor(spec, engine.getCapabilities(), { hashMb: Math.min(32, settingsStore.get().hashMb) });
    const started = Date.now();
    const snapshot = await engine.search({ fen, multiPv: 1, limits: st.limits, options: st.options, newGame: firstEngineSearch }).result;
    firstEngineSearch = false;
    if (gen !== generation) return;
    const uci = snapshot.bestMove ?? snapshot.lines[0]?.pv[0] ?? null;
    if (uci === null) throw new Error('The engine returned no move.');
    const wait = replyDelayMs - (Date.now() - started);
    if (wait > 0) await sleep(wait);
    if (gen !== generation) return;
    const cur = playStore.get();
    if (cur.tipId !== tip) return;
    const g = gameStore.get();
    // The engine plays from the tip even if the user is looking at an earlier position.
    const r = viaGame(() => {
      const save = g.currentId;
      gameStore.set({ currentId: tip, redoStack: [] });
      const res = playMove({ from: uci.slice(0, 2), to: uci.slice(2, 4), ...(uci.length === 5 ? { promotion: uci[4] } : {}) } as never);
      if (!res.ok) gameStore.set({ currentId: save });
      return res;
    });
    if (!r.ok) throw new Error(`The engine suggested an illegal move (${uci}). It was not played.`);
    known = nodeCount(gameStore.get().tree);
    playStore.set({ tipId: r.nodeId, thinking: false });
    advance();
  } catch (e) {
    if (gen !== generation || e instanceof SearchSupersededError) return;
    disposePlayEngine();
    playStore.set({ thinking: false, error: e instanceof Error ? e.message : 'The engine failed.', message: null });
  }
}

/** Retry after an engine error (restarts the opponent engine). */
export function retryEngineMove(): void {
  const s = playStore.get();
  if (s.phase !== 'playing' || s.error === null) return;
  playStore.set({ error: null });
  advance();
}

function onUserMove(nodeId: string): void {
  setTacticSquares([]);
  playStore.set({ tipId: nodeId, hint: null, message: null });
  advance();
}

let subscribed = false;
/** Watches the game store for the user's moves and rejects any other change to the game while playing. Idempotent. */
export function initPlay(): void {
  if (subscribed) return;
  subscribed = true;
  gameStore.subscribe(() => {
    const s = playStore.get();
    if (internal || s.phase !== 'playing' || s.tipId === null) return;
    const g = gameStore.get();
    const count = nodeCount(g.tree);
    if (count === known) return;
    if (!hasNode(g.tree, s.tipId)) {
      // Something replaced the tree (e.g. an undo of tree edits): resynchronise to the end of the main line.
      known = count;
      const tip = lineEnd(g.tree, g.tree.rootId);
      playStore.set({ tipId: tip, hint: null });
      advance();
      return;
    }
    const node = getNode(g.tree, g.currentId);
    const userTurn = sideToMoveOf(getNode(g.tree, s.tipId).fen) === s.userColor;
    if (count === known + 1 && node.parentId === s.tipId && userTurn && !s.thinking) {
      known = count;
      onUserMove(node.id);
    } else if (count > known) {
      // A move from somewhere else (opening book, wrong turn...) is not allowed during a game.
      viaGame(() => deleteFromHere(node.id));
      known = nodeCount(gameStore.get().tree);
    } else {
      known = count;
    }
  });
}

// --------------------------------------------------------------------- actions

export function startGame(randomFn: () => number = Math.random): void {
  const prev = playStore.get();
  clearSession();
  generation += 1;
  cancelReview();
  disposePlayEngine();
  queue.length = 0;
  records.clear();
  if (parked === null) {
    const g = gameStore.get();
    parked = { tree: g.tree, currentId: g.currentId, redoStack: g.redoStack, original: g.original };
    setPersistenceSuspended(true);
  }
  const st = prev.settings;
  const userColor: Color = st.color === 'random' ? (randomFn() < 0.5 ? 'w' : 'b') : st.color;
  const spec = specFor(st.level, st.custom);
  const headers = {
    Event: 'Play vs Stockfish',
    Site: 'Chess Analysis',
    Date: new Date().toISOString().slice(0, 10).replace(/-/g, '.'),
    White: userColor === 'w' ? 'You' : `Stockfish (${spec.label})`,
    Black: userColor === 'b' ? 'You' : `Stockfish (${spec.label})`,
    Result: '*',
  };
  const tree = createTree(START_FEN, headers);
  stopAnalysis();
  setTacticSquares([]);
  viaGame(() => gameStore.set({ tree, currentId: tree.rootId, redoStack: [], original: null }));
  known = nodeCount(tree);
  firstEngineSearch = true;
  playStore.replace({
    ...initial(st), phase: 'playing', userColor, levelLabel: spec.label, tipId: tree.rootId, orientation: userColor === 'w' ? 'white' : 'black',
    strengthNote: strengthFor(spec, null).note, message: userColor === 'w' ? 'Your move.' : 'Stockfish plays first…',
  });
  advance();
}

/** Continue the game saved by a previous visit: park the current game, rebuild the position, let the engine move if it is its turn. */
export function resumeSavedGame(): boolean {
  const saved = savedSessionStore.get().session;
  if (saved === null || playStore.get().phase !== 'off') return false;
  const game = parsePgn(saved.pgn).games[0];
  if (game === undefined) {
    clearSession();
    return false;
  }
  const tree = game.tree;
  generation += 1;
  cancelReview();
  disposePlayEngine();
  queue.length = 0;
  records.clear();
  if (parked === null) {
    const g = gameStore.get();
    parked = { tree: g.tree, currentId: g.currentId, redoStack: g.redoStack, original: g.original };
    setPersistenceSuspended(true);
  }
  const st = playStore.get().settings;
  const spec = specFor(saved.level, st.custom);
  const tip = lineEnd(tree, tree.rootId);
  stopAnalysis();
  setTacticSquares([]);
  viaGame(() => gameStore.set({ tree, currentId: tip, redoStack: [], original: null }));
  known = nodeCount(tree);
  firstEngineSearch = true;
  playStore.replace({
    ...initial({ ...st, level: saved.level }), phase: 'playing', userColor: saved.userColor, levelLabel: spec.label, tipId: tip,
    orientation: saved.userColor === 'w' ? 'white' : 'black', strengthNote: strengthFor(spec, null).note, message: 'Game resumed.',
  });
  advance();
  return true;
}

export function exitPlay(): void {
  generation += 1;
  cancelReview();
  disposePlayEngine();
  queue.length = 0;
  setTacticSquares([]);
  const p = parked;
  parked = null;
  playStore.set({ ...initial(playStore.get().settings) });
  if (p !== null) {
    viaGame(() => gameStore.set({ tree: p.tree, currentId: p.currentId, redoStack: p.redoStack, original: p.original }));
    requestReanalysis();
    setPersistenceSuspended(false);
  }
}

export function resign(): void {
  const s = playStore.get();
  if (s.phase !== 'playing') return;
  finishGame('loss', 'You resigned', s.userColor === 'w' ? '0-1' : '1-0');
}

export interface DrawAnswer { accepted: boolean; text: string }

/** The engine accepts a draw only if Stockfish (full strength) does not rate its own side as better. */
export async function offerDraw(): Promise<DrawAnswer | null> {
  const s = playStore.get();
  if (s.phase !== 'playing' || s.thinking || s.tipId === null) return null;
  const { tree } = gameStore.get();
  const fen = getNode(tree, s.tipId).fen;
  if (sideToMoveOf(fen) !== s.userColor) return null;
  const gen = generation;
  playStore.set({ message: 'Stockfish is considering your draw offer…' });
  const rec = await evaluateFen(fen);
  if (gen !== generation || playStore.get().phase !== 'playing') return null;
  if (rec === null) {
    playStore.set({ message: 'The engine could not evaluate the position, so the draw offer was not answered.' });
    return { accepted: false, text: 'The engine could not evaluate the position.' };
  }
  const engineWin = sideWinPercent(rec.score, engineColorOf(s));
  if (engineWin <= 50) {
    finishGame('draw', 'Draw by agreement', '1/2-1/2');
    return { accepted: true, text: 'Stockfish accepts the draw.' };
  }
  const text = `Stockfish declines: it rates its position as better (${formatScore(rec.score)}, depth ${rec.depth}).`;
  playStore.set({ message: text });
  return { accepted: false, text };
}

/** Practice mode only: take back your last move (and the engine's reply, if it has been played). */
export function takeBack(): boolean {
  const s = playStore.get();
  if (s.phase !== 'playing' || !s.settings.practice || s.tipId === null) return false;
  const { tree } = gameStore.get();
  const ids = mainLine(tree);
  const userMoveIdx = [...ids.keys()].reverse().find((i) => i > 0 && getNode(tree, ids[i] as string).color === s.userColor);
  if (userMoveIdx === undefined) return false;
  generation += 1; // cancels a pending engine reply
  playEngine?.stop();
  const target = ids[userMoveIdx] as string;
  const parent = getNode(tree, target).parentId as string;
  viaGame(() => deleteFromHere(target));
  viaGame(() => gameStore.set({ currentId: parent, redoStack: [] }));
  known = nodeCount(gameStore.get().tree);
  setTacticSquares([]);
  const fb = { ...s.feedback };
  for (const id of Object.keys(fb)) if (!hasNode(gameStore.get().tree, id)) delete fb[id];
  playStore.set({ tipId: parent, thinking: false, hint: null, feedback: fb, error: null, message: 'Move taken back. Your move.' });
  enqueue(getNode(gameStore.get().tree, parent).fen);
  return true;
}

export async function requestHint(): Promise<void> {
  const s = playStore.get();
  if (s.phase !== 'playing' || !s.settings.hints || s.thinking || s.tipId === null) return;
  const { tree } = gameStore.get();
  const fen = getNode(tree, s.tipId).fen;
  if (sideToMoveOf(fen) !== s.userColor) return;
  const cur = s.hint;
  if (cur !== null && cur.fen === fen && cur.content !== null) {
    const level = Math.min(3, cur.level + 1) as 1 | 2 | 3;
    playStore.set({ hint: { ...cur, level } });
    if (level === 3) setTacticSquares([cur.content.level3.from as never, cur.content.level3.to as never]);
    return;
  }
  if (cur !== null && cur.fen === fen && cur.busy) return;
  const gen = generation;
  playStore.set({ hint: { fen, level: 1, busy: true, content: null, depth: null, error: null } });
  hintBusy = true;
  try {
    const rec = await evaluateFen(fen, 14);
    if (gen !== generation || playStore.get().tipId !== s.tipId) return; // stale: the position changed meanwhile
    if (rec === null || rec.bestMove === null) throw new Error('The engine could not analyse this position.');
    const content = buildHint(fen, rec.bestPv.length > 0 ? rec.bestPv : [rec.bestMove], formatScore(rec.score));
    if (content === null) throw new Error('No hint could be built for this position.');
    playStore.set({ hint: { fen, level: 1, busy: false, content, depth: rec.depth, error: null } });
  } catch (e) {
    if (gen === generation) playStore.set({ hint: { fen, level: 0, busy: false, content: null, depth: null, error: e instanceof Error ? e.message : 'Hint failed.' } });
  } finally {
    hintBusy = false;
  }
}

/** Show the engine's preferred alternative for a feedback item on the board (highlight only; nothing is played). */
export function showAlternative(fb: MoveFeedback): void {
  if (fb.bestUci === null) return;
  setTacticSquares([fb.bestUci.slice(0, 2) as never, fb.bestUci.slice(2, 4) as never]);
}

/** Post-game: run the existing review on the finished game and build the coaching report. */
export async function analyzeGame(): Promise<void> {
  const s = playStore.get();
  if (s.phase !== 'finished' || s.review === 'running') return;
  const { tree } = gameStore.get();
  // Review the MAIN line as played, from the real start of the game.
  const signature = mainLineSignature(tree);
  playStore.set({ review: 'running', reviewError: null });
  await startReview();
  const r = reviewStore.get();
  const cur = playStore.get();
  if (cur.phase !== 'finished' || cur.recordId !== s.recordId) return;
  if (r.status !== 'done' || r.result === null || r.signature !== signature) {
    playStore.set({ review: 'error', reviewError: r.error ?? (r.status === 'cancelled' ? 'The review was cancelled.' : 'The review did not complete.') });
    return;
  }
  const report = buildCoachReport(r.result, cur.userColor);
  playStore.set({ review: 'done', report });
  if (cur.recordId !== null) addFromReview(r.result, cur.userColor, { id: cur.recordId, source: 'play', endedAt: Date.now(), label: `vs Stockfish ${cur.levelLabel}` });
  const acc = r.result.summary.accuracy[cur.userColor];
  const counts = r.result.summary.counts[cur.userColor];
  if (cur.recordId !== null) {
    attachReview(cur.recordId, {
      accuracy: acc === null || Number.isNaN(acc) ? null : acc,
      inaccuracies: counts.inaccuracy,
      mistakes: counts.mistake,
      blunders: counts.blunder,
      categories: Object.fromEntries(Object.entries(report.counts).filter(([, n]) => n > 0)),
    });
  }
}

export function resetPlayStoreForTests(): void {
  generation += 1;
  parked = null;
  internal = false;
  known = 0;
  queue.length = 0;
  records.clear();
  pumping = false;
  hintBusy = false;
  disposePlayEngine();
  opponentFactory = createBrowserEngine;
  analysisProvider = ensureEngine;
  replyDelayMs = MIN_REPLY_MS;
  playStore.replace(initial(DEFAULT_PLAY_SETTINGS));
}

export function testHooks() {
  return { records, queue, setRecord: (fen: string, rec: PositionRecord) => records.set(fen, rec) };
}

export function useOrientationOverride(): 'white' | 'black' | null {
  return usePlay((s) => s.orientation);
}

export function flipPlayBoard(): boolean {
  const o = playStore.get().orientation;
  if (o === null) return false;
  playStore.set({ orientation: o === 'white' ? 'black' : 'white' });
  return true;
}

export { updateSettings };
