import { describe, expect, it } from 'vitest';
import { usernameProblem } from '@/sync/profile';

describe('usernameProblem', () => {
  it('accepts normal names', () => {
    for (const n of ['abc', 'Fabian_09', 'a_b_c', 'X'.repeat(20)]) expect(usernameProblem(n)).toBeNull();
  });
  it('rejects too short and too long', () => {
    expect(usernameProblem('ab')).toMatch(/At least 3/);
    expect(usernameProblem('x'.repeat(21))).toMatch(/At most 20/);
  });
  it('rejects spaces, symbols and non-ASCII', () => {
    for (const n of ['a b c', 'name!', 'åäö_x', 'a-b-c', 'a.b.c', '<b>x</b>']) expect(usernameProblem(n)).toMatch(/Only letters/);
  });
  it('rejects reserved names in any case', () => {
    for (const n of ['admin', 'ADMIN', 'Stockfish', 'null']) expect(usernameProblem(n)).toMatch(/reserved/);
  });
});

import { parseOverview, presenceOf } from '@/sync/social';

describe('online status text', () => {
  const row = (extra: Record<string, unknown>) => parseOverview([{ friendship_id: 'f', user_id: 'u', username: 'Bob', avatar: null, status: 'accepted', incoming: false, member_since: null, stats: null, ...extra }], 1_000_000)[0]!;
  it('is online within 150 s, with the activity', () => {
    expect(presenceOf(row({ seen_ago: 20, activity: 'puzzles' }), 1_000_000)).toEqual({ online: true, label: 'Online · Solving puzzles' });
    expect(presenceOf(row({ seen_ago: 20 }), 1_000_000)).toEqual({ online: true, label: 'Online' });
  });
  it('ages forward from when the data was fetched', () => {
    const f = row({ seen_ago: 100, activity: 'analysing' });
    expect(presenceOf(f, 1_000_000 + 30_000).online).toBe(true); // 130 s
    expect(presenceOf(f, 1_000_000 + 80_000).online).toBe(false); // 180 s
  });
  it('shows minutes, hours, then plain offline', () => {
    expect(presenceOf(row({ seen_ago: 300 }), 1_000_000).label).toBe('Last seen 5 min ago');
    expect(presenceOf(row({ seen_ago: 7200 }), 1_000_000).label).toBe('Last seen 2 h ago');
    expect(presenceOf(row({ seen_ago: 200000 }), 1_000_000).label).toBe('Offline');
  });
  it('is offline without a heartbeat and ignores junk values', () => {
    expect(presenceOf(row({}), 1_000_000).label).toBe('Offline');
    expect(presenceOf(row({ seen_ago: -5, activity: '<b>x</b>' }), 1_000_000).label).toBe('Offline');
    expect(presenceOf(row({ seen_ago: 10, activity: '<b>x</b>' }), 1_000_000).label).toBe('Online');
  });
});
