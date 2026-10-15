import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  bookContinuations,
  ExplorerError,
  fetchExplorer,
  identifyOpening,
  openingAt,
  parseExplorerResponse,
  type OpeningBook,
} from '@/analysis/openings';
import { detectTactics } from '@/analysis/tactics';
import { START_FEN } from '@/chess/fen';
import { addMove, createTree, getNode, pathTo } from '@/chess/gameTree';

let book: OpeningBook;
beforeAll(() => {
  book = JSON.parse(readFileSync(resolve(__dirname, '../public/data/openings.json'), 'utf8')) as OpeningBook;
});

function fensOf(...sans: string[]): string[] {
  let tree = createTree();
  let id = tree.rootId;
  for (const san of sans) {
    const r = addMove(tree, id, san);
    if (!r.ok) throw new Error(r.error);
    tree = r.tree;
    id = r.nodeId;
  }
  return pathTo(tree, id).map((n) => getNode(tree, n).fen);
}

describe('opening book (offline, real Lichess dataset)', () => {
  it('contains the full dataset with ECO codes', () => {
    expect(book.entries.length).toBeGreaterThan(3500);
    expect(book.entries.every(([eco]) => /^[A-E]\d\d$/.test(eco))).toBe(true);
  });

  it('names well-known openings by position', () => {
    const sicilian = openingAt(book, fensOf('e4', 'c5').at(-1) as string);
    expect(sicilian?.eco).toBe('B20');
    expect(sicilian?.name).toContain('Sicilian');

    const ruy = openingAt(book, fensOf('e4', 'e5', 'Nf3', 'Nc6', 'Bb5').at(-1) as string);
    expect(ruy?.eco).toBe('C60');
    expect(ruy?.name).toContain('Ruy Lopez');

    expect(openingAt(book, START_FEN)).toBeNull(); // the starting position is not an opening
  });

  it('recognises transpositions (same position, different move order)', () => {
    const a = openingAt(book, fensOf('d4', 'Nf6', 'c4', 'e6', 'Nc3', 'Bb4').at(-1) as string);
    const b = openingAt(book, fensOf('c4', 'e6', 'Nc3', 'Nf6', 'd4', 'Bb4').at(-1) as string);
    expect(a).not.toBeNull();
    expect(b).toEqual(a);
    expect(a?.name).toContain('Nimzo-Indian');
  });

  it('identifies the opening of a longer game by walking back to the last named position', () => {
    const fens = fensOf('e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6', 'h3', 'h6', 'a3', 'a5');
    const opening = identifyOpening(book, fens);
    expect(opening?.name).toContain('Sicilian');
    expect(opening?.name).toContain('Najdorf');
    expect(identifyOpening(book, [START_FEN])).toBeNull();
  });

  it('lists book continuations with names and SAN', () => {
    const moves = bookContinuations(book, START_FEN);
    const sans = moves.map((m) => m.san);
    expect(sans).toContain('e4');
    expect(sans).toContain('d4');
    expect(sans).toContain('c4');
    const e4 = moves.find((m) => m.san === 'e4');
    expect(e4?.uci).toBe('e2e4');
    expect(e4?.opening.eco).toMatch(/^[A-E]\d\d$/);

    const afterE4 = bookContinuations(book, fensOf('e4').at(-1) as string).map((m) => m.san);
    expect(afterE4).toEqual(expect.arrayContaining(['e5', 'c5', 'e6', 'c6']));
  });

  it('returns nothing for positions that are not in the book', () => {
    expect(bookContinuations(book, '8/8/8/4k3/8/3K4/8/8 w - - 0 1')).toEqual([]);
    expect(bookContinuations(book, 'garbage')).toEqual([]);
  });
});

describe('Lichess explorer client (no network in tests)', () => {
  const good = {
    white: 100,
    draws: 50,
    black: 70,
    moves: [
      { uci: 'e2e4', san: 'e4', white: 60, draws: 30, black: 40, averageRating: 2400 },
      { uci: 'd2d4', san: 'd4', white: 40, draws: 20, black: 30 },
      { uci: 'bad', san: 'x' }, // malformed entries are skipped, never guessed
    ],
    opening: { eco: 'B00', name: "King's Pawn" },
  };

  const respond = (status: number, body: unknown): typeof fetch =>
    (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;

  it('parses a valid response and skips malformed moves', () => {
    const result = parseExplorerResponse(good, 'masters');
    expect(result).toMatchObject({ source: 'masters', white: 100, draws: 50, black: 70 });
    expect(result.moves).toHaveLength(2);
    expect(result.moves[0]).toEqual({ uci: 'e2e4', san: 'e4', white: 60, draws: 30, black: 40, averageRating: 2400 });
    expect(result.opening).toEqual({ eco: 'B00', name: "King's Pawn" });
  });

  it('rejects responses of an unexpected shape', () => {
    for (const bad of [null, 'x', {}, { white: 1, draws: 1, black: 1 }, { white: '1', draws: 1, black: 1, moves: [] }]) {
      expect(() => parseExplorerResponse(bad, 'lichess')).toThrow(ExplorerError);
    }
  });

  it('fetches and returns statistics', async () => {
    const result = await fetchExplorer(START_FEN, { source: 'masters', fetchImpl: respond(200, good) });
    expect(result.moves[0]?.san).toBe('e4');
  });

  it('maps failures to specific, user-explainable errors', async () => {
    const kind = async (fetchImpl: typeof fetch) =>
      fetchExplorer(START_FEN, { source: 'lichess', fetchImpl }).catch((e: ExplorerError) => e.kind);
    expect(await kind(respond(401, {}))).toBe('auth');
    expect(await kind(respond(403, {}))).toBe('auth');
    expect(await kind(respond(429, {}))).toBe('rate-limit');
    expect(await kind(respond(500, {}))).toBe('http');
    expect(await kind((async () => { throw new TypeError('Failed to fetch'); }) as typeof fetch)).toBe('network');
    expect(await kind((async () => new Response('<html>', { status: 200 })) as typeof fetch)).toBe('parse');
  });

  it('sends the FEN URL-encoded and the token as a bearer header only when provided', async () => {
    const seen: { url: string; auth: string | undefined }[] = [];
    const spy = (async (url: string, init?: RequestInit) => {
      seen.push({ url, auth: (init?.headers as Record<string, string>)['Authorization'] });
      return new Response(JSON.stringify(good), { status: 200 });
    }) as unknown as typeof fetch;
    await fetchExplorer(START_FEN, { source: 'masters', fetchImpl: spy });
    await fetchExplorer(START_FEN, { source: 'lichess', token: 'abc', fetchImpl: spy });
    expect(seen[0]?.url).toContain('https://explorer.lichess.ovh/masters?fen=rnbqkbnr%2Fpppppppp');
    expect(seen[0]?.auth).toBeUndefined();
    expect(seen[1]?.url).toContain('/lichess?');
    expect(seen[1]?.auth).toBe('Bearer abc');
  });
});

describe('tactical heuristics', () => {
  it('finds nothing in the starting position', () => {
    expect(detectTactics(START_FEN)).toEqual([]);
  });

  it('flags an attacked, undefended piece as hanging', () => {
    const hits = detectTactics('4k3/8/8/3n4/8/8/8/3QK3 w - - 0 1');
    const hanging = hits.find((h) => h.kind === 'hanging');
    expect(hanging).toBeDefined();
    expect(hanging?.color).toBe('b');
    expect(hanging?.squares).toEqual(['d5']);
    expect(hanging?.text).toContain('knight on d5');
  });

  it('flags a piece attacked by a cheaper one even if it is defended', () => {
    // White pawn e4 attacks black knight d5 which is defended by the queen d8
    const hits = detectTactics('3qk3/8/8/3n4/4P3/8/8/4K3 b - - 0 1');
    expect(hits.some((h) => h.kind === 'threatened' && h.squares[0] === 'd5')).toBe(true);
  });

  it('finds absolute pins', () => {
    const pin = detectTactics('4k3/4n3/8/8/8/8/8/4R1K1 b - - 0 1').find((h) => h.kind === 'pin');
    expect(pin?.color).toBe('b');
    expect(pin?.squares).toEqual(['e7', 'e1']);
    expect(pin?.text).toContain('pinned to the king');
  });

  it('does not report a pin when an extra piece stands between', () => {
    const hits = detectTactics('4k3/4n3/4p3/8/8/8/8/4R1K1 b - - 0 1');
    expect(hits.some((h) => h.kind === 'pin')).toBe(false);
  });

  it('finds a knight fork of king and rook', () => {
    const fork = detectTactics('r3k3/8/8/3N4/8/8/8/4K3 w - - 0 1').find((h) => h.kind === 'fork');
    expect(fork).toBeDefined();
    expect(fork?.text).toContain('Nc7+');
    expect(fork?.squares).toContain('c7');
  });

  it('returns an empty list for an invalid FEN instead of throwing', () => {
    expect(detectTactics('not a fen')).toEqual([]);
  });
});
