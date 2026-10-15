import { Chess } from 'chess.js';
import { positionKey } from '@/chess/fen';
import { splitUci } from './pv';

/**
 * Opening data sources
 * --------------------
 * 1. OFFLINE BOOK (always available): the Lichess "chess-openings" dataset (ECO code + name
 *    for 3,865 lines, CC0), indexed by POSITION so transpositions are recognised. It gives
 *    the opening name and the named book continuations. It contains NO game statistics.
 * 2. LICHESS EXPLORER (optional, needs internet and possibly an API token): real game counts
 *    and win/draw/loss statistics. If it is unreachable the UI falls back to (1) and says so.
 *    No statistic is ever invented or estimated.
 */

export interface OpeningBook {
  /** [eco, name, "uci uci uci"] */
  entries: [string, string, string][];
  /** positionKey -> entry indexes whose line ends exactly at this position */
  index: Record<string, number[]>;
  /** positionKey -> [uci, entry index of the shortest named line using that move][] */
  next: Record<string, [string, number][]>;
}

export interface OpeningInfo {
  eco: string;
  name: string;
}

export interface BookMove {
  uci: string;
  san: string;
  opening: OpeningInfo;
}

let bookPromise: Promise<OpeningBook> | null = null;

/** Lazily fetch the opening book (a static file, ~165 KB gzipped). Retries after a failure. */
export function loadOpeningBook(baseUrl: string = import.meta.env.BASE_URL): Promise<OpeningBook> {
  if (bookPromise === null) {
    const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
    bookPromise = fetch(`${base}data/openings.json`)
      .then((res) => {
        if (!res.ok) throw new Error(`Opening book not available (HTTP ${res.status})`);
        return res.json() as Promise<OpeningBook>;
      })
      .catch((error: unknown) => {
        bookPromise = null; // allow a retry later
        throw error;
      });
  }
  return bookPromise;
}

/** Test helper: provide a book without fetching. */
export function setOpeningBookForTests(book: OpeningBook | null): void {
  bookPromise = book === null ? null : Promise.resolve(book);
}

function infoOf(book: OpeningBook, entryIndex: number): OpeningInfo | null {
  const entry = book.entries[entryIndex];
  return entry === undefined ? null : { eco: entry[0], name: entry[1] };
}

/** The named opening that ends exactly at this position, if any. */
export function openingAt(book: OpeningBook, fen: string): OpeningInfo | null {
  const hit = book.index[positionKey(fen)];
  const first = hit?.[0];
  return first === undefined ? null : infoOf(book, first);
}

/**
 * Identify the opening of a game: walk the positions of the line BACKWARDS and
 * return the last position that has a name (the suggested approach of the dataset).
 */
export function identifyOpening(book: OpeningBook, fensAlongLine: readonly string[]): OpeningInfo | null {
  for (let i = fensAlongLine.length - 1; i >= 0; i -= 1) {
    const info = openingAt(book, fensAlongLine[i] as string);
    if (info !== null) return info;
  }
  return null;
}

/** Named book moves from this position (offline, no statistics). */
export function bookContinuations(book: OpeningBook, fen: string): BookMove[] {
  const list = book.next[positionKey(fen)];
  if (list === undefined) return [];
  const result: BookMove[] = [];
  for (const [uci, entryIndex] of list) {
    const parts = splitUci(uci);
    const opening = infoOf(book, entryIndex);
    if (parts === null || opening === null) continue;
    try {
      const chess = new Chess(fen);
      const move = chess.move(parts);
      result.push({ uci, san: move.san, opening });
    } catch {
      // The book move is not legal here (cannot happen for a keyed position); skip defensively.
    }
  }
  return result;
}

// -------------------------------------------------------------- explorer (online)

export type ExplorerSource = 'masters' | 'lichess';

export interface ExplorerMove {
  uci: string;
  san: string;
  white: number;
  draws: number;
  black: number;
  averageRating?: number;
}

export interface ExplorerResult {
  source: ExplorerSource;
  white: number;
  draws: number;
  black: number;
  moves: ExplorerMove[];
  opening: OpeningInfo | null;
}

export class ExplorerError extends Error {
  constructor(
    message: string,
    readonly kind: 'network' | 'auth' | 'rate-limit' | 'http' | 'parse' | 'aborted',
  ) {
    super(message);
    this.name = 'ExplorerError';
  }
}

interface RawExplorerMove {
  uci?: unknown;
  san?: unknown;
  white?: unknown;
  draws?: unknown;
  black?: unknown;
  averageRating?: unknown;
}

interface RawExplorerResponse {
  white?: unknown;
  draws?: unknown;
  black?: unknown;
  moves?: unknown;
  opening?: { eco?: unknown; name?: unknown } | null;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Validate an explorer response; anything unexpected is a parse error (never guessed). */
export function parseExplorerResponse(raw: unknown, source: ExplorerSource): ExplorerResult {
  if (typeof raw !== 'object' || raw === null) throw new ExplorerError('Unexpected explorer response', 'parse');
  const r = raw as RawExplorerResponse;
  if (!isNum(r.white) || !isNum(r.draws) || !isNum(r.black) || !Array.isArray(r.moves)) {
    throw new ExplorerError('Unexpected explorer response format', 'parse');
  }
  const moves: ExplorerMove[] = [];
  for (const m of r.moves as RawExplorerMove[]) {
    if (typeof m.uci !== 'string' || typeof m.san !== 'string' || !isNum(m.white) || !isNum(m.draws) || !isNum(m.black)) {
      continue;
    }
    const move: ExplorerMove = { uci: m.uci, san: m.san, white: m.white, draws: m.draws, black: m.black };
    if (isNum(m.averageRating)) move.averageRating = m.averageRating;
    moves.push(move);
  }
  const opening =
    r.opening && typeof r.opening.eco === 'string' && typeof r.opening.name === 'string'
      ? { eco: r.opening.eco, name: r.opening.name }
      : null;
  return { source, white: r.white, draws: r.draws, black: r.black, moves, opening };
}

export interface ExplorerOptions {
  source: ExplorerSource;
  /** Optional Lichess API token (some deployments of the explorer require one). */
  token?: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

export async function fetchExplorer(fen: string, options: ExplorerOptions): Promise<ExplorerResult> {
  const doFetch = options.fetchImpl ?? fetch;
  const url = `https://explorer.lichess.ovh/${options.source}?fen=${encodeURIComponent(fen)}&moves=12`;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.token !== undefined && options.token.length > 0) headers['Authorization'] = `Bearer ${options.token}`;

  let res: Response;
  try {
    res = await doFetch(url, { headers, ...(options.signal ? { signal: options.signal } : {}) });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw new ExplorerError('Request cancelled', 'aborted');
    throw new ExplorerError('Could not reach the Lichess explorer (offline or blocked).', 'network');
  }
  if (res.status === 401 || res.status === 403) {
    throw new ExplorerError('The Lichess explorer requires an API token (add one in Settings).', 'auth');
  }
  if (res.status === 429) throw new ExplorerError('The Lichess explorer is rate limiting requests. Try again shortly.', 'rate-limit');
  if (!res.ok) throw new ExplorerError(`The Lichess explorer answered HTTP ${res.status}.`, 'http');
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new ExplorerError('The explorer response was not valid JSON.', 'parse');
  }
  return parseExplorerResponse(json, options.source);
}
