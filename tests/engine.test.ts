import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  chooseEngineFiles,
  DEFAULT_ENGINE_OPTIONS,
  goCommand,
  makeSettingsKey,
  StockfishEngine,
  type WorkerLike,
} from '@/engine/StockfishEngine';
import {
  EngineError,
  SearchSupersededError,
  type EngineOptions,
  type SearchRequest,
  type SearchSnapshot,
} from '@/types/engine';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
const OTHER = 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3';

/** A worker that speaks just enough UCI for the handshake; tests emit search output by hand. */
class FakeWorker implements WorkerLike {
  sent: string[] = [];
  terminated = false;
  autoHandshake = true;
  private messageListeners = new Set<(ev: { data: unknown }) => void>();
  private errorListeners = new Set<(ev: { message?: string }) => void>();

  postMessage(message: string): void {
    this.sent.push(message);
    if (!this.autoHandshake) return;
    if (message === 'uci') {
      this.emit('id name Stockfish 19 Lite WASM');
      this.emit('option name Threads type spin default 1 min 1 max 1');
      this.emit('option name Hash type spin default 16 min 1 max 33554432');
      this.emit('option name MultiPV type spin default 1 min 1 max 256');
      this.emit('option name Skill Level type spin default 20 min 0 max 20');
      this.emit('option name UCI_LimitStrength type check default false');
      this.emit('option name UCI_Elo type spin default 1320 min 1320 max 3190');
      this.emit('option name UCI_ShowWDL type check default false');
      this.emit('uciok');
    } else if (message === 'isready') {
      this.emit('readyok');
    }
  }

  terminate(): void {
    this.terminated = true;
  }

  addEventListener(type: 'message' | 'error', listener: never): void {
    if (type === 'message') this.messageListeners.add(listener);
    else this.errorListeners.add(listener);
  }

  removeEventListener(type: 'message' | 'error', listener: never): void {
    if (type === 'message') this.messageListeners.delete(listener);
    else this.errorListeners.delete(listener);
  }

  emit(line: string): void {
    for (const l of [...this.messageListeners]) l({ data: line });
  }

  crash(message: string): void {
    for (const l of [...this.errorListeners]) l({ message });
  }

  /** Commands sent since (and excluding) the last `go`/`stop`-free index. */
  commandsAfter(marker: string): string[] {
    const index = this.sent.lastIndexOf(marker);
    return index === -1 ? [] : this.sent.slice(index + 1);
  }
}

const FILES = { flavor: 'single' as const, scriptUrl: '/engine/stockfish-19-lite-single.js' };

async function makeEngine(): Promise<{ engine: StockfishEngine; worker: FakeWorker }> {
  const worker = new FakeWorker();
  const engine = await StockfishEngine.create(FILES, () => worker);
  return { engine, worker };
}

function request(fen: string, overrides: Partial<SearchRequest> = {}): SearchRequest {
  return {
    fen,
    multiPv: 1,
    limits: { depth: 12 },
    options: DEFAULT_ENGINE_OPTIONS,
    ...overrides,
  };
}

const info = (depth: number, score: string, pv: string, multipv = 1) =>
  `info depth ${depth} seldepth ${depth + 3} multipv ${multipv} score ${score} nodes ${depth * 1000} nps 100000 hashfull 5 time ${depth * 10} pv ${pv}`;

describe('handshake', () => {
  it('performs uci -> uciok -> isready -> readyok and reads capabilities', async () => {
    const { engine, worker } = await makeEngine();
    expect(worker.sent.slice(0, 2)).toEqual(['uci', 'isready']);
    expect(engine.getStatus()).toBe('ready');
    const caps = engine.getCapabilities();
    expect(caps.name).toBe('Stockfish 19 Lite WASM');
    expect(caps).toMatchObject({
      flavor: 'single',
      maxThreads: 1,
      maxMultiPv: 256,
      supportsSkillLevel: true,
      supportsLimitStrength: true,
      minElo: 1320,
      maxElo: 3190,
      supportsWdl: true,
    });
  });

  describe('failures', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('rejects with init-timeout and terminates the worker when the engine never answers', async () => {
      const worker = new FakeWorker();
      worker.autoHandshake = false;
      const created = StockfishEngine.create(FILES, () => worker);
      const assertion = expect(created).rejects.toMatchObject({ name: 'EngineError', code: 'init-timeout' });
      await vi.advanceTimersByTimeAsync(20_001);
      await assertion;
      expect(worker.terminated).toBe(true);
    });

    it('rejects with worker-error when the worker crashes during start-up', async () => {
      const worker = new FakeWorker();
      worker.autoHandshake = false;
      const created = StockfishEngine.create(FILES, () => worker);
      worker.crash('Failed to fetch wasm');
      await expect(created).rejects.toMatchObject({ code: 'worker-error', message: 'Failed to fetch wasm' });
      expect(worker.terminated).toBe(true);
    });
  });

  it('rejects when the worker cannot even be constructed', async () => {
    await expect(
      StockfishEngine.create(FILES, () => {
        throw new Error('SecurityError');
      }),
    ).rejects.toMatchObject({ code: 'worker-error' });
  });
});

describe('searching', () => {
  it('sends options, position and go in order', async () => {
    const { engine, worker } = await makeEngine();
    engine.search(request(START, { multiPv: 3, limits: { depth: 15 } }));
    const after = worker.commandsAfter('isready');
    // The first search pins every option to a known value instead of trusting engine defaults.
    expect(after).toEqual([
      'setoption name MultiPV value 3',
      'setoption name Hash value 32',
      'setoption name UCI_ShowWDL value false',
      'setoption name UCI_LimitStrength value false',
      'setoption name Skill Level value 20',
      `position fen ${START}`,
      'go depth 15',
    ]);
  });

  it('only re-sends options that changed', async () => {
    const { engine, worker } = await makeEngine();
    const a = engine.search(request(START, { multiPv: 2 }));
    worker.emit('bestmove e2e4');
    await a.result;
    const before = worker.sent.length;
    engine.search(request(AFTER_E4, { multiPv: 2 }));
    expect(worker.sent.slice(before)).toEqual([`position fen ${AFTER_E4}`, 'go depth 12']);
    worker.emit('bestmove e7e5');
    engine.search(request(START, { multiPv: 4 }));
    expect(worker.sent.at(-3)).toBe('setoption name MultiPV value 4');
  });

  it('uses UCI_LimitStrength + UCI_Elo when strength is limited, Skill Level otherwise', async () => {
    const { engine, worker } = await makeEngine();
    const limited: EngineOptions = { ...DEFAULT_ENGINE_OPTIONS, limitStrength: true, elo: 1800 };
    engine.search(request(START, { options: limited }));
    expect(worker.sent).toContain('setoption name UCI_LimitStrength value true');
    expect(worker.sent).toContain('setoption name UCI_Elo value 1800');
    expect(worker.sent).not.toContain('setoption name Skill Level value 20');
  });

  it('clamps Elo and MultiPV into the ranges the engine reports', async () => {
    const { engine, worker } = await makeEngine();
    engine.search(request(START, { multiPv: 9999, options: { ...DEFAULT_ENGINE_OPTIONS, limitStrength: true, elo: 100 } }));
    expect(worker.sent).toContain('setoption name MultiPV value 256');
    expect(worker.sent).toContain('setoption name UCI_Elo value 1320');
  });

  it('never sends Threads to a single-threaded build', async () => {
    const { engine, worker } = await makeEngine();
    engine.search(request(START, { options: { ...DEFAULT_ENGINE_OPTIONS, threads: 8 } }));
    expect(worker.sent.some((c) => c.includes('Threads'))).toBe(false);
  });

  it('builds go commands for depth, movetime, both, and infinite', () => {
    expect(goCommand(request(START, { limits: { depth: 20 } }))).toBe('go depth 20');
    expect(goCommand(request(START, { limits: { movetimeMs: 1500 } }))).toBe('go movetime 1500');
    expect(goCommand(request(START, { limits: { depth: 18, movetimeMs: 3000 } }))).toBe('go depth 18 movetime 3000');
    expect(goCommand(request(START, { limits: { infinite: true } }))).toBe('go infinite');
    expect(goCommand(request(START, { limits: {} }))).toBe('go infinite');
  });

  it('publishes progressive snapshots and resolves with the final one on bestmove', async () => {
    const { engine, worker } = await makeEngine();
    const updates: SearchSnapshot[] = [];
    const handle = engine.search(request(START), (s) => updates.push(s));
    expect(engine.getStatus()).toBe('searching');

    worker.emit(info(8, 'cp 30', 'e2e4 e7e5'));
    worker.emit(info(12, 'cp 35', 'e2e4 e7e5 g1f3'));
    worker.emit('bestmove e2e4 ponder e7e5');
    const final = await handle.result;

    expect(updates.length).toBe(3); // two infos + the final snapshot
    expect(updates[0]?.done).toBe(false);
    expect(updates[0]?.depth).toBe(8);
    expect(final).toMatchObject({
      done: true,
      endReason: 'completed',
      bestMove: 'e2e4',
      ponder: 'e7e5',
      depth: 12,
      fen: START,
      sideToMove: 'w',
    });
    expect(final.lines[0]?.pv).toEqual(['e2e4', 'e7e5', 'g1f3']);
    expect(final.nodes).toBe(12_000);
    expect(final.nps).toBe(100_000);
    expect(engine.getStatus()).toBe('ready');
  });

  it('converts scores to White perspective using the side to move of THAT position', async () => {
    const { engine, worker } = await makeEngine();
    // Black to move: engine says +40 for Black, i.e. -40 for White.
    const black = engine.search(request(AFTER_E4));
    worker.emit(info(10, 'cp 40', 'e7e5'));
    worker.emit('bestmove e7e5');
    const blackResult = await black.result;
    expect(blackResult.sideToMove).toBe('b');
    expect(blackResult.lines[0]?.scoreWhite).toEqual({ pov: 'white', kind: 'cp', value: -40 });

    // White to move: same raw line means +40 for White.
    const white = engine.search(request(START));
    worker.emit(info(10, 'cp 40', 'e2e4'));
    worker.emit('bestmove e2e4');
    const whiteResult = await white.result;
    expect(whiteResult.lines[0]?.scoreWhite).toEqual({ pov: 'white', kind: 'cp', value: 40 });

    // Mate: Black to move and mating -> Black mates (negative for White).
    const mate = engine.search(request(AFTER_E4));
    worker.emit(info(10, 'mate 3', 'd8h4'));
    worker.emit('bestmove d8h4');
    expect((await mate.result).lines[0]?.scoreWhite).toEqual({ pov: 'white', kind: 'mate', value: -3 });
  });

  it('keeps MultiPV lines sorted and replaces lines when a deeper iteration arrives', async () => {
    const { engine, worker } = await makeEngine();
    const handle = engine.search(request(START, { multiPv: 3 }));
    worker.emit(info(10, 'cp 20', 'e2e4', 1));
    worker.emit(info(10, 'cp 10', 'd2d4', 2));
    worker.emit(info(10, 'cp 5', 'g1f3', 3));
    worker.emit(info(11, 'cp 25', 'e2e4 e7e5', 1));
    worker.emit('bestmove e2e4');
    const final = await handle.result;
    expect(final.lines.map((l) => l.multipv)).toEqual([1, 2, 3]);
    expect(final.lines[0]).toMatchObject({ depth: 11, pv: ['e2e4', 'e7e5'] });
    expect(final.lines[1]).toMatchObject({ depth: 10, pv: ['d2d4'] });
  });

  it('ignores aspiration-window bound lines for the displayed lines but still counts nodes', async () => {
    const { engine, worker } = await makeEngine();
    const handle = engine.search(request(START));
    worker.emit(info(10, 'cp 20', 'e2e4'));
    worker.emit('info depth 11 seldepth 14 multipv 1 score cp 90 lowerbound nodes 99999 nps 5 time 500 pv d2d4');
    worker.emit('bestmove e2e4');
    const final = await handle.result;
    expect(final.lines).toHaveLength(1);
    expect(final.lines[0]?.scoreWhite.value).toBe(20);
    expect(final.nodes).toBe(99_999);
  });

  it('ignores a stray bestmove while idle', async () => {
    const { engine, worker } = await makeEngine();
    worker.emit('bestmove e2e4');
    expect(engine.getStatus()).toBe('ready');
  });
});

describe('races: changing the position while analysis is running', () => {
  it('stops the old search, waits for its bestmove, then starts the new one (never earlier)', async () => {
    const { engine, worker } = await makeEngine();
    const a = engine.search(request(START));
    const aOutcome = a.result.then(
      () => 'resolved',
      (e: unknown) => (e instanceof SearchSupersededError ? 'superseded' : 'other'),
    );
    worker.emit(info(9, 'cp 30', 'e2e4'));

    const b = engine.search(request(OTHER));
    // The engine is still running search A: only `stop` may be sent right now.
    expect(worker.sent.at(-1)).toBe('stop');
    expect(worker.sent.filter((c) => c === `position fen ${OTHER}`)).toHaveLength(0);

    worker.emit('bestmove e2e4'); // bestmove of A arrives
    expect(await aOutcome).toBe('superseded');
    expect(worker.sent.slice(-2)).toEqual([`position fen ${OTHER}`, 'go depth 12']);

    worker.emit(info(12, 'cp 15', 'd2d4'));
    worker.emit('bestmove d2d4');
    const final = await b.result;
    expect(final.fen).toBe(OTHER);
    expect(final.bestMove).toBe('d2d4');
  });

  it('discards info lines that the engine prints after `stop` (stale results)', async () => {
    const { engine, worker } = await makeEngine();
    const seen: string[] = [];
    const a = engine.search(request(START), (s) => seen.push(`A:${s.depth}`));
    a.result.catch(() => undefined);
    worker.emit(info(9, 'cp 30', 'e2e4'));

    const b = engine.search(request(OTHER), (s) => seen.push(`B:${s.depth}`));
    worker.emit(info(10, 'cp 99', 'e2e4')); // belongs to A, printed after stop -> must be dropped
    worker.emit('bestmove e2e4');
    worker.emit(info(7, 'cp -5', 'd2d4'));
    worker.emit('bestmove d2d4');
    await b.result;
    expect(seen).toEqual(['A:9', 'B:7', 'B:7']); // B:7 twice: info + final snapshot
  });

  it('coalesces rapid requests: only the newest pending request is ever started', async () => {
    const { engine, worker } = await makeEngine();
    const first = engine.search(request(START));
    first.result.catch(() => undefined);
    const second = engine.search(request(AFTER_E4));
    const secondOutcome = second.result.then(
      () => 'resolved',
      (e: unknown) => (e instanceof SearchSupersededError ? 'superseded' : 'other'),
    );
    const third = engine.search(request(OTHER));

    expect(await secondOutcome).toBe('superseded');
    expect(worker.sent.filter((c) => c === 'stop')).toHaveLength(1); // one stop, not one per request
    worker.emit('bestmove e2e4');
    expect(worker.sent.filter((c) => c.startsWith('position fen'))).toEqual([`position fen ${START}`, `position fen ${OTHER}`]);
    worker.emit('bestmove d2d4');
    expect((await third.result).fen).toBe(OTHER);
  });

  it('ten rapid position changes lead to exactly one extra search', async () => {
    const { engine, worker } = await makeEngine();
    const handles = [START, AFTER_E4, OTHER, START, AFTER_E4, OTHER, START, AFTER_E4, OTHER, START].map((fen) =>
      engine.search(request(fen)),
    );
    handles.forEach((h) => h.result.catch(() => undefined));
    worker.emit('bestmove e2e4');
    worker.emit('bestmove e2e4');
    const searches = worker.sent.filter((c) => c.startsWith('go '));
    expect(searches).toHaveLength(2); // the first request and the very last one
    expect(worker.sent.filter((c) => c === 'stop')).toHaveLength(1);
    expect((await handles[9]?.result)?.fen).toBe(START);
  });
});

describe('stop and terminate', () => {
  it('stop() resolves the search as "stopped", keeps the last lines, and publishes no later output', async () => {
    const { engine, worker } = await makeEngine();
    const handle = engine.search(request(START, { limits: { infinite: true } }));
    worker.emit(info(14, 'cp 28', 'e2e4 e7e5'));
    engine.stop();
    expect(worker.sent.at(-1)).toBe('stop');
    worker.emit(info(15, 'cp 99', 'd2d4')); // after stop: dropped
    worker.emit('bestmove e2e4');
    const final = await handle.result;
    expect(final.endReason).toBe('stopped');
    expect(final.depth).toBe(14);
    expect(final.lines[0]?.scoreWhite.value).toBe(28);
    expect(engine.getStatus()).toBe('ready');
  });

  it('stop() also drops a waiting request', async () => {
    const { engine, worker } = await makeEngine();
    const a = engine.search(request(START));
    const aDone = a.result.catch(() => undefined);
    const b = engine.search(request(OTHER));
    const bOutcome = b.result.then(
      () => 'resolved',
      (e: unknown) => (e instanceof SearchSupersededError ? 'superseded' : 'other'),
    );
    engine.stop();
    expect(await bOutcome).toBe('superseded');
    worker.emit('bestmove e2e4');
    await aDone;
    expect(worker.sent.filter((c) => c === `position fen ${OTHER}`)).toHaveLength(0);
  });

  it('a search can be restarted after stop', async () => {
    const { engine, worker } = await makeEngine();
    const a = engine.search(request(START, { limits: { infinite: true } }));
    engine.stop();
    worker.emit('bestmove e2e4');
    await a.result;
    const b = engine.search(request(START));
    expect(worker.sent.at(-1)).toBe('go depth 12');
    worker.emit('bestmove e2e4');
    expect((await b.result).endReason).toBe('completed');
  });

  it('terminate() rejects the running and waiting searches and kills the worker', async () => {
    const { engine, worker } = await makeEngine();
    const a = engine.search(request(START));
    const b = engine.search(request(OTHER));
    const results = Promise.allSettled([a.result, b.result]);
    engine.terminate();
    const [ra, rb] = await results;
    expect(ra?.status).toBe('rejected');
    expect(rb?.status).toBe('rejected');
    expect((ra as PromiseRejectedResult).reason).toBeInstanceOf(EngineError);
    expect(worker.terminated).toBe(true);
    expect(engine.getStatus()).toBe('terminated');
    await expect(engine.search(request(START)).result).rejects.toMatchObject({ code: 'terminated' });
  });

  it('a worker crash during a search rejects it and puts the engine in the error state', async () => {
    const { engine, worker } = await makeEngine();
    const statuses: string[] = [];
    engine.subscribeStatus((s, detail) => statuses.push(`${s}${detail ? `:${detail}` : ''}`));
    const handle = engine.search(request(START));
    worker.crash('out of memory');
    await expect(handle.result).rejects.toMatchObject({ code: 'worker-error', message: 'out of memory' });
    expect(engine.getStatus()).toBe('error');
    expect(statuses.at(-1)).toBe('error:out of memory');
    expect(worker.terminated).toBe(true);
    await expect(engine.search(request(START)).result).rejects.toBeInstanceOf(EngineError);
  });
});

describe('settings key (cache compatibility)', () => {
  const base = request(START);
  const key = (r: SearchRequest, flavor: 'single' | 'multi' = 'single') => makeSettingsKey(r, flavor);

  it('is identical for identical settings', () => {
    expect(key(base)).toBe(key({ ...base, fen: OTHER }));
  });

  it('changes with every setting that can change the result', () => {
    const variants: SearchRequest[] = [
      { ...base, multiPv: 3 },
      { ...base, limits: { depth: 20 } },
      { ...base, limits: { movetimeMs: 1000 } },
      { ...base, limits: { infinite: true } },
      { ...base, options: { ...base.options, hashMb: 128 } },
      { ...base, options: { ...base.options, skillLevel: 5 } },
      { ...base, options: { ...base.options, limitStrength: true, elo: 1500 } },
      { ...base, options: { ...base.options, limitStrength: true, elo: 1600 } },
    ];
    const keys = new Set([key(base), ...variants.map((v) => key(v))]);
    expect(keys.size).toBe(variants.length + 1);
  });

  it('distinguishes engine builds and only counts threads for the multi-threaded build', () => {
    expect(key(base, 'single')).not.toBe(key(base, 'multi'));
    const more = { ...base, options: { ...base.options, threads: 4 } };
    expect(key(more, 'single')).toBe(key(base, 'single'));
    expect(key(more, 'multi')).not.toBe(key({ ...base, options: { ...base.options, threads: 2 } }, 'multi'));
  });

  it('is attached to every snapshot', async () => {
    const { engine, worker } = await makeEngine();
    const handle = engine.search(request(START, { multiPv: 2 }));
    worker.emit('bestmove e2e4');
    const final = await handle.result;
    expect(final.settingsKey).toBe(makeSettingsKey(request(START, { multiPv: 2 }), 'single'));
  });
});

describe('engine build selection', () => {
  it('uses the multi-threaded build only when cross-origin isolated with enough cores', () => {
    expect(chooseEngineFiles('/', { crossOriginIsolated: true, cores: 8 })).toEqual({
      flavor: 'multi',
      scriptUrl: '/engine/stockfish-19-lite.js',
    });
    expect(chooseEngineFiles('/', { crossOriginIsolated: false, cores: 8 }).flavor).toBe('single');
    expect(chooseEngineFiles('/', { crossOriginIsolated: true, cores: 2 }).flavor).toBe('single');
  });

  it('respects a sub-path deployment', () => {
    expect(chooseEngineFiles('/analysis', { crossOriginIsolated: false, cores: 4 }).scriptUrl).toBe(
      '/analysis/engine/stockfish-19-lite-single.js',
    );
  });
});
