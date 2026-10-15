/**
 * Chess.com Published-Data API client (https://www.chess.com/news/view/published-data-api).
 * Public, read-only, no API key. Works from the browser because the API sends CORS headers.
 * Every failure is mapped to a message the user can act on; nothing is invented.
 */

export type TimeClass = 'bullet' | 'blitz' | 'rapid' | 'daily';
export type Outcome = 'win' | 'draw' | 'loss';

export interface TrackedGame {
  /** chess.com game URL (unique). */
  url: string;
  endTime: number; // unix seconds
  timeClass: TimeClass;
  color: 'w' | 'b';
  outcome: Outcome;
  /** chess.com result code of the tracked player (e.g. "checkmated", "resigned"). */
  reason: string;
  opponent: string;
  rating: number | null;
  opponentRating: number | null;
  eco: string | null;
  opening: string | null;
  pgn: string;
}

export class ChessComError extends Error {
  constructor(message: string, readonly kind: 'not-found' | 'rate-limit' | 'network' | 'bad-data' | 'http') {
    super(message);
  }
}

const BASE = 'https://api.chess.com/pub';
const USERNAME_RE = /^[A-Za-z0-9_-]{2,50}$/;

export function validUsername(name: string): boolean {
  return USERNAME_RE.test(name.trim());
}

type Fetch = typeof fetch;

async function getJson(url: string, f: Fetch, timeoutMs = 15000): Promise<unknown> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await f(url, { signal: ctl.signal, headers: { Accept: 'application/json' } });
  } catch (e) {
    throw new ChessComError(
      (e as Error).name === 'AbortError' ? 'Chess.com did not answer in time.' : 'Could not reach Chess.com (offline, blocked, or the service is down).',
      'network',
    );
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 404) throw new ChessComError('No such Chess.com player.', 'not-found');
  if (res.status === 429) throw new ChessComError('Chess.com is rate limiting requests. Wait a minute and try again.', 'rate-limit');
  if (!res.ok) throw new ChessComError(`Chess.com returned HTTP ${res.status}.`, 'http');
  try {
    return await res.json();
  } catch {
    throw new ChessComError('Chess.com returned data that is not valid JSON.', 'bad-data');
  }
}

/** Monthly archive URLs, oldest first. */
export async function fetchArchives(username: string, f: Fetch = fetch): Promise<string[]> {
  if (!validUsername(username)) throw new ChessComError('Enter a valid Chess.com username.', 'not-found');
  const data = await getJson(`${BASE}/player/${encodeURIComponent(username.trim().toLowerCase())}/games/archives`, f);
  const list = (data as { archives?: unknown }).archives;
  if (!Array.isArray(list)) throw new ChessComError('Unexpected archive list from Chess.com.', 'bad-data');
  return list.filter((x): x is string => typeof x === 'string' && x.startsWith(`${BASE}/player/`)).sort();
}

const DRAWS = new Set(['agreed', 'repetition', 'stalemate', 'insufficient', '50move', 'timevsinsufficient']);

export function outcomeOf(code: string): Outcome {
  if (code === 'win') return 'win';
  return DRAWS.has(code) ? 'draw' : 'loss';
}

function header(pgn: string, tag: string): string | null {
  const m = new RegExp(`^\\[${tag}\\s+"([^"]*)"\\]`, 'm').exec(pgn);
  return m?.[1] ?? null;
}

/** "Sicilian-Defense-Open-Najdorf-Variation-6.Be3" -> "Sicilian Defense Open Najdorf Variation" */
export function openingFromUrl(url: string | null): string | null {
  if (url === null) return null;
  const slug = url.split('/').pop() ?? '';
  const words: string[] = [];
  for (const w of slug.split('-')) {
    if (/\d/.test(w) || w === '') break;
    words.push(w);
  }
  return words.length === 0 ? null : words.slice(0, 5).join(' ');
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Converts one monthly archive into tracked games for `username`. Skips non-standard chess and malformed entries. */
export function parseMonth(data: unknown, username: string): { games: TrackedGame[]; skipped: number } {
  const raw = (data as { games?: unknown }).games;
  if (!Array.isArray(raw)) throw new ChessComError('Unexpected month data from Chess.com.', 'bad-data');
  const me = username.trim().toLowerCase();
  const games: TrackedGame[] = [];
  let skipped = 0;
  for (const g of raw as Record<string, unknown>[]) {
    const white = g['white'] as Record<string, unknown> | undefined;
    const black = g['black'] as Record<string, unknown> | undefined;
    const pgn = g['pgn'];
    const tc = g['time_class'];
    if (g['rules'] !== 'chess' || typeof pgn !== 'string' || typeof g['url'] !== 'string' || !white || !black
      || (tc !== 'bullet' && tc !== 'blitz' && tc !== 'rapid' && tc !== 'daily') || typeof g['end_time'] !== 'number') {
      skipped += 1;
      continue;
    }
    const wName = String(white['username'] ?? '').toLowerCase();
    const bName = String(black['username'] ?? '').toLowerCase();
    const color = wName === me ? 'w' : bName === me ? 'b' : null;
    if (color === null) { skipped += 1; continue; }
    const mine = color === 'w' ? white : black;
    const theirs = color === 'w' ? black : white;
    const ecoUrl = header(pgn, 'ECOUrl');
    games.push({
      url: g['url'],
      endTime: g['end_time'],
      timeClass: tc,
      color,
      outcome: outcomeOf(String(mine['result'])),
      reason: String(mine['result']),
      opponent: String(theirs['username'] ?? '?'),
      rating: num(mine['rating']),
      opponentRating: num(theirs['rating']),
      eco: header(pgn, 'ECO'),
      opening: openingFromUrl(ecoUrl),
      pgn,
    });
  }
  return { games, skipped };
}

export async function fetchMonth(url: string, username: string, f: Fetch = fetch) {
  if (!url.startsWith(`${BASE}/player/`)) throw new ChessComError('Refusing to fetch a non-Chess.com URL.', 'bad-data');
  return parseMonth(await getJson(url, f), username);
}

/** Chess.com adds a clock tag to every move; removed on load so the move list is not full of "[%clk ...]". */
export function stripClockTags(pgn: string): string {
  return pgn.replace(/\{\s*(?:\[%(?:clk|emt)\s+[^\]]*\]\s*)+\}/g, '').replace(/\[%(?:clk|emt)\s+[^\]]*\]/g, '');
}
