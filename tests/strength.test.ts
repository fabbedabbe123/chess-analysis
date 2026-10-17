import { describe, expect, it } from 'vitest';
import { addMove, createTree, mainLine } from '@/chess/gameTree';
import { runReview, type ReviewEngine } from '@/analysis/review';
import { DEFAULT_THRESHOLDS } from '@/analysis/classify';
import { DEFAULT_ENGINE_OPTIONS } from '@/engine/StockfishEngine';
import type { SearchRequest, SearchSnapshot, WhiteScore } from '@/types/engine';
import type { Skill } from '@/lessons/lessons';
import { EMPTY_PROGRESS } from '@/puzzles/puzzles';
import {
  averageAccuracy, buildPlan, estimateStrength, MIN_GAMES_RATING, ratingEstimate, openMistakeCount, progressSeries, trainingPuzzles, focusAreas, gameFromReview, moverCp, ratingFromAcpl, recentActualRating, sanitizeAnalysed, RECENT_GAMES,
  type AnalysedGame,
} from '@/strength/strength';
import { parseAnalysed } from '@/stores/strengthStore';

const cp = (value: number): WhiteScore => ({ pov: 'white', kind: 'cp', value });

function game(over: Partial<AnalysedGame> = {}): AnalysedGame {
  return { id: `g${Math.random()}`, source: 'play', endedAt: 1, userColor: 'w', label: 'x', moves: 30, acpl: 50, accuracy: 80, counts: { inaccuracy: 1, mistake: 1, blunder: 0 }, catCount: {}, catLoss: {}, myRating: null, depth: 14, mistakes: [], ...over };
}

describe('moverCp', () => {
  it('flips for Black, clamps and turns mates into the clamp value', () => {
    expect(moverCp(cp(120), 'w')).toBe(120);
    expect(moverCp(cp(120), 'b')).toBe(-120);
    expect(moverCp(cp(5000), 'w')).toBe(1000);
    expect(moverCp({ pov: 'white', kind: 'mate', value: 3 }, 'w')).toBe(1000);
    expect(moverCp({ pov: 'white', kind: 'mate', value: 3 }, 'b')).toBe(-1000);
    expect(moverCp({ pov: 'white', kind: 'mate', value: 0, winner: 'b' }, 'w')).toBe(-1000);
  });
});

describe('ratingFromAcpl / estimateStrength', () => {
  it('falls as the average loss grows and stays inside sane bounds', () => {
    expect(ratingFromAcpl(20)).toBeGreaterThan(ratingFromAcpl(50));
    expect(ratingFromAcpl(50)).toBeGreaterThan(ratingFromAcpl(100));
    expect(ratingFromAcpl(0)).toBeLessThanOrEqual(2800);
    expect(ratingFromAcpl(5000)).toBeGreaterThanOrEqual(400);
  });
  it('no games -> no estimate', () => expect(estimateStrength([])).toBeNull());
  it('too few counted moves (e.g. an all-book game) -> no estimate, instead of a silly number', () => {
    expect(estimateStrength([game({ moves: 6, acpl: 1 })])).toBeNull();
    expect(estimateStrength([game({ moves: 6, acpl: 1 }), game({ moves: 14, acpl: 1 })])).not.toBeNull();
  });
  it('the band also widens when the games are short', () => {
    const short = estimateStrength([game({ moves: 20 }), game({ moves: 20 }), game({ moves: 20 })])!;
    const full = estimateStrength([game({ moves: 30 }), game({ moves: 30 }), game({ moves: 30 })])!;
    expect(short.high - short.low).toBeGreaterThanOrEqual(full.high - full.low);
  });
  it('the band narrows with more games and the confidence label follows', () => {
    const one = estimateStrength([game()])!;
    const ten = estimateStrength(Array.from({ length: 10 }, (_, i) => game({ endedAt: i })))!;
    expect(one.high - one.low).toBeGreaterThan(ten.high - ten.low);
    expect(one.confidence).toBe('very rough');
    expect(ten.confidence).toBe('moderate');
    expect(one.low).toBeLessThanOrEqual(one.rating);
    expect(one.high).toBeGreaterThanOrEqual(one.rating);
  });
  it('only the newest games count, weighted by their number of moves', () => {
    const old = Array.from({ length: 5 }, (_, i) => game({ endedAt: i, acpl: 300 }));
    const recent = Array.from({ length: RECENT_GAMES }, (_, i) => game({ endedAt: 1000 + i, acpl: 40 }));
    const e = estimateStrength([...old, ...recent])!;
    expect(e.games).toBe(RECENT_GAMES);
    expect(e.acpl).toBeCloseTo(40, 5);
    const mixed = estimateStrength([game({ moves: 10, acpl: 100 }), game({ moves: 30, acpl: 20 })])!;
    expect(mixed.acpl).toBeCloseTo((10 * 100 + 30 * 20) / 40, 5);
  });
  it('the actual rating comes only from games that carry one', () => {
    expect(recentActualRating([game()])).toBeNull();
    expect(recentActualRating([game({ myRating: 1000 }), game({ myRating: 1100 }), game()])).toEqual({ rating: 1050, games: 2 });
  });
});

describe('focusAreas', () => {
  const g = (t: number, loss: Partial<AnalysedGame['catLoss']>) => game({ endedAt: t, catLoss: loss, catCount: Object.fromEntries(Object.keys(loss).map((k) => [k, 1])) });
  it('needs at least 3 games', () => {
    expect(focusAreas([g(1, { tactics: 20 }), g(2, { tactics: 20 })]).enough).toBe(false);
  });
  it('ranks by points lost, keeps the top two with >= 15 % share', () => {
    const games = [1, 2, 3].map((t) => g(t, { tactics: 30, endgame: 15, opening: 4, kingSafety: 1 }));
    const f = focusAreas(games);
    expect(f.ranked.map((a) => a.category)).toEqual(['tactics', 'endgame', 'opening', 'kingSafety']);
    expect(f.areas.map((a) => a.category)).toEqual(['tactics', 'endgame']);
    expect(f.areas[0]?.share).toBeCloseTo(30 / 50, 5);
    expect(f.areas[0]?.trend).toBe('unknown'); // < 6 games
  });
  it('trend compares the newer half with the older half', () => {
    const early = [1, 2, 3].map((t) => g(t, { tactics: 40 }));
    const better = [4, 5, 6].map((t) => g(t, { tactics: 10 }));
    expect(focusAreas([...early, ...better]).areas[0]?.trend).toBe('improving');
    expect(focusAreas([...better, ...early.map((x, i) => ({ ...x, endedAt: 10 + i }))]).areas[0]?.trend).toBe('worse');
    const flat = [1, 2, 3, 4, 5, 6].map((t) => g(t, { tactics: 20 }));
    expect(focusAreas(flat).areas[0]?.trend).toBe('steady');
  });
});

describe('buildPlan', () => {
  const skill = (id: string, ids: string[]): Skill => ({ id, title: id, category: 'tactics', blurb: '', intro: [], ideas: [], exercises: ids.map((x) => ({ id: x, fen: '', solution: [], sideToMove: 'w', why: '', exact: false, kind: 'engine', difficulty: 'easy', ending: '' })) } as unknown as Skill);
  it('lists unfinished related lessons, new ones first, and drops mastered ones', () => {
    const skills = [skill('forks', ['f1', 'f2']), skill('pins', ['p1']), skill('skewers', ['s1']), skill('discovered', ['d1'])];
    const progress = { ...EMPTY_PROGRESS, solved: { p1: { attempts: 1, clean: true }, f1: { attempts: 2, clean: false } } };
    const plan = buildPlan([{ category: 'tactics', label: 'Tactics', lossPerGame: 10, mistakes: 3, share: 0.5, trend: 'unknown' }], skills, progress);
    const ids = plan[0]?.lessons.map((l) => l.skillId);
    expect(ids).toEqual(['skewers', 'discovered']); // pins is mastered; forks only "learning"; two lessons max
  });
});

describe('gameFromReview', () => {
  function reviewOf(scores: number[]) {
    let tree = createTree();
    let id = tree.rootId;
    for (const san of ['e4', 'e5', 'Nf3', 'Nc6']) {
      const r = addMove(tree, id, san);
      if (!r.ok) throw new Error(r.error);
      tree = r.tree;
      id = r.nodeId;
    }
    const fens = mainLine(tree).map((n) => tree.nodes[n]!.fen);
    const engine: ReviewEngine = {
      stop: () => undefined,
      search(req: SearchRequest) {
        const i = fens.indexOf(req.fen);
        const snap = { searchId: 1, fen: req.fen, sideToMove: req.fen.split(' ')[1] === 'b' ? 'b' : 'w', lines: [{ multipv: 1, depth: 12, scoreWhite: cp(scores[i] ?? 0), bound: 'exact', pv: ['a2a3'] }], depth: 12, nodes: 1, nps: 1, timeMs: 1, done: true, endReason: 'completed', bestMove: 'a2a3', ponder: null, settingsKey: 'f' } as unknown as SearchSnapshot;
        return { result: Promise.resolve(snap) };
      },
    };
    return runReview({ tree, engine, depth: 12, options: DEFAULT_ENGINE_OPTIONS, thresholds: DEFAULT_THRESHOLDS });
  }
  it('computes the loss from the user\'s own moves only', async () => {
    // evals (White view) for plies 0..4: 1.e4 keeps 0 (loss 0); 1...e5 hands White +100; 2.Nf3 gives back 60 (100 -> 40); 2...Nc6 keeps +40
    const result = await reviewOf([0, 0, 100, 40, 40]);
    const w = gameFromReview(result, 'w', { id: 'a', source: 'import', endedAt: 5, label: 'x' })!;
    expect(w.moves).toBe(2);
    expect(w.acpl).toBeCloseTo(30, 5); // (0 + 60) / 2
    const b = gameFromReview(result, 'b', { id: 'b', source: 'import', endedAt: 5, label: 'x' })!;
    expect(b.acpl).toBeCloseTo(50, 5); // black: ...e5 lets White's score go 0 -> +100 (loss 100), ...Nc6 keeps +40 (loss 0)
  });
});

describe('persistence sanitising', () => {
  it('drops malformed entries instead of crashing', () => {
    expect(sanitizeAnalysed(null)).toBeNull();
    expect(sanitizeAnalysed({ id: 'x' })).toBeNull();
    expect(sanitizeAnalysed({ ...game(), acpl: -3 })).toBeNull();
    expect(sanitizeAnalysed({ ...game(), userColor: 'x' })).toBeNull();
    expect(sanitizeAnalysed(game({ id: 'ok' }))?.id).toBe('ok');
    expect(parseAnalysed('not json')).toEqual([]);
    expect(parseAnalysed(null)).toEqual([]);
    expect(parseAnalysed(JSON.stringify([game({ id: 'a' }), { nope: 1 }, 5])).map((x) => x.id)).toEqual(['a']);
  });
});


describe('practising your own mistakes', () => {
  const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  const mk = (id: string, best: string, category: 'tactics' | 'endgame', loss: number) => ({ id, fen: START, best, category, loss, ply: 1 });
  it('sanitizes saved mistakes and drops bad ones', () => {
    const g = sanitizeAnalysed({ ...game({ id: 'a' }), mistakes: [mk('m1', 'e2e4', 'tactics', 20), { id: 'x' }, { ...mk('m2', 'zz', 'tactics', 5) }, { ...mk('m3', 'e2e4', 'nonsense' as never, 5) }] });
    expect(g?.mistakes.map((m) => m.id)).toEqual(['m1']);
    expect(sanitizeAnalysed({ ...game({ id: 'b' }), mistakes: 'oops' })?.mistakes).toEqual([]);
    const old = { ...game({ id: 'c' }) } as Partial<AnalysedGame>;
    delete old.mistakes;
    expect(sanitizeAnalysed(old)?.mistakes).toEqual([]);
  });
  it('builds valid puzzles, biggest loss first, skipping clean solves and illegal moves', () => {
    const g = game({ id: 'g1', mistakes: [mk('a', 'e2e4', 'tactics', 10), { ...mk('b', 'd2d4', 'tactics', 30), fen: START.replace('w KQkq', 'w KQkq') }, mk('bad', 'e2e5', 'tactics', 99)] });
    // 'b' has the same fen but a different best move, so it is a different puzzle; 'bad' is an illegal move and must be dropped
    const puzzles = trainingPuzzles([g], EMPTY_PROGRESS);
    expect(puzzles.map((p) => p.id)).toEqual(['b', 'a']);
    expect(puzzles.every((p) => p.theme === 'mistake')).toBe(true);
    const done = { ...EMPTY_PROGRESS, solved: { b: { attempts: 1, clean: true }, a: { attempts: 2, clean: false } } };
    expect(trainingPuzzles([g], done).map((p) => p.id)).toEqual(['a']);
    expect(openMistakeCount([g], done)).toBe(2);
    expect(trainingPuzzles([g], EMPTY_PROGRESS, 1)).toHaveLength(1);
  });
  it('puts focus-area mistakes first', () => {
    const games = [1, 2, 3].map((i) => game({ id: `f${i}`, endedAt: i, catLoss: { tactics: 40 }, catCount: { tactics: 2 }, mistakes: i === 1 ? [mk('t', 'e2e4', 'tactics', 5), mk('e', 'd2d4', 'endgame', 50)] : [] }));
    expect(trainingPuzzles(games, EMPTY_PROGRESS).map((p) => p.id)).toEqual(['t', 'e']);
  });
});

describe('progress series', () => {
  it('is chronological, with null ratings until there is evidence', () => {
    const games = [3, 1, 2].map((i) => game({ id: `s${i}`, endedAt: i, moves: 30, acpl: 40 + i * 10, accuracy: 80 }));
    const s = progressSeries(games);
    expect(s.map((p) => p.endedAt)).toEqual([1, 2, 3]);
    expect(s[0]?.rating).not.toBeNull();
    expect(s[2]?.acpl).toBe(70);
    const short = progressSeries([game({ id: 'z', moves: 5 })]);
    expect(short[0]?.rating).toBeNull();
  });
});

describe('rating range only after enough games', () => {
  const many = (n: number) => Array.from({ length: n }, (_, i) => game({ id: `g${i}`, endedAt: i, moves: 30, acpl: 50, accuracy: 80 }));
  it('no rating range before MIN_GAMES_RATING games, even though a raw estimate exists', () => {
    expect(estimateStrength(many(3))).not.toBeNull();
    expect(ratingEstimate(many(3))).toBeNull();
    expect(ratingEstimate(many(MIN_GAMES_RATING - 1))).toBeNull();
  });
  it('the range appears from MIN_GAMES_RATING games', () => {
    expect(ratingEstimate(many(MIN_GAMES_RATING))).not.toBeNull();
  });
  it('average accuracy ignores games without one and is null when none has it', () => {
    expect(averageAccuracy([game({ accuracy: 70 }), game({ id: 'b', accuracy: null }), game({ id: 'c', accuracy: 90 })])).toBe(80);
    expect(averageAccuracy([game({ accuracy: null })])).toBeNull();
    expect(averageAccuracy([])).toBeNull();
  });
});

describe('calibrated mapping', () => {
  it('uses the Chess.com calibration (4533*exp(-0.0179*ACPL))', () => {
    expect(Math.round(ratingFromAcpl(60))).toBe(1549);
    expect(Math.round(ratingFromAcpl(100))).toBe(757);
    expect(ratingFromAcpl(0)).toBe(2800);
  });
});
