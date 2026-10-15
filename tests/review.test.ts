import { describe, expect, it, vi, type Mock } from 'vitest';
import { addMove, createTree } from '@/chess/gameTree';
import {
  EvalCache,
  ReviewAbortedError,
  reviewOptions,
  runReview,
  summarizeReview,
  terminalScore,
  type ReviewEngine,
  type ReviewMove,
} from '@/analysis/review';
import { classifyMove } from '@/analysis/classify';
import { cpToWinPercent } from '@/analysis/eval';
import { DEFAULT_ENGINE_OPTIONS } from '@/engine/StockfishEngine';
import type { Color, EngineLine, SearchRequest, SearchSnapshot, WhiteScore } from '@/types/engine';
import type { GameTree } from '@/types/game';
import { DEFAULT_THRESHOLDS } from '@/analysis/classify';

const cp = (value: number): WhiteScore => ({ pov: 'white', kind: 'cp', value });
const mate = (value: number): WhiteScore => ({ pov: 'white', kind: 'mate', value });

function gameFrom(...sans: string[]): GameTree {
  let tree = createTree();
  let id = tree.rootId;
  for (const san of sans) {
    const r = addMove(tree, id, san);
    if (!r.ok) throw new Error(r.error);
    tree = r.tree;
    id = r.nodeId;
  }
  return tree;
}

interface FakeEval {
  score: WhiteScore;
  best: string | null;
  depth?: number;
  endReason?: 'completed' | 'stopped';
}

/** Deterministic engine: evaluation looked up per FEN. Records every request. */
function fakeEngine(evalFor: (fen: string, call: number) => FakeEval) {
  const requests: SearchRequest[] = [];
  const engine: ReviewEngine & { stop: Mock } = {
    stop: vi.fn(),
    search(req: SearchRequest) {
      requests.push(req);
      const e = evalFor(req.fen, requests.length);
      const depth = e.depth ?? req.limits.depth ?? 10;
      const line: EngineLine = {
        multipv: 1,
        depth,
        scoreWhite: e.score,
        bound: 'exact',
        pv: e.best === null ? [] : [e.best],
      };
      const snapshot: SearchSnapshot = {
        searchId: requests.length,
        fen: req.fen,
        sideToMove: req.fen.split(' ')[1] === 'b' ? 'b' : 'w',
        lines: [line],
        depth,
        nodes: 1,
        nps: 1,
        timeMs: 1,
        done: true,
        endReason: e.endReason ?? 'completed',
        bestMove: e.best,
        ponder: null,
        settingsKey: 'fake',
      };
      return { result: Promise.resolve(snapshot) };
    },
  };
  return { engine, requests };
}

const baseParams = {
  depth: 12,
  options: DEFAULT_ENGINE_OPTIONS,
  thresholds: DEFAULT_THRESHOLDS,
};

describe('runReview with a deterministic engine', () => {
  // Scholar's mate: 1.e4 e5 2.Qh5 Nc6 3.Bc4 Nf6?? 4.Qxf7#
  const scholars = gameFrom('e4', 'e5', 'Qh5', 'Nc6', 'Bc4', 'Nf6', 'Qxf7#');

  function scholarsEngine() {
    // positions by ply: 0..7. Engine sees +0.3 early, then the blunder allows mate in 1.
    const bestByPly: Record<string, FakeEval> = {};
    const fens = (() => {
      const out: string[] = [];
      let node = scholars.nodes[scholars.rootId]!;
      out.push(node.fen);
      while (node.children[0] !== undefined) {
        node = scholars.nodes[node.children[0]]!;
        out.push(node.fen);
      }
      return out;
    })();
    const evals: FakeEval[] = [
      { score: cp(30), best: 'e2e4' },
      { score: cp(30), best: 'e7e5' },
      { score: cp(35), best: 'g1f3' },
      { score: cp(30), best: 'b8c6' },
      { score: cp(40), best: 'f1c4' },
      { score: cp(30), best: 'g8f6' }, // before 3...Nf6: Black best was g6 (we claim g7g6)
      { score: mate(1), best: 'h5f7' }, // after the blunder: White mates in 1
    ];
    evals[5] = { score: cp(120), best: 'g7g6' };
    fens.slice(0, 7).forEach((fen, i) => (bestByPly[fen] = evals[i] as FakeEval));
    return fakeEngine((fen) => bestByPly[fen] ?? { score: cp(0), best: null });
  }

  it('evaluates every non-terminal position once, with identical settings, and skips the checkmate', async () => {
    const { engine, requests } = scholarsEngine();
    const result = await runReview({ tree: scholars, engine, ...baseParams });
    expect(requests).toHaveLength(7); // 8 positions, the final one is checkmate
    expect(new Set(requests.map((r) => JSON.stringify([r.multiPv, r.limits, r.options])))).toHaveLength(1);
    expect(requests.every((r) => r.limits.depth === 12 && r.multiPv === 2)).toBe(true);
    expect(requests[0]?.newGame).toBe(true);
    expect(requests.slice(1).every((r) => r.newGame === false)).toBe(true);
    expect(result.moves).toHaveLength(7);
    expect(result.whiteWinGraph).toHaveLength(8);
    expect(result.whiteWinGraph.at(-1)).toBe(100); // checkmate by White
  });

  it('always reviews at full strength, whatever the play-strength setting is', async () => {
    const { engine, requests } = scholarsEngine();
    await runReview({
      tree: scholars,
      engine,
      ...baseParams,
      options: { ...DEFAULT_ENGINE_OPTIONS, limitStrength: true, elo: 1400, skillLevel: 3 },
    });
    for (const r of requests) {
      expect(r.options.limitStrength).toBe(false);
      expect(r.options.skillLevel).toBe(20);
    }
    expect(reviewOptions({ ...DEFAULT_ENGINE_OPTIONS, limitStrength: true }).limitStrength).toBe(false);
  });

  it('classifies the blunder, the mate it allows, and the winning final move', async () => {
    const { engine } = scholarsEngine();
    const result = await runReview({ tree: scholars, engine, ...baseParams });
    const byPly = (ply: number) => result.moves.find((m) => m.ply === ply) as ReviewMove;

    const blunder = byPly(6); // 3...Nf6
    expect(blunder.san).toBe('Nf6');
    expect(blunder.color).toBe('b');
    expect(blunder.classification.moveClass).toBe('blunder');
    expect(blunder.classification.tags).toContain('allowed-mate');

    const mating = byPly(7); // 4.Qxf7#
    expect(mating.san).toBe('Qxf7#');
    expect(mating.classification.moveClass).toBe('best');

    expect(byPly(1).classification.moveClass).toBe('best'); // 1.e4 matched the engine move
  });

  it('summarises the game (counts, accuracy, critical moments, study positions)', async () => {
    const { engine } = scholarsEngine();
    const { summary } = await runReview({ tree: scholars, engine, ...baseParams });
    expect(summary.totalMoves).toBe(7);
    expect(summary.movesAnalyzed).toBe(7);
    expect(summary.unclassified).toBe(0);
    expect(summary.counts.b.blunder).toBe(1);
    expect(summary.counts.w.blunder).toBe(0);
    expect(summary.allowedMates.b).toBe(1);
    expect(summary.accuracy.w).toBeGreaterThan(summary.accuracy.b as number);
    expect(summary.studyPositions.map((m) => m.san)).toEqual(['Nf6']);
    expect(summary.criticalMoments.map((m) => m.san)).toContain('Nf6');
    expect(summary.biggestSwings[0]?.san).toBe('Nf6');
  });

  it('reports progress for each position', async () => {
    const { engine } = scholarsEngine();
    const progress: [number, number][] = [];
    await runReview({ tree: scholars, engine, ...baseParams, onProgress: (d, t) => progress.push([d, t]) });
    expect(progress[0]).toEqual([1, 8]);
    expect(progress.at(-1)).toEqual([8, 8]);
    expect(progress.map((p) => p[0])).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('only reviews the main line, ignoring variations', async () => {
    let tree = gameFrom('e4', 'e5');
    const e4 = tree.nodes[tree.rootId]!.children[0]!;
    const variation = addMove(tree, e4, 'c5');
    if (!variation.ok) throw new Error('setup');
    tree = variation.tree;
    const { engine, requests } = fakeEngine(() => ({ score: cp(0), best: 'a2a3' }));
    const result = await runReview({ tree, engine, ...baseParams });
    expect(requests).toHaveLength(3); // root, after e4, after e5
    expect(result.moves.map((m) => m.san)).toEqual(['e4', 'e5']);
  });
});

describe('incomplete or unstable engine output', () => {
  const game = gameFrom('e4', 'e5', 'Nf3');

  it('retries once, then leaves the affected moves unclassified instead of guessing', async () => {
    const stoppedFen = game.nodes[game.nodes[game.nodes[game.rootId]!.children[0]!]!.children[0]!]!.fen; // after 1...e5
    const { engine, requests } = fakeEngine((fen) =>
      fen === stoppedFen ? { score: cp(10), best: 'g1f3', endReason: 'stopped' } : { score: cp(10), best: 'e2e4' },
    );
    const result = await runReview({ tree: game, engine, ...baseParams });
    expect(requests.filter((r) => r.fen === stoppedFen)).toHaveLength(2); // original + one retry
    expect(result.moves.map((m) => m.classification.moveClass)).toEqual(['best', null, null]);
    expect(result.moves[1]?.classification.unclassifiedReason).toBe('incomplete-engine-output');
    expect(result.summary.unclassified).toBe(2);
    expect(result.summary.movesAnalyzed).toBe(1);
  });

  it('a transient failure that succeeds on retry is classified normally', async () => {
    let calls = 0;
    const { engine } = fakeEngine(() => {
      calls += 1;
      return calls === 2
        ? { score: cp(10), best: 'e2e4', endReason: 'stopped' }
        : { score: cp(10), best: 'e2e4' };
    });
    const result = await runReview({ tree: gameFrom('e4'), engine, ...baseParams });
    expect(result.moves[0]?.classification.moveClass).not.toBeNull();
  });

  it('treats a search that stopped short of the requested depth as incomplete', async () => {
    const { engine } = fakeEngine(() => ({ score: cp(10), best: 'e2e4', depth: 5 }));
    const result = await runReview({ tree: gameFrom('e4'), engine, ...baseParams, depth: 14 });
    expect(result.moves[0]?.classification.moveClass).toBeNull();
  });

  it('accepts an early finish when the position has a forced mate (engine stops deepening)', async () => {
    const { engine } = fakeEngine((fen) =>
      fen.startsWith('rnbqkbnr/pppppppp') && fen.includes(' w ') ? { score: cp(10), best: 'e2e4' } : { score: mate(-2), best: 'e7e5', depth: 6 },
    );
    const result = await runReview({ tree: gameFrom('e4'), engine, ...baseParams, depth: 14 });
    expect(result.moves[0]?.classification.moveClass).not.toBeNull();
  });
});

describe('cancelling a review', () => {
  it('stops the engine and rejects with ReviewAbortedError', async () => {
    const controller = new AbortController();
    const { engine } = fakeEngine(() => ({ score: cp(0), best: 'e2e4' }));
    const progress = vi.fn((done: number) => {
      if (done === 2) controller.abort();
    });
    const promise = runReview({
      tree: gameFrom('e4', 'e5', 'Nf3', 'Nc6'),
      engine,
      ...baseParams,
      signal: controller.signal,
      onProgress: progress,
    });
    await expect(promise).rejects.toBeInstanceOf(ReviewAbortedError);
    expect(engine.stop).toHaveBeenCalled();
    expect(progress).toHaveBeenCalledTimes(2); // nothing is evaluated after the abort
  });

  it('rejects immediately if already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const { engine, requests } = fakeEngine(() => ({ score: cp(0), best: 'e2e4' }));
    await expect(runReview({ tree: gameFrom('e4'), engine, ...baseParams, signal: controller.signal })).rejects.toBeInstanceOf(
      ReviewAbortedError,
    );
    expect(requests).toHaveLength(0);
  });
});

describe('evaluation cache', () => {
  const game = gameFrom('e4', 'e5');

  it('re-uses results for identical settings', async () => {
    const cache = new EvalCache();
    const first = fakeEngine(() => ({ score: cp(10), best: 'e2e4' }));
    await runReview({ tree: game, engine: first.engine, ...baseParams, cache, settingsKey: 'k1' });
    expect(first.requests).toHaveLength(3);
    const second = fakeEngine(() => ({ score: cp(999), best: 'e2e4' }));
    const result = await runReview({ tree: game, engine: second.engine, ...baseParams, cache, settingsKey: 'k1' });
    expect(second.requests).toHaveLength(0);
    expect(result.whiteWinGraph[0]).toBeCloseTo(cpToWinPercent(10), 6); // cp 10 from the cache, not 999
  });

  it('never mixes results produced under different settings', async () => {
    const cache = new EvalCache();
    const a = fakeEngine(() => ({ score: cp(10), best: 'e2e4' }));
    await runReview({ tree: game, engine: a.engine, ...baseParams, cache, settingsKey: 'depth12' });
    const b = fakeEngine(() => ({ score: cp(10), best: 'e2e4' }));
    await runReview({ tree: game, engine: b.engine, ...baseParams, cache, settingsKey: 'depth20' });
    expect(b.requests).toHaveLength(3);
  });

  it('does not store incomplete results', async () => {
    const cache = new EvalCache();
    const { engine } = fakeEngine(() => ({ score: cp(10), best: 'e2e4', endReason: 'stopped' }));
    await runReview({ tree: gameFrom('e4'), engine, ...baseParams, cache, settingsKey: 'k' });
    expect(cache.size).toBe(0);
  });

  it('evicts the least recently used entry beyond its limit', () => {
    const cache = new EvalCache(2);
    const rec = (fen: string) => ({
      fen,
      score: cp(0),
      bestMove: 'a2a3',
      bestPv: [],
      depth: 1,
      complete: true,
      terminal: null,
    });
    cache.set('a', 'k', rec('a'));
    cache.set('b', 'k', rec('b'));
    cache.get('a', 'k'); // touch a
    cache.set('c', 'k', rec('c'));
    expect(cache.get('b', 'k')).toBeUndefined();
    expect(cache.get('a', 'k')).toBeDefined();
    expect(cache.get('c', 'k')).toBeDefined();
  });
});

describe('terminal positions', () => {
  it('scores checkmate, stalemate and dead draws without an engine', () => {
    expect(terminalScore('rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3')).toEqual({
      pov: 'white',
      kind: 'mate',
      value: 0,
      winner: 'b',
    });
    expect(terminalScore('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1')).toEqual(cp(0));
    expect(terminalScore('8/8/8/4k3/8/3K4/8/8 w - - 0 1')).toEqual(cp(0));
    expect(terminalScore('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1')).toBeNull();
    expect(terminalScore('garbage')).toBeNull();
  });
});

describe('summarizeReview (pure aggregation)', () => {
  function move(
    ply: number,
    color: Color,
    before: WhiteScore,
    after: WhiteScore,
    best = false,
  ): ReviewMove {
    const classification = classifyMove({
      mover: color,
      playedUci: best ? 'a2a3' : 'h2h3',
      before: { score: before, bestMove: 'a2a3', complete: true },
      after: { score: after, bestMove: 'a7a6', complete: true },
      ply,
      bestMoveIsForcing: false,
    });
    const rec = (score: WhiteScore) => ({ fen: 'x', score, bestMove: null, bestPv: [], depth: 1, complete: true, terminal: null });
    return {
      nodeId: `n${ply}`,
      ply,
      san: `m${ply}`,
      uci: 'h2h3',
      color,
      moveNumber: Math.ceil(ply / 2),
      fenBefore: 'x',
      before: rec(before),
      after: rec(after),
      classification,
      swing: (after.kind === 'cp' ? after.value : 0) - (before.kind === 'cp' ? before.value : 0),
    };
  }

  it('counts per colour, averages accuracy, orders study positions worst first', () => {
    const moves = [
      move(1, 'w', cp(30), cp(30), true), // best
      move(2, 'b', cp(-30), cp(-30), true), // best
      move(3, 'w', cp(30), cp(-120)), // mistake/blunder for White
      move(4, 'b', cp(-120), cp(-100)), // fine
      move(5, 'w', cp(-100), cp(-600)), // worse
    ];
    const s = summarizeReview(moves);
    expect(s.counts.w.best).toBe(1);
    expect(s.counts.b.best).toBe(1);
    const whiteBad = s.counts.w.mistake + s.counts.w.blunder;
    expect(whiteBad).toBe(2);
    expect(s.accuracy.w).toBeLessThan(s.accuracy.b as number);
    expect(s.studyPositions.map((m) => m.ply)).toEqual([5, 3]); // biggest loss first
    expect(s.biggestSwings[0]?.ply).toBe(5);
  });

  it('returns null accuracy for a side without classified moves and handles an empty game', () => {
    const only = summarizeReview([move(1, 'w', cp(0), cp(0), true)]);
    expect(only.accuracy.b).toBeNull();
    const empty = summarizeReview([]);
    expect(empty).toMatchObject({ totalMoves: 0, movesAnalyzed: 0, accuracy: { w: null, b: null } });
  });

  it('finds turning points where the clearly better side changes', () => {
    const s = summarizeReview([move(1, 'w', cp(300), cp(-300)), move(2, 'b', cp(-300), cp(-250))]);
    expect(s.turningPoints.map((m) => m.ply)).toEqual([1]);
    expect(s.criticalMoments.map((m) => m.ply)).toContain(1);
  });
});
