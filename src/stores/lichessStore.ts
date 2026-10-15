import type { TrackedGame } from '@/chesscom/api';
import { fetchLichessGames, LichessError, LICHESS_PAGE, validLichessName } from '@/lichess/api';
import { storageGet, storageSet } from '@/utils/storage';
import { createStore, useStore } from './createStore';
import { mergeGames } from './trackerStore';

const KEY = 'chess-analysis:lichess:v1';

export interface LichessState {
  username: string | null;
  games: TrackedGame[];
  /** createdAt (ms) of the oldest game downloaded so far; the next "older" page starts before it. */
  cursor: number | null;
  /** true once a page came back shorter than requested (no older games exist). */
  exhausted: boolean;
  lastSync: number | null;
  status: 'idle' | 'syncing';
  error: string | null;
  note: string | null;
}

const EMPTY: LichessState = { username: null, games: [], cursor: null, exhausted: false, lastSync: null, status: 'idle', error: null, note: null };

function isGame(g: unknown): g is TrackedGame {
  if (typeof g !== 'object' || g === null) return false;
  const r = g as Record<string, unknown>;
  return typeof r['url'] === 'string' && typeof r['pgn'] === 'string' && typeof r['endTime'] === 'number'
    && (r['color'] === 'w' || r['color'] === 'b') && ['win', 'draw', 'loss'].includes(String(r['outcome']))
    && ['bullet', 'blitz', 'rapid', 'daily'].includes(String(r['timeClass']));
}

export function parseLichessState(text: string | null): LichessState {
  if (text === null) return { ...EMPTY };
  try {
    const r = JSON.parse(text) as Record<string, unknown>;
    return {
      ...EMPTY,
      username: typeof r['username'] === 'string' ? r['username'] : null,
      games: Array.isArray(r['games']) ? r['games'].filter(isGame).map((g) => ({ ...g, source: 'lichess' as const })) : [],
      cursor: typeof r['cursor'] === 'number' ? r['cursor'] : null,
      exhausted: r['exhausted'] === true,
      lastSync: typeof r['lastSync'] === 'number' ? r['lastSync'] : null,
    };
  } catch {
    return { ...EMPTY };
  }
}

export const lichessStore = createStore<LichessState>(parseLichessState(storageGet(KEY)));
export const useLichess = <S,>(sel: (s: LichessState) => S): S => useStore(lichessStore, sel);

function persist(): void {
  const { username, games, cursor, exhausted, lastSync } = lichessStore.get();
  if (!storageSet(KEY, JSON.stringify({ username, games, cursor, exhausted, lastSync }))) {
    lichessStore.set({ note: 'Could not save Lichess games in this browser (storage full or blocked). They stay until you reload.' });
  }
}

let runId = 0;

/** Downloads the newest page of games, or (older = true) the page before the oldest one already loaded. */
export async function syncLichess(username: string, older = false, f: typeof fetch = fetch): Promise<void> {
  const name = username.trim();
  if (!validLichessName(name)) { lichessStore.set({ error: 'Enter a valid Lichess username (letters, digits, - and _).' }); return; }
  const my = ++runId;
  const same = lichessStore.get().username?.toLowerCase() === name.toLowerCase();
  if (!same) lichessStore.set({ ...EMPTY, username: name });
  lichessStore.set({ status: 'syncing', error: null, note: null });
  try {
    const until = older && same ? lichessStore.get().cursor : null;
    const page = await fetchLichessGames(name, until, f);
    if (my !== runId) return;
    lichessStore.set((s) => {
      const cursor = page.oldest === null ? s.cursor : s.cursor === null ? page.oldest : older ? Math.min(s.cursor, page.oldest) : s.cursor;
      return {
        games: mergeGames(s.games, page.games),
        cursor,
        exhausted: older || s.cursor === null ? page.lines < LICHESS_PAGE : s.exhausted,
        lastSync: Date.now(),
        status: 'idle',
        note: page.skipped > 0 ? `${page.skipped} games skipped (variants, unfinished games or incomplete data).` : null,
      };
    });
    persist();
  } catch (e) {
    if (my !== runId) return;
    lichessStore.set({ status: 'idle', error: e instanceof LichessError ? e.message : 'Unexpected error while syncing.' });
    if (lichessStore.get().games.length > 0) persist();
  }
}

export function clearLichess(): void {
  runId += 1;
  lichessStore.set({ ...EMPTY });
  persist();
}
