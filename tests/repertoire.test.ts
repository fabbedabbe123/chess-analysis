import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { TrackedGame } from '@/chesscom/api';
import type { OpeningBook } from '@/analysis/openings';
import { bookExit, buildRepertoire } from '@/strength/repertoire';

const book = JSON.parse(readFileSync('public/data/openings.json', 'utf8')) as OpeningBook;

const g = (pgn: string, over: Partial<TrackedGame> = {}): TrackedGame => ({
  url: `u${Math.random()}`, endTime: 1, timeClass: 'blitz', color: 'w', outcome: 'win', reason: 'x', opponent: 'o', rating: null, opponentRating: null,
  eco: 'C60', opening: 'Ruy Lopez', pgn, ...over,
});

describe('bookExit', () => {
  it('finds the first move out of book and who played it', () => {
    const e = bookExit('1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. h3 Nf6 5. d3 *', 'w', book);
    expect(e).not.toBe('unreadable');
    if (e === 'unreadable') return;
    expect(e.ply).toBe(7);
    expect(e.byMe).toBe(true);
    expect(e.label).toBe('4.h3');
    const b = bookExit('1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. h3 Nf6 5. d3 *', 'b', book);
    expect(b !== 'unreadable' && b.byMe).toBe(false);
  });
  it('reports unreadable PGN', () => {
    expect(bookExit('this is not chess', 'w', book)).toBe('unreadable');
    expect(bookExit('', 'w', book)).toBe('unreadable');
  });
});

describe('buildRepertoire', () => {
  it('aggregates per colour and opening, with the most common deviation', () => {
    const a = '1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. h3 Nf6 5. d3 *';
    const games = [g(a), g(a, { outcome: 'loss' }), g(a, { outcome: 'draw' }), g('1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O *', { outcome: 'win' }), g('garbage'), g(a, { opening: 'Other', color: 'b' })];
    const r = buildRepertoire(games, book);
    expect(r.unreadable).toBe(1);
    const row = r.rows.find((x) => x.name === 'Ruy Lopez' && x.color === 'w');
    expect(row).toMatchObject({ games: 4, win: 2, draw: 1, loss: 1 });
    expect(row?.topDeviation).toEqual({ label: '4.h3', count: 3 });
    expect(row?.youLeftPct).toBeGreaterThan(50);
    expect(row?.avgExitPly).toBeGreaterThan(6);
    expect(r.rows.some((x) => x.name === 'Other')).toBe(false); // single game below the minimum
  });
});
