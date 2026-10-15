import { describe, expect, it } from 'vitest';
import { appKeys, applyBackup, collectBackup, describeBackup, parseBackup } from '@/utils/backup';

class MemStorage {
  private m = new Map<string, string>();
  failAfter = Infinity;
  private writes = 0;
  constructor(init: Record<string, string> = {}) { for (const [k, v] of Object.entries(init)) this.m.set(k, v); }
  get length() { return this.m.size; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.writes += 1; if (this.writes === this.failAfter + 1) throw new Error('quota'); this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
  snapshot() { return Object.fromEntries(this.m); }
}

describe('backup', () => {
  it('collects only our own keys and never the Lichess token', () => {
    const s = new MemStorage({ 'chess-analysis:settings:v1': JSON.stringify({ theme: 'dark', explorerToken: 'lip_secret' }), 'chess-analysis:game:v1': '{"a":1}', 'other-app:x': '1' });
    const b = collectBackup(s, new Date('2026-10-15T10:00:00Z'));
    expect(Object.keys(b.data).sort()).toEqual(['chess-analysis:game:v1', 'chess-analysis:settings:v1']);
    expect(b.data['chess-analysis:settings:v1']).not.toContain('lip_secret');
    expect(JSON.parse(b.data['chess-analysis:settings:v1'] as string)).toEqual({ theme: 'dark' });
    expect(b.exportedAt).toBe('2026-10-15T10:00:00.000Z');
  });

  it('round-trips', () => {
    const a = new MemStorage({ 'chess-analysis:game:v1': '{"x":[1,2]}', 'chess-analysis:puzzles:v1': '{"solved":{}}' });
    const parsed = parseBackup(JSON.stringify(collectBackup(a)));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const b = new MemStorage({ 'chess-analysis:tracker:v1': '{"old":true}', 'unrelated': 'keep' });
    expect(applyBackup(parsed.backup, b).ok).toBe(true);
    expect(b.snapshot()).toEqual({ 'unrelated': 'keep', 'chess-analysis:game:v1': '{"x":[1,2]}', 'chess-analysis:puzzles:v1': '{"solved":{}}' });
    expect(appKeys(b)).toHaveLength(2);
  });

  it('rejects anything that is not a well-formed backup', () => {
    const good = { app: 'chess-analysis', format: 1, exportedAt: 'x', data: { 'chess-analysis:game:v1': '{}' } };
    expect(parseBackup(JSON.stringify(good)).ok).toBe(true);
    const bad: unknown[] = [
      'not json{', 'null', '[]', { ...good, app: 'other' }, { ...good, format: 2 }, { ...good, data: null }, { ...good, data: {} },
      { ...good, data: { 'evil:key': '{}' } }, { ...good, data: { 'chess-analysis:../x': '{}' } }, { ...good, data: { 'chess-analysis:game:v1': 5 } },
      { ...good, data: { 'chess-analysis:game:v1': '{broken' } },
      { ...good, data: Object.fromEntries(Array.from({ length: 80 }, (_, i) => [`chess-analysis:k${i}`, '1'])) },
    ];
    for (const b of bad) expect(parseBackup(typeof b === 'string' ? b : JSON.stringify(b)).ok, JSON.stringify(b)?.slice(0, 60)).toBe(false);
  });

  it('a failed restore puts the previous data back', () => {
    const s = new MemStorage({ 'chess-analysis:game:v1': '{"keep":1}' });
    const parsed = parseBackup(JSON.stringify({ app: 'chess-analysis', format: 1, exportedAt: '', data: { 'chess-analysis:a:v1': '1', 'chess-analysis:b:v1': '2' } }));
    if (!parsed.ok) throw new Error('setup');
    s.failAfter = 1; // the second write throws
    const r = applyBackup(parsed.backup, s);
    expect(r.ok).toBe(false);
    s.failAfter = Infinity;
    expect(s.snapshot()).toEqual({ 'chess-analysis:game:v1': '{"keep":1}' });
  });

  it('describes what is inside', () => {
    const text = describeBackup(['chess-analysis:strength-games:v1', 'chess-analysis:play-history:v1'], { 'chess-analysis:strength-games:v1': '[1,2,3]', 'chess-analysis:play-history:v1': '[1]' });
    expect(text).toContain('3 analysed games');
    expect(text).toContain('1 played game');
  });
});
