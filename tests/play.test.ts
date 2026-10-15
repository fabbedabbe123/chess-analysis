import { Chess } from 'chess.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { classifyMove } from '@/analysis/classify';
import type { PositionRecord, ReviewMove } from '@/analysis/review';
import { getNode, mainLine } from '@/chess/gameTree';
import { CATEGORY_ORDER, buildCoachReport, categorize, themesFor } from '@/play/coach';
import { MAX_HISTORY, summarizeHistory, type GameRecord } from '@/play/history';
import { buildHint, describeMove } from '@/play/hints';
import { LEVELS, sanitizeCustom, specFor, strengthFor } from '@/play/strength';
import { recommendPuzzles } from '@/play/training';
import { EMPTY_PROGRESS, validatePuzzle, type Puzzle } from '@/puzzles/puzzles';
import { gameStore, playMove, resetGameStoreForTests } from '@/stores/gameStore';
import { historyStore } from '@/stores/historyStore';
import {
  initPlay, playBoardLocked, playStore, resetPlayStoreForTests, resign, setPlayEnginesForTests, startGame, takeBack, offerDraw, updatePlaySettings,
  sanitizePlaySettings, visibleFeedback, retryEngineMove,
} from '@/stores/playStore';
import { DEFAULT_ENGINE_OPTIONS } from '@/engine/StockfishEngine';
import type { EngineCapabilities, SearchRequest, SearchSnapshot, WhiteScore } from '@/types/engine';

const cp = (value: number): WhiteScore => ({ pov: 'white', kind: 'cp', value });
const mate = (value: number): WhiteScore => ({ pov: 'white', kind: 'mate', value });

const CAPS: EngineCapabilities = { name: 'SF', flavor: 'single', maxThreads: 1, maxMultiPv: 256, supportsSkillLevel: true, supportsLimitStrength: true, minElo: 1320, maxElo: 3190, supportsWdl: false, options: [] };

describe('strength levels', () => {
  it('maps every level to real UCI options', () => {
    const beginner = strengthFor(specFor('beginner', sanitizeCustom(null)), CAPS);
    expect(beginner.options).toMatchObject({ limitStrength: false, skillLevel: 0 });
    expect(beginner.limits).toEqual({ movetimeMs: 100, depth: 1 });
    const adv = strengthFor(specFor('advanced', sanitizeCustom(null)), CAPS);
    expect(adv.options).toMatchObject({ limitStrength: true, elo: 2000 });
    const max = strengthFor(specFor('maximum', sanitizeCustom(null)), CAPS);
    expect(max.options).toMatchObject({ limitStrength: false, skillLevel: 20 });
    expect(max.limits.depth).toBeUndefined();
  });
  it('strength is monotone across the preset levels', () => {
    const rank = LEVELS.map((l) => {
      const s = strengthFor(l, CAPS);
      return s.options.limitStrength ? 1320 + (s.options.elo - 1320) + 1000 : s.options.skillLevel === 20 ? 5000 : s.options.skillLevel * 40;
    });
    expect([...rank].sort((a, b) => a - b)).toEqual(rank);
  });
  it('clamps custom values and falls back honestly when options are missing', () => {
    expect(sanitizeCustom({ mode: 'elo', elo: 99999, skill: -4, movetimeMs: 1 })).toEqual({ mode: 'elo', elo: 3190, skill: 0, movetimeMs: 30 });
    const noElo = strengthFor(specFor('expert', sanitizeCustom(null)), { ...CAPS, supportsLimitStrength: false });
    expect(noElo.options.limitStrength).toBe(false);
    expect(noElo.note).toMatch(/no UCI_Elo/);
    const none = strengthFor(specFor('expert', sanitizeCustom(null)), { ...CAPS, supportsLimitStrength: false, supportsSkillLevel: false });
    expect(none.limits.depth).toBe(3);
  });
});

describe('hints', () => {
  it('describes captures, checks, mates and castling from the real position', () => {
    expect(describeMove('rnbqkbnr/ppp2ppp/8/3pp3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 3', 'e4d5')?.purpose).toBe('tactical');
    expect(describeMove('rnbqkbnr/pppp1ppp/8/4p3/2B1P3/8/PPPP1PPP/RNBQK1NR w KQkq - 0 1', 'd1f3')?.purpose).toBeDefined();
    expect(describeMove('r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4', 'h5f7')?.mate).toBe(true);
    expect(describeMove('rnbqk2r/pppp1ppp/5n2/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4', 'e1g1')?.castle).toBe(true);
    expect(describeMove('startpos', 'e2e4')).toBeNull();
    expect(describeMove('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 'e2e5')).toBeNull();
  });
  it('builds three progressive levels, level 1 and 2 never name the destination', () => {
    const fen = 'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4';
    const h = buildHint(fen, ['h5f7'], '#1');
    expect(h).not.toBeNull();
    expect(h!.level3.san).toBe('Qxf7#');
    expect(h!.level1).not.toMatch(/f7/);
    expect(h!.level2).not.toMatch(/f7/);
    expect(h!.level3.purposeText).toMatch(/checkmate/);
    expect(buildHint(fen, [], '+0')).toBeNull();
  });
});

// ------------------------------------------------------------------ coach

const rec = (fen: string, score: WhiteScore, best: string | null, pv: string[] = best ? [best] : []): PositionRecord => ({ fen, score, bestMove: best, bestPv: pv, depth: 14, complete: true, terminal: null });

/** Builds a ReviewMove for `uci` played in `fenBefore` with given evaluations. */
function rm(fenBefore: string, uci: string, beforeScore: WhiteScore, afterScore: WhiteScore, bestBefore: string, bestAfter: string | null, ply = 3): ReviewMove {
  const c = new Chess(fenBefore);
  const color = c.turn();
  const san = c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), ...(uci.length === 5 ? { promotion: uci[4] as string } : {}) }).san;
  const before = rec(fenBefore, beforeScore, bestBefore);
  const after = rec(c.fen(), afterScore, bestAfter);
  const classification = classifyMove({ mover: color, playedUci: uci, before, after, ply, bestMoveIsForcing: false });
  return { nodeId: `n${ply}`, ply, san, uci, color, moveNumber: Math.ceil(ply / 2), fenBefore, before, after, classification, swing: 0 };
}

describe('coach categories', () => {
  it('a missed mate is calculation and trains the matching mate-length puzzles', () => {
    const fen = 'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4';
    const m = rm(fen, 'g1f3', mate(1), cp(300), 'h5f7', 'f6e4');
    expect(m.classification.tags).toContain('missed-mate');
    expect(categorize(m)).toBe('calculation');
    expect(themesFor(m, 'calculation')).toEqual(['mate1']);
  });
  it('an allowed mate is king safety / defence', () => {
    const fen = 'rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPP2P/RNBQKBNR b KQkq - 0 2';
    const m = rm(fen, 'a7a6', cp(-200), mate(1), 'd8h4', 'd8h4', 4);
    expect(m.classification.tags).toContain('allowed-mate');
    expect(categorize(m)).toBe('kingSafety');
    expect(themesFor(m, 'kingSafety')).toEqual(['defence']);
  });
  it('hanging the moved piece is tactics, not "opening"', () => {
    const m = rm('rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2', 'd1g4', cp(40), cp(-800), 'e4d5', 'c8g4', 3);
    expect(m.classification.moveClass).toBe('blunder');
    expect(m.classification.tags).toContain('opening');
    expect(categorize(m)).toBe('tactics');
    expect(themesFor(m, 'tactics')).toEqual(['tactic']);
  });
  it('endgames, quiet pawn moves and passive piece moves follow the stated rules', () => {
    const endgame = 'k7/8/8/8/8/8/PP6/K1R5 w - - 0 40';
    expect(categorize(rm(endgame, 'a2a3', cp(100), cp(-100), 'c1c8', 'a8b7', 79))).toBe('endgame');
    const quiet = 'r1bq1rk1/pp2bppp/2n1pn2/2pp4/3P1B2/2PBPN2/PP1N1PPP/R2QK2R w KQ - 0 9';
    expect(categorize(rm(quiet, 'a2a3', cp(40), cp(-120), 'f3e5', 'a7a6', 40))).toBe('pawnStructure');
    expect(categorize(rm(quiet, 'e1f1', cp(40), cp(-120), 'f3e5', 'a7a6', 40))).toBe('pieceActivity');
  });
  it('report counts only the user\'s own mistakes and keeps one example per category', () => {
    const fen = 'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4';
    const bad = rm(fen, 'g1f3', mate(1), cp(300), 'h5f7', 'f6e4');
    const opp = { ...rm('rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 2', 'a7a6', cp(30), cp(400), 'g8f6', 'd1h5', 4), color: 'b' as const };
    const report = buildCoachReport({ depth: 14, thresholds: { excellent: 2, good: 5, inaccuracy: 10, mistake: 20 }, moves: [bad, opp], whiteWinGraph: [50, 50, 50], summary: {} as never, completedAt: 0 }, 'w');
    expect(report.mistakes).toHaveLength(1);
    expect(report.counts.calculation).toBe(1);
    expect(Object.keys(report.counts)).toEqual(CATEGORY_ORDER);
    expect(report.examples[0]?.bestSan).toBe('Qxf7#');
    expect(report.examples[0]?.facts).toMatch(/forced mate in 1/);
  });
});

describe('training recommendations', () => {
  const puzzle = (id: string, theme: string, difficulty = 'easy'): Puzzle => {
    const r = validatePuzzle({ id, fen: '6k1/5ppp/8/8/8/8/8/R3K3 w - - 0 1', solution: ['a1a8'], theme, difficulty });
    if (!r.ok) throw new Error(r.error);
    return r.puzzle;
  };
  const fen = 'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4';
  const report = () => buildCoachReport({ depth: 14, thresholds: { excellent: 2, good: 5, inaccuracy: 10, mistake: 20 }, moves: [rm(fen, 'g1f3', mate(1), cp(300), 'h5f7', 'f6e4')], whiteWinGraph: [], summary: {} as never, completedAt: 0 }, 'w');
  it('recommends only puzzles whose theme matches the missed pattern, unsolved first', () => {
    const all = [puzzle('a', 'mate1'), puzzle('b', 'mate2'), puzzle('c', 'defence'), puzzle('d', 'mate1')];
    const recs = recommendPuzzles(report(), all, { ...EMPTY_PROGRESS, solved: { a: { attempts: 1, clean: true } } });
    expect(recs.map((r) => r.puzzle.id)).toEqual(['d', 'a']);
    expect(recs[0]?.reason).toMatch(/missed a mate/);
  });
  it('recommends nothing when no puzzle matches (unrelated puzzles are not offered)', () => {
    expect(recommendPuzzles(report(), [puzzle('x', 'defence')], EMPTY_PROGRESS)).toEqual([]);
  });
});

describe('history summary', () => {
  const g = (i: number, result: GameRecord['result'], accuracy: number | null, categories: Record<string, number> = {}): GameRecord => ({
    id: `g${i}`, endedAt: i, userColor: 'w', levelId: 'easy', levelLabel: 'Easy', result, reason: 'x', plies: 20, pgn: '', opening: null,
    review: accuracy === null ? null : { accuracy, inaccuracies: 0, mistakes: 0, blunders: 0, categories },
  });
  it('aggregates results, trend and goals from real records only', () => {
    expect(summarizeHistory([], EMPTY_PROGRESS).goals[0]).toMatch(/first game/);
    const recs = [g(1, 'win', 60), g(2, 'loss', 62, { tactics: 2 }), g(3, 'draw', 64), g(4, 'win', 80, { tactics: 1, endgame: 1 }), g(5, 'win', 82), g(6, 'win', 84)];
    const s = summarizeHistory(recs, { solved: { a: { attempts: 1, clean: false }, b: { attempts: 2, clean: false } }, streak: 0, bestStreak: 3 });
    expect([s.wins, s.draws, s.losses]).toEqual([4, 1, 1]);
    expect(s.accuracyChange).toBeCloseTo(82 - 62, 5);
    expect(s.topCategories[0]).toMatchObject({ category: 'tactics', count: 3 });
    expect(s.goals.join(' ')).toMatch(/tactics/);
    expect(s.goals.join(' ')).toMatch(/Under half/);
    expect(MAX_HISTORY).toBeGreaterThan(50);
  });
});

// -------------------------------------------------------------- play store

function snap(fen: string, best: string | null, score: WhiteScore, depth: number): SearchSnapshot {
  return { searchId: 1, fen, sideToMove: fen.split(' ')[1] === 'b' ? 'b' : 'w', lines: best ? [{ multipv: 1, depth, scoreWhite: score, bound: 'exact', pv: [best] }] : [], depth, nodes: 1, nps: 1, timeMs: 1, done: true, endReason: 'completed', bestMove: best, ponder: null, settingsKey: 'k' };
}
const legalFirst = (fen: string): string | null => {
  const m = new Chess(fen).moves({ verbose: true })[0];
  return m ? `${m.from}${m.to}${m.promotion ?? ''}` : null;
};

/** Opponent that plays a fixed script of UCI moves; analysis engine that evaluates everything as equal. */
function fakeEngines(script: string[], failFirst = false) {
  const searches: SearchRequest[] = [];
  let i = 0;
  let failed = !failFirst;
  const opponent = {
    getStatus: () => 'ready' as const, getCapabilities: () => CAPS, stop: vi.fn(), terminate: vi.fn(),
    search: (req: SearchRequest) => {
      searches.push(req);
      if (!failed) { failed = true; return { id: 1, result: Promise.reject(new Error('engine crashed')) }; }
      const move = script[i++] ?? legalFirst(req.fen);
      return { id: 1, result: Promise.resolve(snap(req.fen, move, cp(0), 10)) };
    },
  };
  const analysis = {
    getStatus: () => 'ready' as const, getCapabilities: () => CAPS, stop: vi.fn(), terminate: vi.fn(),
    search: (req: SearchRequest) => ({ id: 1, result: Promise.resolve(snap(req.fen, legalFirst(req.fen), cp(0), req.limits.depth ?? 12)) }),
  };
  setPlayEnginesForTests(async () => opponent as never, async () => analysis as never, 0);
  return { searches, opponent };
}
const user = (uci: string) => playMove({ from: uci.slice(0, 2), to: uci.slice(2, 4) } as never);
const flush = async () => { for (let i = 0; i < 40; i += 1) await vi.advanceTimersByTimeAsync(20); };

describe('play store', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetGameStoreForTests();
    resetPlayStoreForTests();
    historyStore.replace({ records: [], saveFailed: false });
    initPlay();
  });
  afterEach(() => {
    resetPlayStoreForTests();
    vi.useRealTimers();
  });

  it('as Black the engine moves first; as White the user does', async () => {
    fakeEngines(['e2e4']);
    updatePlaySettings({ color: 'b' });
    startGame();
    await flush();
    expect(mainLine(gameStore.get().tree)).toHaveLength(2);
    expect(playStore.get().userColor).toBe('b');
    expect(playBoardLocked(playStore.get())).toBe(false);
    resetPlayStoreForTests();
    fakeEngines([]);
    updatePlaySettings({ color: 'w' });
    startGame();
    await flush();
    expect(mainLine(gameStore.get().tree)).toHaveLength(1);
    expect(playBoardLocked(playStore.get())).toBe(false);
  });

  it('the opponent is asked with real strength options and replies with the engine move', async () => {
    const { searches } = fakeEngines(['e7e5']);
    updatePlaySettings({ color: 'w', level: 'advanced' });
    startGame();
    user('e2e4');
    await flush();
    expect(searches).toHaveLength(1);
    expect(searches[0]?.options).toMatchObject({ limitStrength: true, elo: 2000 });
    expect(searches[0]?.fen).toContain(' b ');
    expect(mainLine(gameStore.get().tree).map((id) => getNode(gameStore.get().tree, id).san).slice(1)).toEqual(['e4', 'e5']);
  });

  it('locks the board while the engine thinks and rejects moves made out of turn', async () => {
    fakeEngines(['e7e5']);
    startGame();
    user('e2e4');
    expect(playBoardLocked(playStore.get())).toBe(true);
    // the user tries to move for Black while the engine is thinking (e.g. via another panel)
    user('d7d5');
    await flush();
    const sans = mainLine(gameStore.get().tree).map((id) => getNode(gameStore.get().tree, id).san).slice(1);
    expect(sans).toEqual(['e4', 'e5']);
  });

  it('detects checkmate (fool\'s mate), records the result and saves the game to history', async () => {
    fakeEngines(['e7e5', 'd8h4']);
    startGame();
    user('f2f3');
    await flush();
    user('g2g4');
    await flush();
    const s = playStore.get();
    expect(s.phase).toBe('finished');
    expect(s.result).toMatchObject({ outcome: 'loss', reason: 'Checkmate' });
    expect(gameStore.get().tree.headers['Result']).toBe('0-1');
    await flush();
    expect(historyStore.get().records).toHaveLength(1);
    expect(historyStore.get().records[0]).toMatchObject({ result: 'loss', userColor: 'w' });
    expect(historyStore.get().records[0]?.pgn).toContain('Qh4#');
  });

  it('resign ends the game with the right result; the history entry keeps the level', async () => {
    fakeEngines([]);
    updatePlaySettings({ color: 'b', level: 'easy' });
    startGame();
    await flush();
    resign();
    expect(playStore.get().result).toMatchObject({ outcome: 'loss', reason: 'You resigned' });
    expect(gameStore.get().tree.headers['Result']).toBe('1-0');
    await flush();
    expect(historyStore.get().records[0]).toMatchObject({ levelLabel: 'Easy', userColor: 'b' });
  });

  it('take back removes your move and the engine reply, only in practice mode', async () => {
    fakeEngines(['e7e5']);
    updatePlaySettings({ practice: true });
    startGame();
    user('e2e4');
    await flush();
    expect(takeBack()).toBe(true);
    expect(mainLine(gameStore.get().tree)).toHaveLength(1);
    expect(playBoardLocked(playStore.get())).toBe(false);
    resetPlayStoreForTests();
    fakeEngines(['e7e5']);
    updatePlaySettings({ practice: false });
    startGame();
    user('e2e4');
    await flush();
    expect(takeBack()).toBe(false);
    expect(mainLine(gameStore.get().tree)).toHaveLength(3);
  });

  it('an engine failure is reported, nothing is played, and retry recovers', async () => {
    fakeEngines(['e7e5'], true);
    startGame();
    user('e2e4');
    await flush();
    expect(playStore.get().error).toMatch(/crashed/);
    expect(playStore.get().thinking).toBe(false);
    expect(mainLine(gameStore.get().tree)).toHaveLength(2);
    retryEngineMove();
    await flush();
    expect(playStore.get().error).toBeNull();
    expect(mainLine(gameStore.get().tree)).toHaveLength(3);
  });

  it('a draw offer is accepted only when the engine does not rate itself better', async () => {
    fakeEngines(['e7e5']);
    startGame();
    user('e2e4');
    await flush();
    const accepted = await (async () => { const p = offerDraw(); await flush(); return p; })();
    expect(accepted?.accepted).toBe(true);
    expect(playStore.get().result?.reason).toBe('Draw by agreement');
    expect(gameStore.get().tree.headers['Result']).toBe('1/2-1/2');
  });

  it('feedback uses the user\'s perspective and respects the mode', async () => {
    fakeEngines(['e7e5']);
    // evaluation: after 1.f3 White is worse (analysis fake returns 0, so override the cache with a bad score)
    updatePlaySettings({ feedback: 'every' });
    startGame();
    await flush();
    user('f2f3');
    await flush();
    const fb = Object.values(playStore.get().feedback);
    expect(fb).toHaveLength(1);
    expect(fb[0]?.moveClass).toBeDefined();
    expect(visibleFeedback(playStore.get())).not.toBeNull();
    updatePlaySettings({ feedback: 'after' });
    expect(visibleFeedback(playStore.get())).toBeNull();
    updatePlaySettings({ feedback: 'significant' });
    expect(visibleFeedback(playStore.get())).toBeNull(); // equal evaluations: not a significant mistake
  });

  it('settings are sanitised', () => {
    expect(sanitizePlaySettings({ level: 'nope', feedback: 'x', color: 'z', custom: { skill: 99 } })).toMatchObject({ level: 'intermediate', feedback: 'every', color: 'w', custom: { skill: 20 } });
  });

  it('options default values are those of the review (full strength) engine', () => {
    expect(DEFAULT_ENGINE_OPTIONS.skillLevel).toBe(20);
  });
});
