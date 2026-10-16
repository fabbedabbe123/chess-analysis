import { storageGet } from '@/utils/storage';
import type { LocalData } from './engine';
import { localKey, type SyncName } from './keys';

const TRACKER = 'chess-analysis:tracker:v1';
const LICHESS = 'chess-analysis:lichess:v1';

type Store = Pick<Storage, 'getItem' | 'setItem'>;

function usernameIn(text: string | null): string | null {
  if (text === null) return null;
  try {
    const u = (JSON.parse(text) as { username?: unknown }).username;
    return typeof u === 'string' && u !== '' ? u : null;
  } catch {
    return null;
  }
}

/** The Lichess token lives in the settings but is a secret: it is never uploaded, and a download never overwrites it. */
function stripSecrets(settingsText: string): string {
  try {
    const o = JSON.parse(settingsText) as unknown;
    if (typeof o === 'object' && o !== null && !Array.isArray(o)) {
      const rest = { ...(o as Record<string, unknown>) };
      delete rest['explorerToken'];
      return JSON.stringify(rest);
    }
  } catch {
    /* use as is */
  }
  return settingsText;
}

/**
 * Reads/writes the synced values in localStorage. Writes go straight to the Storage (not through `storageSet`),
 * so applying cloud data is not mistaken for a local edit.
 */
export function localStorageData(store: Store | null = typeof localStorage === 'undefined' ? null : localStorage): LocalData {
  const get = (k: string): string | null => {
    if (store === null) return storageGet(k);
    try { return store.getItem(k); } catch { return null; }
  };
  const set = (k: string, v: string): void => {
    try { store?.setItem(k, v); } catch { /* storage full or blocked: the next sync tries again */ }
  };
  return {
    read(name: SyncName): string | null {
      if (name === 'accounts') {
        const chesscom = usernameIn(get(TRACKER));
        const lichess = usernameIn(get(LICHESS));
        return chesscom === null && lichess === null ? null : JSON.stringify({ chesscom, lichess });
      }
      const text = get(localKey(name));
      return text !== null && name === 'settings' ? stripSecrets(text) : text;
    },
    write(name: SyncName, text: string): void {
      if (name === 'accounts') {
        try {
          const a = JSON.parse(text) as { chesscom?: unknown; lichess?: unknown };
          for (const [key, value] of [[TRACKER, a.chesscom], [LICHESS, a.lichess]] as const) {
            if (typeof value !== 'string' || value === '') continue;
            const have = usernameIn(get(key));
            // a different account starts a fresh tracker; the same one keeps its downloaded games
            if (have === null || have.toLowerCase() !== value.toLowerCase()) set(key, JSON.stringify({ username: value }));
          }
        } catch { /* ignore a malformed value */ }
        return;
      }
      if (name === 'settings') {
        try {
          const remote = JSON.parse(text) as Record<string, unknown>;
          const localText = get(localKey('settings'));
          const token = localText === null ? undefined : (JSON.parse(localText) as Record<string, unknown>)['explorerToken'];
          const next = { ...remote };
          delete next['explorerToken'];
          if (typeof token === 'string' && token !== '') next['explorerToken'] = token;
          set(localKey('settings'), JSON.stringify(next));
        } catch { /* ignore a malformed value */ }
        return;
      }
      set(localKey(name), text);
    },
  };
}
