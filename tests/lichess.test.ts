import { describe, expect, it } from 'vitest';
import { fetchLichessGames, isChessComGameLink, lichessGameId, LichessError, parseLichessGame, parseLichessNdjson } from '@/lichess/api';
import { parseLichessState } from '@/stores/lichessStore';

const base = (over: Record<string, unknown> = {}) => ({
  id: 'AbCdEfGh', variant: 'standard', speed: 'blitz', status: 'resign', createdAt: 1_700_000_000_000, lastMoveAt: 1_700_000_300_000,
  players: { white: { user: { name: 'Me' }, rating: 1500 }, black: { user: { name: 'Them' }, rating: 1600 } },
  winner: 'white', opening: { eco: 'C50', name: 'Italian Game: Giuoco Piano' }, pgn: '[Event "x"]\n\n1. e4 e5 *', ...over,
});

describe('lichess parsing', () => {
  it('maps a win as white', () => {
    const g = parseLichessGame(base(), 'me');
    expect(g).toMatchObject({ url: 'https://lichess.org/AbCdEfGh', color: 'w', outcome: 'win', timeClass: 'blitz', rating: 1500, opponentRating: 1600, opponent: 'Them', eco: 'C50', opening: 'Italian Game', source: 'lichess', endTime: 1_700_000_300 });
  });
  it('maps a loss as black and draws without winner', () => {
    expect(parseLichessGame(base(), 'them')?.outcome).toBe('loss');
    expect(parseLichessGame(base({ winner: undefined, status: 'draw' }), 'me')?.outcome).toBe('draw');
    expect(parseLichessGame(base({ winner: undefined, status: 'stalemate' }), 'me')?.outcome).toBe('draw');
  });
  it('maps speeds', () => {
    expect(parseLichessGame(base({ speed: 'classical' }), 'me')?.timeClass).toBe('rapid');
    expect(parseLichessGame(base({ speed: 'correspondence' }), 'me')?.timeClass).toBe('daily');
    expect(parseLichessGame(base({ speed: 'ultraBullet' }), 'me')?.timeClass).toBe('bullet');
  });
  it('skips variants, aborted games, other players and anonymous opponents', () => {
    expect(parseLichessGame(base({ variant: 'atomic' }), 'me')).toBeNull();
    expect(parseLichessGame(base({ status: 'aborted' }), 'me')).toBeNull();
    expect(parseLichessGame(base({ status: 'noStart' }), 'me')).toBeNull();
    expect(parseLichessGame(base(), 'someone-else')).toBeNull();
    expect(parseLichessGame(base({ pgn: undefined }), 'me')).toBeNull();
    expect(parseLichessGame(null, 'me')).toBeNull();
    const anon = base({ players: { white: { user: { name: 'Me' }, rating: 1500 }, black: { aiLevel: 3 } } });
    expect(parseLichessGame(anon, 'me')?.opponent).toBe('?');
  });
  it('parses NDJSON, counting bad lines and finding the oldest game', () => {
    const text = [JSON.stringify(base()), 'not json', JSON.stringify(base({ id: 'ZZZZZZZZ', createdAt: 1_600_000_000_000, variant: 'chess960' })), ''].join('\n');
    const r = parseLichessNdjson(text, 'Me');
    expect(r.games).toHaveLength(1);
    expect(r.skipped).toBe(2);
    expect(r.lines).toBe(3);
    expect(r.oldest).toBe(1_600_000_000_000);
  });
});

describe('lichess fetching', () => {
  const resp = (status: number, body = '') => (async () => new Response(body, { status })) as unknown as typeof fetch;
  it('requests NDJSON with until and returns games', async () => {
    let seen = '';
    const f = (async (url: string, init: RequestInit) => {
      seen = `${url}|${(init.headers as Record<string, string>)['Accept']}`;
      return new Response(JSON.stringify(base()), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await fetchLichessGames('Me', 1000, f);
    expect(r.games).toHaveLength(1);
    expect(seen).toContain('/api/games/user/Me?');
    expect(seen).toContain('until=999');
    expect(seen).toContain('pgnInJson=true');
    expect(seen).toContain('application/x-ndjson');
  });
  it('maps errors', async () => {
    await expect(fetchLichessGames('Me', null, resp(404))).rejects.toMatchObject({ kind: 'not-found' });
    await expect(fetchLichessGames('Me', null, resp(429))).rejects.toMatchObject({ kind: 'rate-limit' });
    await expect(fetchLichessGames('Me', null, resp(500))).rejects.toMatchObject({ kind: 'http' });
    await expect(fetchLichessGames('Me', null, (async () => { throw new TypeError('x'); }) as unknown as typeof fetch)).rejects.toBeInstanceOf(LichessError);
    await expect(fetchLichessGames('!!', null, resp(200))).rejects.toMatchObject({ kind: 'not-found' });
  });
});

describe('links and saved state', () => {
  it('extracts game ids', () => {
    expect(lichessGameId('https://lichess.org/AbCdEfGh')).toBe('AbCdEfGh');
    expect(lichessGameId('lichess.org/AbCdEfGhIJKL/black#12')).toBe('AbCdEfGh');
    expect(lichessGameId('https://lichess.org/game/export/AbCdEfGh')).toBe('AbCdEfGh');
    expect(lichessGameId('https://lichess.org/@/someone')).toBeNull();
    expect(lichessGameId('https://example.com/AbCdEfGh')).toBeNull();
    expect(lichessGameId('1. e4 e5')).toBeNull();
  });
  it('recognises Chess.com links', () => {
    expect(isChessComGameLink('https://www.chess.com/game/live/123')).toBe(true);
    expect(isChessComGameLink('https://lichess.org/AbCdEfGh')).toBe(false);
  });
  it('restores saved state defensively', () => {
    expect(parseLichessState(null).games).toEqual([]);
    expect(parseLichessState('{{').games).toEqual([]);
    const g = parseLichessGame(base(), 'me');
    const s = parseLichessState(JSON.stringify({ username: 'Me', games: [g, { bad: 1 }], cursor: 5, exhausted: true }));
    expect(s.games).toHaveLength(1);
    expect(s.cursor).toBe(5);
    expect(s.exhausted).toBe(true);
  });
});
