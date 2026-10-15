import { EvalCache, ReviewAbortedError, runReview, type ReviewResult } from '@/analysis/review';
import { bookContinuations, loadOpeningBook } from '@/analysis/openings';
import { mainLine, getNode, startFenOf } from '@/chess/gameTree';
import { createBrowserEngine, type StockfishEngine } from '@/engine/StockfishEngine';
import type { GameTree } from '@/types/game';
import { createStore, useStore } from './createStore';
import { gameStore } from './gameStore';
import { engineOptionsFrom, settingsStore } from './settingsStore';

export type ReviewStatus = 'idle' | 'running' | 'done' | 'cancelled' | 'error';

export interface ReviewState {
  status: ReviewStatus;
  progress: { done: number; total: number };
  result: ReviewResult | null;
  /** Fingerprint of the main line that `result` describes. */
  signature: string | null;
  error: string | null;
}

export const reviewStore = createStore<ReviewState>({
  status: 'idle',
  progress: { done: 0, total: 0 },
  result: null,
  signature: null,
  error: null,
});

export function useReview<S>(selector: (s: ReviewState) => S): S {
  return useStore(reviewStore, selector);
}

/** Identifies the main line (start position + moves) so stale reviews can be detected. */
export function mainLineSignature(tree: GameTree): string {
  return `${startFenOf(tree)}|${mainLine(tree)
    .map((id) => getNode(tree, id).uci)
    .join(' ')}`;
}

const cache = new EvalCache();
let abort: AbortController | null = null;
let reviewEngine: StockfishEngine | null = null;

export function cancelReview(): void {
  abort?.abort();
}

/** Review the MAIN line of the current game with a dedicated engine instance (live analysis stays usable). */
export async function startReview(): Promise<void> {
  if (reviewStore.get().status === 'running') return;
  const { tree } = gameStore.get();
  const settings = settingsStore.get();
  const signature = mainLineSignature(tree);
  abort = new AbortController();
  reviewStore.set({ status: 'running', progress: { done: 0, total: mainLine(tree).length }, error: null, result: null, signature: null });
  try {
    reviewEngine ??= await createBrowserEngine();
    const book = await loadOpeningBook().catch(() => null);
    const engine = reviewEngine;
    const result = await runReview({
      tree,
      engine,
      depth: settings.reviewDepth,
      options: engineOptionsFrom(settings),
      thresholds: settings.thresholds,
      cache,
      isBookMove: book === null ? undefined : (fen, uci) => bookContinuations(book, fen).some((m) => m.uci === uci),
      settingsKey: `review|mpv2|${engine.getCapabilities().flavor}|d${settings.reviewDepth}|h${settings.hashMb}`,
      signal: abort.signal,
      onProgress: (done, total) => reviewStore.set({ progress: { done, total } }),
    });
    reviewStore.set({ status: 'done', result, signature });
  } catch (error) {
    if (error instanceof ReviewAbortedError) {
      reviewStore.set({ status: 'cancelled' });
      return;
    }
    // A crashed review worker must not poison the next attempt.
    reviewEngine?.terminate();
    reviewEngine = null;
    reviewStore.set({ status: 'error', error: error instanceof Error ? error.message : 'The review failed.' });
  }
}

export function disposeReviewEngine(): void {
  reviewEngine?.terminate();
  reviewEngine = null;
}
