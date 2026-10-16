/**
 * What is synchronised between devices when the user is signed in.
 * Deliberately NOT synced: the game on the board, an unfinished play session, layout toggles (per device),
 * downloaded Chess.com / Lichess games and Lichess puzzles (large and re-downloadable), and the Lichess token (a secret).
 */
export const SYNC_NAMES = ['settings', 'play-settings', 'strength-games', 'play-history', 'library', 'puzzles', 'accounts'] as const;
export type SyncName = (typeof SYNC_NAMES)[number];

export const SYNC_LABEL: Record<SyncName, string> = {
  settings: 'Settings',
  'play-settings': 'Play settings',
  'strength-games': 'Analysed games and strength',
  'play-history': 'Games against Stockfish',
  library: 'Saved games',
  puzzles: 'Puzzle progress',
  accounts: 'Chess.com / Lichess usernames',
};

/** Largest value (characters) that is uploaded for one name; bigger data stays on this device. */
export const MAX_VALUE_CHARS = 2_000_000;

/** localStorage key for a name that is stored as one key. `accounts` is derived from two other keys. */
export function localKey(name: Exclude<SyncName, 'accounts'>): string {
  return `chess-analysis:${name}:v1`;
}

export function nameForLocalKey(key: string): SyncName | null {
  for (const n of SYNC_NAMES) if (n !== 'accounts' && localKey(n) === key) return n;
  if (key === 'chess-analysis:tracker:v1' || key === 'chess-analysis:lichess:v1') return 'accounts';
  return null;
}

export function isSyncName(v: string): v is SyncName {
  return (SYNC_NAMES as readonly string[]).includes(v);
}
