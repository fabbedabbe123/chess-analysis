import { terminalScore } from '@/analysis/review';
import { createBrowserEngine, makeSettingsKey, type StockfishEngine } from '@/engine/StockfishEngine';
import {
  SearchSupersededError,
  type EngineCapabilities,
  type EngineOptions,
  type EngineStatus,
  type SearchLimits,
  type SearchRequest,
  type SearchSnapshot,
  type WhiteScore,
} from '@/types/engine';
import { createStore, useStore } from './createStore';

/**
 * Live-analysis engine. One worker for the whole app; every request for a position
 * supersedes the previous one (see StockfishEngine.search). The store additionally
 * guarantees that the published `snapshot` always belongs to `requestedFen`, so the
 * evaluation bar and the candidate lines can never show another position's numbers.
 */

export interface EngineState {
  status: EngineStatus;
  error: string | null;
  capabilities: EngineCapabilities | null;
  /** Position the user is looking at and that `snapshot` describes. */
  requestedFen: string | null;
  snapshot: SearchSnapshot | null;
  /** Score of positions that need no search (checkmate, stalemate, dead draw). */
  terminal: WhiteScore | null;
  analyzing: boolean;
  /** True when `snapshot` came from the evaluation cache instead of a fresh search. */
  fromCache: boolean;
}

export const engineStore = createStore<EngineState>({
  status: 'idle',
  error: null,
  capabilities: null,
  requestedFen: null,
  snapshot: null,
  terminal: null,
  analyzing: false,
  fromCache: false,
});

export function useEngine<S>(selector: (state: EngineState) => S): S {
  return useStore(engineStore, selector);
}

let engine: StockfishEngine | null = null;
let initPromise: Promise<StockfishEngine> | null = null;
let token = 0;

/** Only COMPLETED searches are cached; the key includes the search settings (never interchangeable). */
const cache = new Map<string, SearchSnapshot>();
const CACHE_LIMIT = 300;

function cacheKey(fen: string, settingsKey: string): string {
  return `${settingsKey}#${fen}`;
}

function remember(snapshot: SearchSnapshot): void {
  if (!snapshot.done || snapshot.endReason !== 'completed' || snapshot.lines.length === 0) return;
  const key = cacheKey(snapshot.fen, snapshot.settingsKey);
  cache.delete(key);
  cache.set(key, snapshot);
  if (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
}

export function clearEvalCache(): void {
  cache.clear();
}

export function ensureEngine(): Promise<StockfishEngine> {
  if (engine !== null && engine.getStatus() !== 'error' && engine.getStatus() !== 'terminated') {
    return Promise.resolve(engine);
  }
  if (initPromise !== null) return initPromise;

  engineStore.set({ status: 'loading', error: null });
  initPromise = createBrowserEngine()
    .then((created) => {
      engine = created;
      created.subscribeStatus((status, detail) => {
        if (engine !== created) return;
        engineStore.set({
          status,
          analyzing: status === 'searching',
          ...(status === 'error' ? { error: detail ?? 'The engine stopped unexpectedly.' } : {}),
        });
      });
      engineStore.set({ status: 'ready', capabilities: created.getCapabilities(), error: null });
      return created;
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : 'The engine could not be started.';
      engineStore.set({ status: 'error', error: message });
      throw error;
    })
    .finally(() => {
      initPromise = null;
    });
  return initPromise;
}

/** Drop the worker (e.g. after a crash) so the next `analyze` starts a fresh one. */
export function restartEngine(): void {
  token += 1;
  engine?.terminate();
  engine = null;
  initPromise = null;
  cache.clear();
  engineStore.set({ status: 'idle', error: null, snapshot: null, analyzing: false, fromCache: false });
}

export function terminateEngine(): void {
  token += 1;
  engine?.terminate();
  engine = null;
  initPromise = null;
  engineStore.set({ status: 'terminated', analyzing: false });
}

export interface AnalyzeParams {
  fen: string;
  multiPv: number;
  limits: SearchLimits;
  options: EngineOptions;
}

/** Analyse `fen`. Any earlier analysis is superseded; results for older positions are discarded. */
export async function analyze(params: AnalyzeParams): Promise<void> {
  const myToken = ++token;
  const { fen } = params;

  // Position changed: never keep showing the previous position's numbers.
  const terminal = terminalScore(fen);
  if (terminal !== null) {
    engine?.stop();
    engineStore.set({ requestedFen: fen, snapshot: null, terminal, analyzing: false, fromCache: false });
    return;
  }
  engineStore.set({ requestedFen: fen, terminal: null });

  let eng: StockfishEngine;
  try {
    eng = await ensureEngine();
  } catch {
    return; // error state already published
  }
  if (myToken !== token) return; // a newer request arrived while the engine was loading

  const request: SearchRequest = { fen, multiPv: params.multiPv, limits: params.limits, options: params.options };
  const key = makeSettingsKey(request, eng.getCapabilities().flavor);
  const cached = cache.get(cacheKey(fen, key));
  if (cached !== undefined) {
    eng.stop();
    engineStore.set({ snapshot: cached, analyzing: false, fromCache: true });
    return;
  }

  engineStore.set({ snapshot: null, analyzing: true, fromCache: false });
  const handle = eng.search(request, (snapshot) => {
    if (myToken !== token || snapshot.fen !== engineStore.get().requestedFen) return;
    engineStore.set({ snapshot, analyzing: !snapshot.done });
  });
  handle.result
    .then((final) => {
      if (myToken !== token) return;
      remember(final);
      engineStore.set({ snapshot: final, analyzing: false });
    })
    .catch((error: unknown) => {
      if (error instanceof SearchSupersededError) return; // expected during navigation
      if (myToken !== token) return;
      engineStore.set({ analyzing: false, error: error instanceof Error ? error.message : 'Analysis failed' });
    });
}

/** Stop the running analysis; the last result stays visible. */
export function stopAnalysis(): void {
  token += 1;
  engine?.stop();
  engineStore.set({ analyzing: false });
}

/** Score to show for the selected position (terminal result, or the engine's top line). */
export function headlineScore(state: EngineState, fen: string): WhiteScore | null {
  if (state.requestedFen !== fen) return null;
  if (state.terminal !== null) return state.terminal;
  return state.snapshot?.lines[0]?.scoreWhite ?? null;
}
