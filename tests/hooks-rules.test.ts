import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(f) ? [p] : [];
  });
}

/** Regression: `usePuzzle(..) || usePlay(..)` skips the second hook when the first is true and crashes React ("Rules of Hooks"). */
describe('rules of hooks', () => {
  it('never calls a hook on the right-hand side of || / && / ?:', () => {
    const bad: string[] = [];
    for (const f of files('src')) {
      readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        if (/\b(?:\|\||&&|\?)\s*use[A-Z][A-Za-z]*\(/.test(line) && !/^\s*(\/\/|\*)/.test(line)) bad.push(`${f}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(bad).toEqual([]);
  });
});

import { capturedBy } from '@/components/PlayerStrip';
describe('player strip material', () => {
  it('derives captured pieces and balance from the position', () => {
    expect(capturedBy('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1')).toEqual({ w: [], b: [], diff: 0 });
    const c = capturedBy('rnb1kbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNB1KBNR w KQkq - 0 3');
    expect(c.w).toEqual(['q']);
    expect(c.b).toEqual(['q']);
    expect(c.diff).toBe(0);
    expect(capturedBy('rnbqkbnr/ppp1pppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 3')).toMatchObject({ w: ['p'], diff: 1 });
  });
});
