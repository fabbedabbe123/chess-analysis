import { afterEach, describe, expect, it, vi } from 'vitest';
import { setStorageFailListener, storageSet } from '@/utils/storage';

describe('storage failure listener', () => {
  afterEach(() => { setStorageFailListener(null); vi.unstubAllGlobals(); vi.useRealTimers(); });
  it('reports a failed write once per minute', () => {
    vi.useFakeTimers(); vi.setSystemTime(1_000_000);
    vi.stubGlobal('localStorage', { setItem: () => { throw new Error('quota'); }, getItem: () => null, removeItem: () => {} });
    const seen: string[] = [];
    setStorageFailListener((k) => seen.push(k));
    expect(storageSet('a', '1')).toBe(false);
    expect(storageSet('b', '1')).toBe(false);
    expect(seen).toEqual(['a']);
    vi.setSystemTime(1_000_000 + 61_000);
    storageSet('c', '1');
    expect(seen).toEqual(['a', 'c']);
  });
});
