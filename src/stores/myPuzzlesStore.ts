import { decodePuzzleCode, MAX_MY_PUZZLES, parseMyPuzzles } from '@/puzzles/myPuzzles';
import { notify } from './gameStore';
import type { Puzzle } from '@/puzzles/puzzles';
import { storageGet, storageSet } from '@/utils/storage';
import { createStore, useStore } from './createStore';

const KEY = 'chess-analysis:my-puzzles:v1';

interface MyPuzzlesState {
  puzzles: Puzzle[];
}

export const myPuzzlesStore = createStore<MyPuzzlesState>({ puzzles: parseMyPuzzles(storageGet(KEY)) });

export function useMyPuzzles<S>(selector: (s: MyPuzzlesState) => S): S {
  return useStore(myPuzzlesStore, selector);
}

function persist(): boolean {
  try {
    return storageSet(KEY, JSON.stringify(myPuzzlesStore.get().puzzles));
  } catch {
    return false;
  }
}

/** Add (newest first). The same puzzle (same id) is replaced, not duplicated. `ok` is false when the list is full. */
export function addMyPuzzle(p: Puzzle): { ok: boolean; added: boolean; saved: boolean } {
  const cur = myPuzzlesStore.get().puzzles;
  const exists = cur.some((x) => x.id === p.id);
  if (!exists && cur.length >= MAX_MY_PUZZLES) return { ok: false, added: false, saved: false };
  myPuzzlesStore.set({ puzzles: [p, ...cur.filter((x) => x.id !== p.id)] });
  return { ok: true, added: !exists, saved: persist() };
}

export function deleteMyPuzzle(id: string): void {
  myPuzzlesStore.set((s) => ({ puzzles: s.puzzles.filter((p) => p.id !== id) }));
  persist();
}

/** A link like `…/#p=cp1.…` adds that puzzle (once) and clears the address bar. Called once at start-up. */
export function importPuzzleFromLocation(): void {
  if (typeof window === 'undefined' || !/[#&]p=cp1\./.test(window.location.hash)) return;
  const r = decodePuzzleCode(window.location.hash);
  try {
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
  } catch {
    // ignore
  }
  if (!r.ok) { notify('error', `Puzzle link not added: ${r.error}`); return; }
  const res = addMyPuzzle(r.puzzle);
  notify(res.ok ? 'info' : 'warning', !res.ok ? 'Puzzle link not added: you have the maximum number of own puzzles.' : res.added ? `Puzzle “${r.puzzle.title ?? 'Puzzle'}” added. Find it under Train → Puzzles → My puzzles.` : 'You already have that puzzle (Train → Puzzles → My puzzles).');
}
