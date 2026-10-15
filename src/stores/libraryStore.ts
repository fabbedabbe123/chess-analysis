import { storageGet, storageSet } from '@/utils/storage';
import { createStore, useStore } from './createStore';

export interface SavedGameEntry {
  id: string;
  title: string;
  pgn: string;
  savedAt: number;
}

interface LibraryState {
  games: SavedGameEntry[];
}

const KEY = 'chess-analysis:library:v1';
const MAX_GAMES = 100;

function isEntry(v: unknown): v is SavedGameEntry {
  if (typeof v !== 'object' || v === null) return false;
  const e = v as Record<string, unknown>;
  return typeof e['id'] === 'string' && typeof e['title'] === 'string' && typeof e['pgn'] === 'string' && typeof e['savedAt'] === 'number';
}

export function parseLibrary(text: string | null): SavedGameEntry[] {
  if (text === null) return [];
  try {
    const raw = JSON.parse(text) as unknown;
    return Array.isArray(raw) ? raw.filter(isEntry) : [];
  } catch {
    return [];
  }
}

export const libraryStore = createStore<LibraryState>({
  games: parseLibrary(storageGet(KEY)),
});

/** Returns false if the browser refused to store the data (e.g. quota exceeded). */
function persist(): boolean {
  try {
    return storageSet(KEY, JSON.stringify(libraryStore.get().games));
  } catch {
    return false;
  }
}

export function saveGameToLibrary(title: string, pgn: string): { ok: boolean; entry: SavedGameEntry } {
  const entry: SavedGameEntry = {
    id: `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    title: title.trim() || 'Untitled game',
    pgn,
    savedAt: Date.now(),
  };
  libraryStore.set((s) => ({ games: [entry, ...s.games].slice(0, MAX_GAMES) }));
  return { ok: persist(), entry };
}

export function deleteSavedGame(id: string): void {
  libraryStore.set((s) => ({ games: s.games.filter((g) => g.id !== id) }));
  persist();
}

export function useLibrary(): SavedGameEntry[] {
  return useStore(libraryStore, (s) => s.games);
}
