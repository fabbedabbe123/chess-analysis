import { EvalCache, ReviewAbortedError, runReview, type ReviewResult } from '@/analysis/review';
import { bookContinuations, loadOpeningBook } from '@/analysis/openings';
import { createBrowserEngine, type StockfishEngine } from '@/engine/StockfishEngine';
import { stripClockTags } from '@/chesscom/api';
import { parsePgn } from '@/pgn/pgn';
import { gameFromReview, MAX_ANALYSED, sanitizeAnalysed, type AnalysedGame, type GameSource } from '@/strength/strength';
import { storageGet, storageSet } from '@/utils/storage';
import type { Color } from '@/types/game';
import { createStore, useStore } from './createStore';
import { engineOptionsFrom, settingsStore } from './settingsStore';
import { lichessStore } from './lichessStore';
import { trackerStore } from './trackerStore';

const KEY = 'chess-analysis:strength-games:v1';
/** Batch analysis never goes deeper than this: a game takes about a minute at this depth in the browser. */
export const BATCH_MAX_DEPTH = 14;

export function parseAnalysed(text: string | null): AnalysedGame[] {
  if (text === null) return [];
  try {
    const raw = JSON.parse(text) as unknown;
    return Array.isArray(raw) ? raw.map(sanitizeAnalysed).filter((g): g is AnalysedGame => g !== null).slice(0, MAX_ANALYSED) : [];
  } catch {
    return [];
  }
}

export interface StrengthState {
  games: AnalysedGame[];
  saveFailed: boolean;
  batch: { status: 'idle' | 'running'; done: number; total: number; currentPly: number; currentPlies: number; error: string | null; note: string | null };
}

export const strengthStore = createStore<StrengthState>({
  games: parseAnalysed(storageGet(KEY)),
  saveFailed: false,
  batch: { status: 'idle', done: 0, total: 0, currentPly: 0, currentPlies: 0, error: null, note: null },
});
export const useStrength = <S,>(sel: (s: StrengthState) => S): S => useStore(strengthStore, sel);

function persist(): void {
  strengthStore.set({ saveFailed: !storageSet(KEY, JSON.stringify(strengthStore.get().games)) });
}

export function addAnalysedGame(game: AnalysedGame): void {
  strengthStore.set((s) => ({ games: [game, ...s.games.filter((g) => g.id !== game.id)].sort((a, b) => b.endedAt - a.endedAt).slice(0, MAX_ANALYSED) }));
  persist();
}

export function removeAnalysedGame(id: string): void {
  strengthStore.set((s) => ({ games: s.games.filter((g) => g.id !== id) }));
  persist();
}

export function clearAnalysedGames(): void {
  strengthStore.set({ games: [] });
  persist();
}

/** Removes the analysed games that came from one source (e.g. one tracked account). */
export function clearAnalysedBySource(source: AnalysedGame['source']): void {
  strengthStore.set((s) => ({ games: s.games.filter((g) => g.source !== source) }));
  persist();
}

/** Record a finished review of the main-board game as one of the user's games. */
export function addFromReview(
  result: ReviewResult,
  userColor: Color,
  meta: { id: string; source: GameSource; endedAt: number; label: string; myRating?: number | null },
): boolean {
  const g = gameFromReview(result, userColor, meta);
  if (g === null) return false;
  addAnalysedGame(g);
  return true;
}

// ------------------------------------------------------- batch: recent Chess.com games

let abort: AbortController | null = null;
let engine: StockfishEngine | null = null;
const cache = new EvalCache();

export function cancelBatch(): void {
  abort?.abort();
}

/** Tracked Chess.com and Lichess games that have not been analysed yet, newest first. */
export function unanalysedTracked(): ReturnType<typeof trackerStore.get>['games'] {
  const done = new Set(strengthStore.get().games.map((g) => g.id));
  return [...trackerStore.get().games, ...lichessStore.get().games]
    .filter((g) => !done.has(g.url))
    .sort((a, b) => b.endTime - a.endTime);
}

/**
 * Analyse the newest `count` not-yet-analysed tracked Chess.com games with a dedicated engine (real Stockfish, same review
 * as the Review tab), one game at a time. Each finished game is saved immediately, so cancelling keeps what is done.
 */
export async function analyseTrackedGames(count: number): Promise<void> {
  if (strengthStore.get().batch.status === 'running') return;
  const todo = unanalysedTracked().slice(0, Math.max(1, count));
  if (todo.length === 0) {
    strengthStore.set((s) => ({ batch: { ...s.batch, error: null, note: 'No new tracked games to analyse. Sync your Chess.com or Lichess games in the Player tab first.' } }));
    return;
  }
  const settings = settingsStore.get();
  const depth = Math.min(settings.reviewDepth, BATCH_MAX_DEPTH);
  abort = new AbortController();
  const signal = abort.signal;
  strengthStore.set({ batch: { status: 'running', done: 0, total: todo.length, currentPly: 0, currentPlies: 0, error: null, note: null } });
  let analysed = 0;
  let skipped = 0;
  try {
    engine ??= await createBrowserEngine();
    const book = await loadOpeningBook().catch(() => null);
    for (const tg of todo) {
      if (signal.aborted) throw new ReviewAbortedError();
      const parsed = parsePgn(stripClockTags(tg.pgn)).games[0];
      if (parsed === undefined) { skipped += 1; continue; }
      const result = await runReview({
        tree: parsed.tree,
        engine,
        depth,
        options: engineOptionsFrom(settings),
        thresholds: settings.thresholds,
        cache,
        isBookMove: book === null ? undefined : (fen, uci) => bookContinuations(book, fen).some((m) => m.uci === uci),
        settingsKey: `strength|mpv2|${engine.getCapabilities().flavor}|d${depth}|h${settings.hashMb}`,
        signal,
        onProgress: (d, t) => strengthStore.set((s) => ({ batch: { ...s.batch, currentPly: d, currentPlies: t } })),
      });
      const label = `vs ${tg.opponent}${tg.opponentRating !== null ? ` (${tg.opponentRating})` : ''} · ${tg.timeClass}`;
      if (addFromReview(result, tg.color, { id: tg.url, source: tg.source === 'lichess' ? 'lichess' : 'chesscom', endedAt: tg.endTime * 1000, label, myRating: tg.rated === false ? null : tg.rating })) analysed += 1;
      else skipped += 1;
      strengthStore.set((s) => ({ batch: { ...s.batch, done: s.batch.done + 1, currentPly: 0, currentPlies: 0 } }));
    }
    strengthStore.set((s) => ({ batch: { ...s.batch, status: 'idle', note: `Analysed ${analysed} game${analysed === 1 ? '' : 's'}${skipped > 0 ? ` (${skipped} skipped: no usable moves)` : ''}.` } }));
  } catch (error) {
    if (error instanceof ReviewAbortedError) {
      strengthStore.set((s) => ({ batch: { ...s.batch, status: 'idle', note: `Stopped. ${analysed} game${analysed === 1 ? '' : 's'} analysed and saved.` } }));
      return;
    }
    // A crashed worker must not poison the next attempt.
    engine?.terminate();
    engine = null;
    strengthStore.set((s) => ({ batch: { ...s.batch, status: 'idle', error: error instanceof Error ? error.message : 'The analysis failed.' } }));
  }
}

export function disposeStrengthEngine(): void {
  engine?.terminate();
  engine = null;
}
