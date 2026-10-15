import { beforeEach, describe, expect, it } from 'vitest';
import { ChessComError, fetchArchives, openingFromUrl, outcomeOf, parseMonth, validUsername } from '@/chesscom/api';
import { computeStats, scorePct, weakestOpenings } from '@/chesscom/stats';
import { clearTracker, mergeGames, olderMonthsAvailable, parseTracker, syncPlayer, trackerStore } from '@/stores/trackerStore';

const P = 'https://api.chess.com/pub/player/fabian';
const pgn = (eco: string, slug: string) => `[Event "Live Chess"]\n[ECO "${eco}"]\n[ECOUrl "https://www.chess.com/openings/${slug}"]\n\n1. e4 e5 1-0`;
const game = (o: Record<string, unknown> = {}) => ({
  url: `https://www.chess.com/game/live/${String(o.end_time ?? 100)}`, end_time: 100, time_class: 'blitz', rules: 'chess',
  pgn: pgn('C20', 'Kings-Pawn-Opening-2.Nf3'),
  white: { username: 'Fabian', rating: 1200, result: 'win' }, black: { username: 'Opp', rating: 1250, result: 'resigned' }, ...o,
});

function mockFetch(routes: Record<string, { status?: number; body?: unknown } | 'throw'>): typeof fetch {
  return (async (url: string) => {
    const r = routes[url];
    if (r === undefined || r === 'throw') throw new TypeError('network');
    return { ok: (r.status ?? 200) < 400, status: r.status ?? 200, json: async () => r.body } as Response;
  }) as unknown as typeof fetch;
}

describe('chess.com api helpers', () => {
  it('validates usernames', () => {
    expect(validUsername('fabian_1')).toBe(true);
    expect(validUsername('a')).toBe(false);
    expect(validUsername('../x')).toBe(false);
  });
  it('maps result codes', () => {
    expect(outcomeOf('win')).toBe('win');
    expect(['agreed', 'repetition', 'stalemate', 'insufficient', '50move', 'timevsinsufficient'].map(outcomeOf)).toEqual(Array(6).fill('draw'));
    expect(['checkmated', 'resigned', 'timeout', 'abandoned'].map(outcomeOf)).toEqual(Array(4).fill('loss'));
  });
  it('derives opening names from the ECO url', () => {
    expect(openingFromUrl('https://www.chess.com/openings/Sicilian-Defense-Open-Najdorf-Variation-6.Be3')).toBe('Sicilian Defense Open Najdorf Variation');
    expect(openingFromUrl(null)).toBeNull();
  });
  it('parses both colours, skips variants and foreign games', () => {
    const data = { games: [game(), game({ white: { username: 'Opp', rating: 1, result: 'timeout' }, black: { username: 'fabian', rating: 1300, result: 'win' } }), game({ rules: 'chess960' }), game({ white: { username: 'x' }, black: { username: 'y' } })] };
    const { games, skipped } = parseMonth(data, 'FABIAN');
    expect(skipped).toBe(2);
    expect(games.map((g) => [g.color, g.outcome, g.rating, g.opponent])).toEqual([['w', 'win', 1200, 'Opp'], ['b', 'win', 1300, 'Opp']]);
    expect(games[0]!.eco).toBe('C20');
    expect(games[0]!.opening).toBe('Kings Pawn Opening');
  });
  it('rejects malformed month data', () => {
    expect(() => parseMonth({}, 'fabian')).toThrow(ChessComError);
  });
  it('maps HTTP failures to actionable errors', async () => {
    await expect(fetchArchives('fabian', mockFetch({ [`${P}/games/archives`]: { status: 404 } }))).rejects.toMatchObject({ kind: 'not-found' });
    await expect(fetchArchives('fabian', mockFetch({ [`${P}/games/archives`]: { status: 429 } }))).rejects.toMatchObject({ kind: 'rate-limit' });
    await expect(fetchArchives('fabian', mockFetch({ [`${P}/games/archives`]: 'throw' }))).rejects.toMatchObject({ kind: 'network' });
    await expect(fetchArchives('fabian', mockFetch({ [`${P}/games/archives`]: { body: { nope: 1 } } }))).rejects.toMatchObject({ kind: 'bad-data' });
  });
});

describe('stats', () => {
  const mk = (o: string, color: 'w' | 'b', outcome: 'win' | 'draw' | 'loss', t: number, rating = 1000) =>
    ({ url: `u${Math.random()}`, endTime: t, timeClass: 'blitz', color, outcome, reason: outcome === 'loss' ? 'resigned' : outcome, opponent: 'o', rating, opponentRating: 1, eco: 'A00', opening: o, pgn: '' }) as const;
  it('counts results, colours, openings and sorts ratings chronologically', () => {
    const gs = [mk('X', 'w', 'win', 3, 1030), mk('X', 'w', 'loss', 1, 1000), mk('Y', 'b', 'draw', 2, 1010)];
    const s = computeStats(gs);
    expect(s.total).toEqual({ win: 1, draw: 1, loss: 1, games: 3 });
    expect(s.asWhite.games).toBe(2);
    expect(s.ratings.blitz!.map((r) => r.rating)).toEqual([1000, 1010, 1030]);
    expect(s.lossReasons).toEqual({ resigned: 1 });
    expect(scorePct(s.total)).toBeCloseTo(50);
  });
  it('only reports weak openings with enough games', () => {
    const gs = [...Array(5).fill(0).map((_, i) => mk('Bad', 'w', 'loss', i)), mk('Tiny', 'w', 'loss', 9)];
    expect(weakestOpenings(computeStats(gs)).map((o) => o.name)).toEqual(['Bad']);
    expect(weakestOpenings(computeStats(Array(6).fill(0).map((_, i) => mk('Good', 'w', 'win', i))))).toEqual([]);
  });
});

describe('tracker store', () => {
  beforeEach(() => clearTracker());
  const archives = [`${P}/games/2026/08`, `${P}/games/2026/09`, `${P}/games/2026/10`];
  const f = () => mockFetch({
    [`${P}/games/archives`]: { body: { archives } },
    [archives[0]!]: { body: { games: [game({ end_time: 1 })] } },
    [archives[1]!]: { body: { games: [game({ end_time: 2 })] } },
    [archives[2]!]: { body: { games: [game({ end_time: 3 })] } },
  });
  it('loads the newest months first and can load older ones', async () => {
    await syncPlayer('Fabian', 2, f());
    expect(trackerStore.get().games.map((g) => g.endTime)).toEqual([3, 2]);
    expect(olderMonthsAvailable(trackerStore.get())).toBe(1);
    await syncPlayer('fabian', 3, f());
    expect(trackerStore.get().games.map((g) => g.endTime)).toEqual([3, 2, 1]);
    expect(trackerStore.get().error).toBeNull();
  });
  it('does not duplicate games on refresh', async () => {
    await syncPlayer('fabian', 3, f());
    await syncPlayer('fabian', 3, f());
    expect(trackerStore.get().games).toHaveLength(3);
  });
  it('keeps downloaded games and reports an error when a later month fails', async () => {
    const m = mockFetch({ [`${P}/games/archives`]: { body: { archives } }, [archives[2]!]: { body: { games: [game()] } }, [archives[1]!]: { status: 429 } });
    await syncPlayer('fabian', 3, m);
    expect(trackerStore.get().games).toHaveLength(1);
    expect(trackerStore.get().error).toMatch(/rate limiting/);
    expect(trackerStore.get().status).toBe('idle');
  });
  it('surfaces unknown users and invalid names', async () => {
    await syncPlayer('nobody', 3, mockFetch({ 'https://api.chess.com/pub/player/nobody/games/archives': { status: 404 } }));
    expect(trackerStore.get().error).toMatch(/No such/);
    await syncPlayer('!!', 3, f());
    expect(trackerStore.get().error).toMatch(/valid/);
  });
  it('switching player discards the previous player\'s games', async () => {
    await syncPlayer('fabian', 1, f());
    await syncPlayer('nobody', 1, mockFetch({ 'https://api.chess.com/pub/player/nobody/games/archives': { status: 404 } }));
    expect(trackerStore.get().games).toHaveLength(0);
  });
  it('merge caps and dedups; parse tolerates garbage', () => {
    expect(mergeGames([], [])).toEqual([]);
    expect(parseTracker('not json').games).toEqual([]);
    expect(parseTracker(JSON.stringify({ username: 'x', games: [{ bad: 1 }] })).games).toEqual([]);
  });
});

import { parsePgn } from '@/pgn/pgn';
import { getNode, mainLine } from '@/chess/gameTree';
import { stripClockTags } from '@/chesscom/api';
describe('chess.com PGN import', () => {
  it('drops clock tags but keeps real comments', () => {
    const { games } = parsePgn(stripClockTags('[Event "x"]\n\n1. e4 {[%clk 0:03:00]} 1... e5 {[%clk 0:02:59.9] solid} 2. Nf3 {[%emt 0:00:01]} *'));
    const t = games[0]!.tree;
    expect(games[0]!.warnings).toEqual([]);
    expect(mainLine(t).map((id) => getNode(t, id).comment).filter(Boolean)).toEqual(['solid']);
  });
});
