import { describe, expect, it } from 'vitest';
import { syncConfig } from '@/sync/config';
import { runSync, EMPTY_META, type LocalData, type Remote, type RemoteRow, type SyncMeta } from '@/sync/engine';
import { hashText, mergeValues } from '@/sync/merge';
import { localStorageData } from '@/sync/local';
import { loadMeta } from '@/sync/syncStore';
import type { SyncName } from '@/sync/keys';

class FakeLocal implements LocalData {
  data = new Map<string, string>();
  writes: string[] = [];
  read(name: SyncName) { return this.data.get(name) ?? null; }
  write(name: SyncName, text: string) { this.data.set(name, text); this.writes.push(name); }
}
class FakeRemote implements Remote {
  rows = new Map<string, RemoteRow>();
  upserts: string[] = [];
  fail = false;
  async fetchAll() { return [...this.rows.values()]; }
  async upsert(rows: { name: SyncName; value: string }[]) {
    if (this.fail) throw new Error('network down');
    for (const r of rows) { this.rows.set(r.name, { name: r.name, value: r.value, updatedAt: 1000 }); this.upserts.push(r.name); }
  }
}
const meta = (over: Partial<SyncMeta> = {}): SyncMeta => ({ ...EMPTY_META, base: {}, touched: {}, ...over });
const game = (id: string, endedAt: number) => ({ id, endedAt, x: 1 });

describe('config', () => {
  it('is off without both values or with malformed ones', () => {
    expect(syncConfig({})).toBeNull();
    expect(syncConfig({ VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: '' })).toBeNull();
    expect(syncConfig({ VITE_SUPABASE_URL: 'http://abc.supabase.co', VITE_SUPABASE_ANON_KEY: 'x'.repeat(40) })).toBeNull();
    expect(syncConfig({ VITE_SUPABASE_URL: 'https://evil.example.com', VITE_SUPABASE_ANON_KEY: 'x'.repeat(40) })).toBeNull();
    expect(syncConfig({ VITE_SUPABASE_URL: 'https://abc.supabase.co', VITE_SUPABASE_ANON_KEY: 'short' })).toBeNull();
  });
  it('accepts a real-looking project url and trims it', () => {
    expect(syncConfig({ VITE_SUPABASE_URL: ' https://abcdefg.supabase.co/ ', VITE_SUPABASE_ANON_KEY: ` ${'k'.repeat(40)} ` })).toEqual({ url: 'https://abcdefg.supabase.co', anonKey: 'k'.repeat(40) });
  });
});

describe('mergeValues', () => {
  it('unions lists of records by id, newest first, and prefers this device for the same id', () => {
    const local = JSON.stringify([{ ...game('a', 5), x: 'local' }, game('b', 3)]);
    const remote = JSON.stringify([{ ...game('a', 5), x: 'remote' }, game('c', 9)]);
    const out = JSON.parse(mergeValues('strength-games', local, remote, true)) as { id: string; x: unknown }[];
    expect(out.map((g) => g.id)).toEqual(['c', 'a', 'b']);
    expect(out.find((g) => g.id === 'a')?.x).toBe('local');
  });
  it('caps a merged list at the app limit', () => {
    const many = (p: string) => JSON.stringify(Array.from({ length: 120 }, (_, i) => ({ id: `${p}${i}`, savedAt: i })));
    expect((JSON.parse(mergeValues('library', many('l'), many('r'), true)) as unknown[]).length).toBe(100);
  });
  it('merges puzzle progress entry by entry', () => {
    const local = JSON.stringify({ solved: { p1: { attempts: 2, clean: false }, p2: { attempts: 1, clean: true } }, streak: 1, bestStreak: 4, srs: { p1: { box: 1, due: 10 } } });
    const remote = JSON.stringify({ solved: { p1: { attempts: 1, clean: true }, p3: { attempts: 1, clean: true } }, streak: 3, bestStreak: 2, srs: { p1: { box: 2, due: 50 } } });
    const out = JSON.parse(mergeValues('puzzles', local, remote, true)) as { solved: Record<string, { clean: boolean }>; streak: number; bestStreak: number; srs: Record<string, { box: number }> };
    expect(Object.keys(out.solved).sort()).toEqual(['p1', 'p2', 'p3']);
    expect(out.solved['p1']?.clean).toBe(true);
    expect(out.streak).toBe(3);
    expect(out.bestStreak).toBe(4);
    expect(out.srs['p1']?.box).toBe(2);
  });
  it('other values: the newer side wins as a whole; unreadable JSON falls back to the newer side', () => {
    expect(mergeValues('settings', '{"a":1}', '{"a":2}', true)).toBe('{"a":1}');
    expect(mergeValues('settings', '{"a":1}', '{"a":2}', false)).toBe('{"a":2}');
    expect(mergeValues('library', 'not json', '[]', false)).toBe('[]');
  });
});

describe('runSync', () => {
  it('first sync with an empty cloud uploads everything this device has', async () => {
    const l = new FakeLocal(); const r = new FakeRemote();
    l.data.set('library', '[]'); l.data.set('settings', '{"theme":"dark"}');
    const { result, meta: m } = await runSync(r, l, meta(), 'u1');
    expect(result.pushed.sort()).toEqual(['library', 'settings']);
    expect(r.rows.size).toBe(2);
    expect(m.userId).toBe('u1');
    expect(m.base['library']).toBe(hashText('[]'));
  });
  it('a new device downloads what the cloud has', async () => {
    const l = new FakeLocal(); const r = new FakeRemote();
    r.rows.set('library', { name: 'library', value: '[{"id":"x"}]', updatedAt: 5 });
    const { result } = await runSync(r, l, meta(), 'u1');
    expect(result.pulled).toEqual(['library']);
    expect(l.data.get('library')).toBe('[{"id":"x"}]');
    expect(r.upserts).toEqual([]);
  });
  it('after a sync, only the side that changed is copied', async () => {
    const l = new FakeLocal(); const r = new FakeRemote();
    l.data.set('settings', 'A'); r.rows.set('settings', { name: 'settings', value: 'A', updatedAt: 1 });
    let m = (await runSync(r, l, meta(), 'u1')).meta;
    l.data.set('settings', 'B'); // local edit
    let out = await runSync(r, l, m, 'u1'); m = out.meta;
    expect(out.result.pushed).toEqual(['settings']); expect(r.rows.get('settings')?.value).toBe('B');
    r.rows.set('settings', { name: 'settings', value: 'C', updatedAt: 9 }); // edit elsewhere
    out = await runSync(r, l, m, 'u1'); m = out.meta;
    expect(out.result.pulled).toEqual(['settings']); expect(l.data.get('settings')).toBe('C');
    out = await runSync(r, l, m, 'u1');
    expect(out.result.pushed.length + out.result.pulled.length + out.result.merged.length).toBe(0);
  });
  it('both sides changed: lists are merged and both sides end up equal', async () => {
    const l = new FakeLocal(); const r = new FakeRemote();
    const base = JSON.stringify([game('a', 1)]);
    l.data.set('strength-games', base); r.rows.set('strength-games', { name: 'strength-games', value: base, updatedAt: 1 });
    const m = (await runSync(r, l, meta(), 'u1')).meta;
    l.data.set('strength-games', JSON.stringify([game('b', 3), game('a', 1)]));
    r.rows.set('strength-games', { name: 'strength-games', value: JSON.stringify([game('c', 5), game('a', 1)]), updatedAt: 9 });
    const out = await runSync(r, l, m, 'u1');
    expect(out.result.merged).toEqual(['strength-games']);
    const ids = (JSON.parse(l.data.get('strength-games') ?? '[]') as { id: string }[]).map((g) => g.id);
    expect(ids).toEqual(['c', 'b', 'a']);
    expect(r.rows.get('strength-games')?.value).toBe(l.data.get('strength-games'));
  });
  it('both changed a non-list value: the newer edit wins', async () => {
    const l = new FakeLocal(); const r = new FakeRemote();
    l.data.set('settings', '{"v":0}'); r.rows.set('settings', { name: 'settings', value: '{"v":0}', updatedAt: 1 });
    const m = (await runSync(r, l, meta(), 'u1')).meta;
    l.data.set('settings', '{"v":"local"}'); m.touched['settings'] = 500;
    r.rows.set('settings', { name: 'settings', value: '{"v":"remote"}', updatedAt: 900 });
    await runSync(r, l, m, 'u1');
    expect(l.data.get('settings')).toBe('{"v":"remote"}');
    l.data.set('settings', '{"v":"local2"}'); r.rows.set('settings', { name: 'settings', value: '{"v":"remote2"}', updatedAt: 900 });
    const m2 = meta({ userId: 'u1', base: { settings: hashText('{"v":"remote"}') }, touched: { settings: 2000 } });
    await runSync(r, l, m2, 'u1');
    expect(r.rows.get('settings')?.value).toBe('{"v":"local2"}');
  });
  it('data last synced by ANOTHER account is never uploaded; the cloud data replaces it', async () => {
    const l = new FakeLocal(); const r = new FakeRemote();
    l.data.set('library', '[{"id":"private"}]'); l.data.set('puzzles', '{"solved":{}}');
    r.rows.set('library', { name: 'library', value: '[]', updatedAt: 1 });
    const { result } = await runSync(r, l, meta({ userId: 'other-user', base: { library: 'x' } }), 'u2');
    expect(result.foreignData).toBe(true);
    expect(result.pushed).toEqual([]);
    expect(r.upserts).toEqual([]);
    expect(l.data.get('library')).toBe('[]');
  });
  it('an upload failure throws, so the caller keeps its old meta and retries later', async () => {
    const l = new FakeLocal(); const r = new FakeRemote(); r.fail = true;
    l.data.set('library', '[]');
    await expect(runSync(r, l, meta(), 'u1')).rejects.toThrow('network down');
  });
  it('a value that is too large stays on this device', async () => {
    const l = new FakeLocal(); const r = new FakeRemote();
    l.data.set('library', JSON.stringify(['x'.repeat(2_100_000)]));
    const { result } = await runSync(r, l, meta(), 'u1');
    expect(result.skipped[0]?.name).toBe('library');
    expect(r.rows.size).toBe(0);
  });
});

describe('localStorageData', () => {
  const mem = () => { const m = new Map<string, string>(); return { m, s: { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } } }; };
  it('never reads or overwrites the Lichess token in the settings', () => {
    const { m, s } = mem();
    m.set('chess-analysis:settings:v1', JSON.stringify({ theme: 'dark', explorerToken: 'lip_secret' }));
    const d = localStorageData(s);
    expect(d.read('settings')).toBe('{"theme":"dark"}');
    d.write('settings', '{"theme":"light"}');
    expect(JSON.parse(m.get('chess-analysis:settings:v1') ?? '{}')).toEqual({ theme: 'light', explorerToken: 'lip_secret' });
  });
  it('accounts: reads usernames from the trackers and writes a new one only when different', () => {
    const { m, s } = mem();
    const d = localStorageData(s);
    expect(d.read('accounts')).toBeNull();
    m.set('chess-analysis:tracker:v1', JSON.stringify({ username: 'fabbed', games: [{ x: 1 }] }));
    expect(JSON.parse(d.read('accounts') ?? '{}')).toEqual({ chesscom: 'fabbed', lichess: null });
    d.write('accounts', JSON.stringify({ chesscom: 'FABBED', lichess: 'fabbed' }));
    expect(m.get('chess-analysis:tracker:v1')).toContain('"games"'); // same user (case-insensitive): downloaded games are kept
    expect(JSON.parse(m.get('chess-analysis:lichess:v1') ?? '{}')).toEqual({ username: 'fabbed' });
    d.write('accounts', JSON.stringify({ chesscom: 'someone', lichess: null }));
    expect(JSON.parse(m.get('chess-analysis:tracker:v1') ?? '{}')).toEqual({ username: 'someone' });
  });
  it('writes everything else as is', () => {
    const { m, s } = mem();
    localStorageData(s).write('library', '[1]');
    expect(m.get('chess-analysis:library:v1')).toBe('[1]');
  });
});

describe('loadMeta', () => {
  it('survives garbage', () => {
    expect(loadMeta(null).userId).toBeNull();
    expect(loadMeta('{{').base).toEqual({});
    expect(loadMeta(JSON.stringify({ userId: 'u', base: { a: 'h' }, touched: 5 }))).toEqual({ userId: 'u', base: { a: 'h' }, touched: {} });
  });
});
