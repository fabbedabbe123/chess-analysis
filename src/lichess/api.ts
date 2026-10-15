/**
 * Lichess API client (https://lichess.org/api). Public, read-only, no token, and the endpoints send CORS headers,
 * so it works from the browser. Games are read as NDJSON (one JSON object per line).
 * Chess.com game links cannot be fetched from a browser (no CORS on its game endpoint) - that is stated, not faked.
 */
import type { TimeClass, TrackedGame, Outcome } from '@/chesscom/api';

export class LichessError extends Error {
  constructor(message: string, readonly kind: 'not-found' | 'rate-limit' | 'network' | 'bad-data' | 'http') {
    super(message);
  }
}

const BASE = 'https://lichess.org';
const USERNAME_RE = /^[A-Za-z0-9_-]{2,30}$/;
export const LICHESS_PAGE = 100;

export function validLichessName(name: string): boolean {
  return USERNAME_RE.test(name.trim());
}

type Fetch = typeof fetch;

async function getText(url: string, accept: string, f: Fetch, timeoutMs = 30000): Promise<string> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await f(url, { signal: ctl.signal, headers: { Accept: accept } });
  } catch (e) {
    throw new LichessError(
      (e as Error).name === 'AbortError' ? 'Lichess did not answer in time.' : 'Could not reach Lichess (offline, blocked, or the service is down).',
      'network',
    );
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 404) throw new LichessError('Lichess has no such player or game.', 'not-found');
  if (res.status === 429) throw new LichessError('Lichess is rate limiting requests. Wait a minute and try again.', 'rate-limit');
  if (!res.ok) throw new LichessError(`Lichess returned HTTP ${res.status}.`, 'http');
  try {
    return await res.text();
  } catch {
    throw new LichessError('Lichess returned an unreadable response.', 'bad-data');
  }
}

function speedClass(speed: unknown): TimeClass | null {
  switch (speed) {
    case 'ultraBullet': case 'bullet': return 'bullet';
    case 'blitz': return 'blitz';
    case 'rapid': case 'classical': return 'rapid';
    case 'correspondence': return 'daily';
    default: return null;
  }
}

const DRAW_STATUSES = new Set(['draw', 'stalemate']);
/** Statuses that mean the game finished normally. Anything else (aborted, no start, unknown) is skipped. */
const FINISHED = new Set(['mate', 'resign', 'stalemate', 'timeout', 'draw', 'outoftime', 'cheat']);

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Converts one NDJSON game object, or null when it is not a finished standard game of `username`. */
export function parseLichessGame(raw: unknown, username: string): TrackedGame | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const g = raw as Record<string, unknown>;
  const players = g['players'] as Record<string, Record<string, unknown> | undefined> | undefined;
  const status = String(g['status']);
  const tc = speedClass(g['speed']);
  const id = g['id'];
  const pgn = g['pgn'];
  const when = num(g['lastMoveAt']) ?? num(g['createdAt']);
  if (g['variant'] !== 'standard' || !players || tc === null || typeof id !== 'string' || typeof pgn !== 'string'
    || when === null || !FINISHED.has(status)) return null;
  const me = username.trim().toLowerCase();
  const nameOf = (p: Record<string, unknown> | undefined): string | null => {
    const u = p?.['user'] as Record<string, unknown> | undefined;
    return typeof u?.['name'] === 'string' ? u['name'] : null;
  };
  const w = players['white'], b = players['black'];
  const color = nameOf(w)?.toLowerCase() === me ? 'w' : nameOf(b)?.toLowerCase() === me ? 'b' : null;
  if (color === null) return null;
  const mine = color === 'w' ? w : b;
  const theirs = color === 'w' ? b : w;
  const winner = g['winner'];
  const outcome: Outcome = DRAW_STATUSES.has(status) || winner === undefined
    ? 'draw'
    : (winner === 'white') === (color === 'w') ? 'win' : 'loss';
  const op = g['opening'] as Record<string, unknown> | undefined;
  const reasonByStatus: Record<string, string> = { mate: 'checkmate', resign: 'resignation', timeout: 'time', outoftime: 'time', draw: 'draw', stalemate: 'stalemate', cheat: 'violation' };
  return {
    url: `${BASE}/${id}`,
    endTime: Math.floor(when / 1000),
    timeClass: tc,
    color,
    outcome,
    reason: outcome === 'draw' ? (reasonByStatus[status] ?? status) : outcome === 'win' ? `won by ${reasonByStatus[status] ?? status}` : `lost by ${reasonByStatus[status] ?? status}`,
    opponent: nameOf(theirs) ?? '?',
    rating: num(mine?.['rating']),
    opponentRating: num(theirs?.['rating']),
    eco: typeof op?.['eco'] === 'string' ? op['eco'] : null,
    opening: typeof op?.['name'] === 'string' ? (op['name'].split(':')[0] ?? op['name']) : null,
    pgn,
    source: 'lichess',
  };
}

/** Parses an NDJSON body. Lines that are not valid JSON or not usable games are counted as skipped. */
export function parseLichessNdjson(text: string, username: string): { games: TrackedGame[]; skipped: number; oldest: number | null; lines: number } {
  const games: TrackedGame[] = [];
  let skipped = 0, lines = 0, oldest: number | null = null;
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    lines += 1;
    let obj: unknown;
    try { obj = JSON.parse(line); } catch { skipped += 1; continue; }
    const created = num((obj as Record<string, unknown> | null)?.['createdAt']);
    if (created !== null && (oldest === null || created < oldest)) oldest = created;
    const game = parseLichessGame(obj, username);
    if (game) games.push(game); else skipped += 1;
  }
  return { games, skipped, oldest, lines };
}

/** One page of a user's games (newest first). `until` (ms) fetches games created before that time. */
export async function fetchLichessGames(username: string, until: number | null, f: Fetch = fetch, max = LICHESS_PAGE) {
  if (!validLichessName(username)) throw new LichessError('Enter a valid Lichess username.', 'not-found');
  const params = new URLSearchParams({ max: String(max), pgnInJson: 'true', opening: 'true', clocks: 'false', evals: 'false', perfType: 'bullet,blitz,rapid,classical,correspondence' });
  if (until !== null) params.set('until', String(until - 1));
  const text = await getText(`${BASE}/api/games/user/${encodeURIComponent(username.trim())}?${params}`, 'application/x-ndjson', f);
  return parseLichessNdjson(text, username);
}

/** Game id from a Lichess link ("lichess.org/AbCdEfGh", "/AbCdEfGhIJKL/black", "#12" suffix); null if not one. */
export function lichessGameId(input: string): string | null {
  const m = /^(?:https?:\/\/)?(?:www\.)?lichess\.org\/(?:game\/export\/)?([A-Za-z0-9]{8})(?:[A-Za-z0-9]{4})?(?:[/?#].*)?$/.exec(input.trim());
  return m?.[1] ?? null;
}

export function isChessComGameLink(input: string): boolean {
  return /^(?:https?:\/\/)?(?:www\.)?chess\.com\/(?:game|analysis\/game)\//.test(input.trim());
}

/** PGN of a single finished Lichess game. */
export async function fetchLichessPgn(id: string, f: Fetch = fetch): Promise<string> {
  if (!/^[A-Za-z0-9]{8}$/.test(id)) throw new LichessError('That is not a Lichess game id.', 'not-found');
  return getText(`${BASE}/game/export/${id}?clocks=false&evals=false`, 'application/x-chess-pgn', f);
}
