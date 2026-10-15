import { ChessComError, fetchArchives, fetchMonth, validUsername, type TrackedGame } from '@/chesscom/api';
import { storageGet, storageSet } from '@/utils/storage';
import { createStore, useStore } from './createStore';

const KEY = 'chess-analysis:tracker:v1';
export const MAX_TRACKED = 600;
const DEFAULT_MONTHS = 3;

export interface TrackerState {
  username: string | null;
  games: TrackedGame[];
  /** archive URLs already downloaded completely (the newest month is always refetched). */
  fetchedMonths: string[];
  allArchives: string[];
  lastSync: number | null;
  status: 'idle' | 'syncing';
  error: string | null;
  note: string | null;
}

const EMPTY: TrackerState = { username: null, games: [], fetchedMonths: [], allArchives: [], lastSync: null, status: 'idle', error: null, note: null };

function isGame(g: unknown): g is TrackedGame {
  if (typeof g !== 'object' || g === null) return false;
  const r = g as Record<string, unknown>;
  return typeof r['url'] === 'string' && typeof r['pgn'] === 'string' && typeof r['endTime'] === 'number'
    && (r['color'] === 'w' || r['color'] === 'b') && ['win', 'draw', 'loss'].includes(String(r['outcome']))
    && ['bullet', 'blitz', 'rapid', 'daily'].includes(String(r['timeClass']));
}

export function parseTracker(text: string | null): TrackerState {
  if (text === null) return { ...EMPTY };
  try {
    const r = JSON.parse(text) as Record<string, unknown>;
    const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
    return {
      ...EMPTY,
      username: typeof r['username'] === 'string' ? r['username'] : null,
      games: Array.isArray(r['games']) ? r['games'].filter(isGame) : [],
      fetchedMonths: strs(r['fetchedMonths']),
      allArchives: strs(r['allArchives']),
      lastSync: typeof r['lastSync'] === 'number' ? r['lastSync'] : null,
    };
  } catch {
    return { ...EMPTY };
  }
}

export const trackerStore = createStore<TrackerState>(parseTracker(storageGet(KEY)));
export const useTracker = <S,>(sel: (s: TrackerState) => S): S => useStore(trackerStore, sel);

function persist(): void {
  const { username, games, fetchedMonths, allArchives, lastSync } = trackerStore.get();
  if (!storageSet(KEY, JSON.stringify({ username, games, fetchedMonths, allArchives, lastSync }))) {
    trackerStore.set({ note: 'Could not save tracked games in this browser (storage full or blocked). They stay until you reload.' });
  }
}

let runId = 0;

export function mergeGames(existing: readonly TrackedGame[], incoming: readonly TrackedGame[]): TrackedGame[] {
  const byUrl = new Map(existing.map((g) => [g.url, g]));
  for (const g of incoming) byUrl.set(g.url, g);
  return [...byUrl.values()].sort((a, b) => b.endTime - a.endTime).slice(0, MAX_TRACKED);
}

/**
 * Downloads monthly archives for `username`. `months` = how many of the newest not-yet-fetched months to read.
 * A different username starts a fresh tracker. Stale runs (a newer sync started) discard their results.
 */
export async function syncPlayer(username: string, months = DEFAULT_MONTHS, f: typeof fetch = fetch): Promise<void> {
  const name = username.trim().toLowerCase();
  if (!validUsername(name)) { trackerStore.set({ error: 'Enter a valid Chess.com username (letters, digits, - and _).' }); return; }
  const my = ++runId;
  const same = trackerStore.get().username === name;
  if (!same) trackerStore.set({ ...EMPTY, username: name });
  trackerStore.set({ status: 'syncing', error: null, note: null });
  try {
    const archives = await fetchArchives(name, f);
    if (my !== runId) return;
    const newest = archives[archives.length - 1];
    const done = new Set(trackerStore.get().fetchedMonths);
    const pending = archives.filter((x) => x !== newest && !done.has(x)).reverse();
    const todo = (newest === undefined ? [] : [newest, ...pending]).slice(0, months + (newest !== undefined && done.has(newest) ? 1 : 0));
    let skipped = 0;
    for (const url of todo) {
      const { games, skipped: sk } = await fetchMonth(url, name, f);
      if (my !== runId) return;
      skipped += sk;
      trackerStore.set((s) => ({ games: mergeGames(s.games, games), fetchedMonths: [...new Set([...s.fetchedMonths, url])] }));
    }
    trackerStore.set({ allArchives: archives, lastSync: Date.now(), status: 'idle', note: skipped > 0 ? `${skipped} games skipped (variants or incomplete data).` : null });
    persist();
  } catch (e) {
    if (my !== runId) return;
    const msg = e instanceof ChessComError ? e.message : 'Unexpected error while syncing.';
    trackerStore.set({ status: 'idle', error: msg });
    if (trackerStore.get().games.length > 0) persist(); // keep what was downloaded before the failure
  }
}

export function olderMonthsAvailable(s: TrackerState): number {
  const done = new Set(s.fetchedMonths);
  return s.allArchives.filter((a) => !done.has(a)).length;
}

export function clearTracker(): void {
  runId += 1;
  trackerStore.set({ ...EMPTY });
  persist();
}
