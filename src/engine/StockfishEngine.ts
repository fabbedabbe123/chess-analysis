import { toWhiteScore } from '@/analysis/eval';
import {
  EngineError,
  SearchSupersededError,
  type Color,
  type EngineCapabilities,
  type EngineFlavor,
  type EngineLine,
  type EngineOptions,
  type EngineStatus,
  type SearchRequest,
  type SearchSnapshot,
  type UciInfo,
  type UciOptionSpec,
} from '@/types/engine';
import { parseBestMove, parseInfoLine, parseOptionLine } from './uci';

/** Minimal Worker surface we depend on (lets tests inject a scripted fake). */
export interface WorkerLike {
  postMessage(message: string): void;
  terminate(): void;
  addEventListener(type: 'message', listener: (ev: { data: unknown }) => void): void;
  addEventListener(type: 'error', listener: (ev: { message?: string }) => void): void;
  removeEventListener(type: 'message', listener: (ev: { data: unknown }) => void): void;
  removeEventListener(type: 'error', listener: (ev: { message?: string }) => void): void;
}

export interface EngineFiles {
  flavor: EngineFlavor;
  /** URL of the engine's .js worker script. The .wasm must sit next to it. */
  scriptUrl: string;
}

export const DEFAULT_ENGINE_OPTIONS: EngineOptions = {
  hashMb: 32,
  threads: 1,
  skillLevel: 20,
  limitStrength: false,
  elo: 2000,
  showWdl: false,
};

const INIT_TIMEOUT_MS = 20_000;

interface SearchRecord {
  id: number;
  req: SearchRequest;
  sideToMove: Color;
  settingsKey: string;
  onUpdate: ((snapshot: SearchSnapshot) => void) | undefined;
  resolve: (snapshot: SearchSnapshot) => void;
  reject: (error: Error) => void;
  linesByPv: Map<number, EngineLine>;
  snapshot: SearchSnapshot;
  /** Why we sent `stop` (if we did). Info lines after a stop are never published. */
  stopReason: 'none' | 'user' | 'superseded';
}

export interface SearchHandle {
  id: number;
  /** Resolves with the final snapshot; rejects with SearchSupersededError / EngineError. */
  result: Promise<SearchSnapshot>;
}

export function sideToMoveOf(fen: string): Color {
  return fen.split(' ')[1] === 'b' ? 'b' : 'w';
}

/** Fingerprint of everything that influences a search result (used as cache key part). */
export function makeSettingsKey(req: SearchRequest, flavor: EngineFlavor): string {
  const { limits, options } = req;
  return JSON.stringify([
    flavor,
    req.multiPv,
    limits.depth ?? null,
    limits.movetimeMs ?? null,
    limits.infinite === true,
    options.hashMb,
    flavor === 'multi' ? options.threads : 1,
    options.limitStrength ? `elo${options.elo}` : `skill${options.skillLevel}`,
  ]);
}

export function goCommand(req: SearchRequest): string {
  const { depth, movetimeMs } = req.limits;
  const parts = ['go'];
  if (depth !== undefined) parts.push('depth', String(Math.max(1, Math.floor(depth))));
  if (movetimeMs !== undefined) parts.push('movetime', String(Math.max(1, Math.floor(movetimeMs))));
  if (depth === undefined && movetimeMs === undefined) parts.push('infinite');
  return parts.join(' ');
}

function deriveCapabilities(name: string, flavor: EngineFlavor, options: UciOptionSpec[]): EngineCapabilities {
  const find = (n: string) => options.find((o) => o.name === n);
  const threads = find('Threads');
  const multipv = find('MultiPV');
  const elo = find('UCI_Elo');
  return {
    name,
    flavor,
    maxThreads: threads?.max ?? 1,
    maxMultiPv: multipv?.max ?? 1,
    supportsSkillLevel: find('Skill Level') !== undefined,
    supportsLimitStrength: find('UCI_LimitStrength') !== undefined && elo !== undefined,
    minElo: elo?.min ?? 1320,
    maxElo: elo?.max ?? 3190,
    supportsWdl: find('UCI_ShowWDL') !== undefined,
    options,
  };
}

export class StockfishEngine {
  private worker: WorkerLike | null;
  private status: EngineStatus = 'loading';
  private readonly statusListeners = new Set<(status: EngineStatus, detail?: string) => void>();
  private caps: EngineCapabilities | null = null;
  private nextSearchId = 1;
  private active: SearchRecord | null = null;
  private pending: SearchRecord | null = null;
  private applied: {
    multiPv?: number;
    hashMb?: number;
    threads?: number;
    skillLevel?: number;
    limitStrength?: boolean;
    elo?: number;
    showWdl?: boolean;
  } = {};
  private initResolve: ((caps: EngineCapabilities) => void) | null = null;
  private initReject: ((error: Error) => void) | null = null;
  private initTimer: ReturnType<typeof setTimeout> | null = null;
  private initOptions: UciOptionSpec[] = [];
  private initName = 'Stockfish';
  private readonly onMessage = (ev: { data: unknown }): void => {
    if (typeof ev.data === 'string') {
      for (const line of ev.data.split('\n')) {
        const trimmed = line.trim();
        if (trimmed.length > 0) this.handleLine(trimmed);
      }
    }
  };
  private readonly onError = (ev: { message?: string }): void => {
    this.fail(new EngineError(ev.message ?? 'The engine worker crashed', 'worker-error'));
  };

  private constructor(
    worker: WorkerLike,
    private readonly flavor: EngineFlavor,
  ) {
    this.worker = worker;
    worker.addEventListener('message', this.onMessage);
    worker.addEventListener('error', this.onError);
  }

  /**
   * Start a worker and complete the UCI handshake (`uci` -> `uciok`, `isready` -> `readyok`).
   * Rejects with `EngineError` on timeout or worker failure.
   */
  static create(files: EngineFiles, workerFactory: (url: string) => WorkerLike): Promise<StockfishEngine> {
    let worker: WorkerLike;
    try {
      worker = workerFactory(files.scriptUrl);
    } catch (error) {
      return Promise.reject(
        new EngineError(error instanceof Error ? error.message : 'Could not start the engine worker', 'worker-error'),
      );
    }
    const engine = new StockfishEngine(worker, files.flavor);
    return engine.handshake().then(() => engine);
  }

  private handshake(): Promise<EngineCapabilities> {
    return new Promise<EngineCapabilities>((resolve, reject) => {
      this.initResolve = resolve;
      this.initReject = reject;
      this.initTimer = setTimeout(() => {
        this.fail(new EngineError('The engine did not respond in time (is the WASM file reachable?)', 'init-timeout'));
      }, INIT_TIMEOUT_MS);
      this.send('uci');
    });
  }

  getStatus(): EngineStatus {
    return this.status;
  }

  getCapabilities(): EngineCapabilities {
    if (this.caps === null) throw new EngineError('Engine is not ready', 'not-ready');
    return this.caps;
  }

  subscribeStatus(listener: (status: EngineStatus, detail?: string) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  /**
   * Request a search. If one is running it is stopped first (`stop` -> wait for its
   * `bestmove`) and only the NEWEST pending request is kept, so rapid navigation
   * never queues stale work or restarts the engine more than necessary.
   */
  search(req: SearchRequest, onUpdate?: (snapshot: SearchSnapshot) => void): SearchHandle {
    const id = this.nextSearchId++;
    let resolve!: (s: SearchSnapshot) => void;
    let reject!: (e: Error) => void;
    const result = new Promise<SearchSnapshot>((res, rej) => {
      resolve = res;
      reject = rej;
    });

    if (this.worker === null || this.caps === null || this.status === 'error' || this.status === 'terminated') {
      reject(new EngineError('Engine is not available', this.status === 'terminated' ? 'terminated' : 'not-ready'));
      return { id, result };
    }

    const sideToMove = sideToMoveOf(req.fen);
    const settingsKey = makeSettingsKey(req, this.flavor);
    const record: SearchRecord = {
      id,
      req,
      sideToMove,
      settingsKey,
      onUpdate,
      resolve,
      reject,
      linesByPv: new Map(),
      stopReason: 'none',
      snapshot: {
        searchId: id,
        fen: req.fen,
        sideToMove,
        lines: [],
        depth: 0,
        nodes: 0,
        nps: 0,
        timeMs: 0,
        done: false,
        bestMove: null,
        ponder: null,
        settingsKey,
      },
    };

    // Coalesce: a newer request replaces any older one that is still waiting.
    if (this.pending !== null) {
      this.pending.reject(new SearchSupersededError());
      this.pending = null;
    }

    if (this.active === null) {
      this.begin(record);
    } else {
      this.pending = record;
      if (this.active.stopReason === 'none') {
        this.active.stopReason = 'superseded';
        this.send('stop');
      }
    }
    return { id, result };
  }

  /** Stop the running search (its result resolves with endReason `stopped`) and drop any waiting request. */
  stop(): void {
    if (this.pending !== null) {
      this.pending.reject(new SearchSupersededError());
      this.pending = null;
    }
    if (this.active !== null && this.active.stopReason === 'none') {
      this.active.stopReason = 'user';
      this.send('stop');
    }
  }

  terminate(): void {
    this.failPending(new EngineError('Engine terminated', 'terminated'));
    this.cleanupWorker();
    this.setStatus('terminated');
  }

  // ---------------------------------------------------------------- internals

  private send(command: string): void {
    this.worker?.postMessage(command);
  }

  private setStatus(status: EngineStatus, detail?: string): void {
    this.status = status;
    for (const listener of this.statusListeners) listener(status, detail);
  }

  private cleanupWorker(): void {
    if (this.initTimer !== null) {
      clearTimeout(this.initTimer);
      this.initTimer = null;
    }
    if (this.worker !== null) {
      this.worker.removeEventListener('message', this.onMessage);
      this.worker.removeEventListener('error', this.onError);
      this.worker.terminate();
      this.worker = null;
    }
  }

  private failPending(error: Error): void {
    if (this.initReject !== null) {
      this.initReject(error);
      this.initReject = null;
      this.initResolve = null;
    }
    if (this.active !== null) {
      this.active.reject(error);
      this.active = null;
    }
    if (this.pending !== null) {
      this.pending.reject(error);
      this.pending = null;
    }
  }

  private fail(error: EngineError): void {
    this.failPending(error);
    this.cleanupWorker();
    this.setStatus('error', error.message);
  }

  private handleLine(line: string): void {
    // --- handshake phase
    if (this.initResolve !== null || this.caps === null) {
      if (line.startsWith('id name ')) {
        this.initName = line.slice('id name '.length);
      } else if (line.startsWith('option ')) {
        const spec = parseOptionLine(line);
        if (spec !== null) this.initOptions.push(spec);
      } else if (line === 'uciok') {
        this.caps = deriveCapabilities(this.initName, this.flavor, this.initOptions);
        this.send('isready');
      } else if (line === 'readyok' && this.caps !== null) {
        if (this.initTimer !== null) {
          clearTimeout(this.initTimer);
          this.initTimer = null;
        }
        const resolve = this.initResolve;
        this.initResolve = null;
        this.initReject = null;
        this.setStatus('ready');
        resolve?.(this.caps);
      }
      return;
    }

    if (line.startsWith('bestmove')) {
      this.onBestMove(line);
      return;
    }
    if (line.startsWith('info ')) {
      const info = parseInfoLine(line);
      if (info !== null) this.onInfo(info);
    }
  }

  private begin(record: SearchRecord): void {
    this.active = record;
    this.setStatus('searching');
    const { req } = record;
    this.applyOptions(req);
    if (req.newGame === true) this.send('ucinewgame');
    this.send(`position fen ${req.fen}`);
    this.send(goCommand(req));
  }

  private applyOptions(req: SearchRequest): void {
    const caps = this.caps;
    if (caps === null) return;
    const o = req.options;
    const set = (name: string, value: string | number | boolean) => this.send(`setoption name ${name} value ${String(value)}`);

    const multiPv = Math.max(1, Math.min(caps.maxMultiPv, Math.floor(req.multiPv)));
    if (this.applied.multiPv !== multiPv) {
      set('MultiPV', multiPv);
      this.applied.multiPv = multiPv;
    }
    const hash = Math.max(1, Math.floor(o.hashMb));
    if (this.applied.hashMb !== hash) {
      set('Hash', hash);
      this.applied.hashMb = hash;
    }
    const threads = Math.max(1, Math.min(caps.maxThreads, Math.floor(o.threads)));
    if (caps.maxThreads > 1 && this.applied.threads !== threads) {
      set('Threads', threads);
      this.applied.threads = threads;
    }
    if (caps.supportsWdl && this.applied.showWdl !== o.showWdl) {
      set('UCI_ShowWDL', o.showWdl);
      this.applied.showWdl = o.showWdl;
    }
    if (caps.supportsLimitStrength && this.applied.limitStrength !== o.limitStrength) {
      set('UCI_LimitStrength', o.limitStrength);
      this.applied.limitStrength = o.limitStrength;
    }
    if (o.limitStrength && caps.supportsLimitStrength) {
      const elo = Math.max(caps.minElo, Math.min(caps.maxElo, Math.floor(o.elo)));
      if (this.applied.elo !== elo) {
        set('UCI_Elo', elo);
        this.applied.elo = elo;
      }
    } else if (caps.supportsSkillLevel) {
      const skill = Math.max(0, Math.min(20, Math.floor(o.skillLevel)));
      if (this.applied.skillLevel !== skill) {
        set('Skill Level', skill);
        this.applied.skillLevel = skill;
      }
    }
  }

  private onInfo(info: UciInfo): void {
    const rec = this.active;
    // Anything printed after we asked the engine to stop belongs to a search nobody wants anymore.
    if (rec === null || rec.stopReason !== 'none') return;

    const snap = rec.snapshot;
    // Aggregate counters always advance, even for bound-only lines.
    if (info.nodes !== undefined) snap.nodes = info.nodes;
    if (info.nps !== undefined) snap.nps = info.nps;
    if (info.timeMs !== undefined) snap.timeMs = info.timeMs;
    if (info.hashfull !== undefined) snap.hashfull = info.hashfull;

    // Lower/upper-bound lines are aspiration-window fail-highs/lows, not settled scores.
    if (info.bound === 'exact') {
      const line: EngineLine = {
        multipv: info.multipv,
        depth: info.depth,
        scoreWhite: toWhiteScore(info.score, rec.sideToMove),
        bound: info.bound,
        pv: info.pv,
      };
      if (info.seldepth !== undefined) line.seldepth = info.seldepth;
      if (info.nodes !== undefined) line.nodes = info.nodes;
      if (info.nps !== undefined) line.nps = info.nps;
      if (info.timeMs !== undefined) line.timeMs = info.timeMs;
      if (info.wdl !== undefined) {
        const [w, d, l] = info.wdl;
        line.wdlWhite = rec.sideToMove === 'w' ? [w, d, l] : [l, d, w];
      }
      rec.linesByPv.set(info.multipv, line);
      const lines = [...rec.linesByPv.values()].sort((a, b) => a.multipv - b.multipv);
      snap.lines = lines;
      const top = lines[0];
      if (top !== undefined) {
        snap.depth = top.depth;
        if (top.seldepth !== undefined) snap.seldepth = top.seldepth;
      }
    }
    rec.onUpdate?.({ ...snap, lines: snap.lines });
  }

  private onBestMove(line: string): void {
    const parsed = parseBestMove(line);
    const rec = this.active;
    if (parsed === null || rec === null) return; // stray bestmove (e.g. after terminate)

    this.active = null;
    if (rec.stopReason === 'superseded') {
      rec.reject(new SearchSupersededError());
    } else {
      const snap = rec.snapshot;
      snap.done = true;
      snap.endReason = rec.stopReason === 'user' ? 'stopped' : 'completed';
      snap.bestMove = parsed.move;
      snap.ponder = parsed.ponder;
      const final: SearchSnapshot = { ...snap, lines: snap.lines };
      rec.onUpdate?.(final);
      rec.resolve(final);
    }

    const next = this.pending;
    this.pending = null;
    if (next !== null) {
      this.begin(next);
    } else {
      this.setStatus('ready');
    }
  }
}

/** Decide which Stockfish build to load in this browser. */
export function chooseEngineFiles(baseUrl: string, env: { crossOriginIsolated: boolean; cores: number }): EngineFiles {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  if (env.crossOriginIsolated && env.cores >= 3) {
    return { flavor: 'multi', scriptUrl: `${base}engine/stockfish-19-lite.js` };
  }
  return { flavor: 'single', scriptUrl: `${base}engine/stockfish-19-lite-single.js` };
}

export function singleThreadedFiles(baseUrl: string): EngineFiles {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return { flavor: 'single', scriptUrl: `${base}engine/stockfish-19-lite-single.js` };
}

/**
 * Create an engine in the browser: prefers the multi-threaded build when the page is
 * cross-origin isolated, and silently falls back to the single-threaded build if it
 * fails to start.
 */
export async function createBrowserEngine(baseUrl: string = import.meta.env.BASE_URL): Promise<StockfishEngine> {
  const factory = (url: string): WorkerLike => new Worker(url) as unknown as WorkerLike;
  const files = chooseEngineFiles(baseUrl, {
    crossOriginIsolated: typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated,
    cores: typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 1 : 1,
  });
  try {
    return await StockfishEngine.create(files, factory);
  } catch (error) {
    if (files.flavor === 'multi') {
      console.warn('[engine] multi-threaded build failed, falling back to single-threaded:', error);
      return StockfishEngine.create(singleThreadedFiles(baseUrl), factory);
    }
    throw error;
  }
}
