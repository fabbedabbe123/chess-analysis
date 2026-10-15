/**
 * Backup / restore of everything this app keeps in the browser (all `chess-analysis:*` localStorage keys:
 * settings, game, library, play history, puzzle progress, tracked games, analysed games ...).
 * The file is plain JSON; nothing leaves the computer.
 */

export const BACKUP_PREFIX = 'chess-analysis:';
export const BACKUP_FORMAT = 1;
const MAX_KEYS = 60;
const MAX_TOTAL_CHARS = 25_000_000;
const KEY_RE = /^chess-analysis:[A-Za-z0-9:_-]{1,80}$/;

type StorageLike = Pick<Storage, 'length' | 'key' | 'getItem' | 'setItem' | 'removeItem'>;

export interface BackupFile {
  app: 'chess-analysis';
  format: number;
  exportedAt: string;
  data: Record<string, string>;
}

export function appKeys(storage: StorageLike): string[] {
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i += 1) {
    const k = storage.key(i);
    if (k !== null && k.startsWith(BACKUP_PREFIX)) keys.push(k);
  }
  return keys.sort();
}

const SETTINGS_KEY = 'chess-analysis:settings:v1';

/** The optional Lichess token never goes into a backup file (people share backups). */
function withoutSecrets(settingsJson: string): string {
  try {
    const o = JSON.parse(settingsJson) as unknown;
    if (typeof o === 'object' && o !== null && !Array.isArray(o)) {
      const rest = { ...(o as Record<string, unknown>) };
      delete rest['explorerToken'];
      return JSON.stringify(rest);
    }
  } catch {
    /* keep as is */
  }
  return settingsJson;
}

export function collectBackup(storage: StorageLike, now: Date = new Date()): BackupFile {
  const data: Record<string, string> = {};
  for (const k of appKeys(storage)) {
    const v = storage.getItem(k);
    if (v !== null) data[k] = k === SETTINGS_KEY ? withoutSecrets(v) : v;
  }
  return { app: 'chess-analysis', format: BACKUP_FORMAT, exportedAt: now.toISOString(), data };
}

export type ParsedBackup = { ok: true; backup: BackupFile; keys: string[] } | { ok: false; error: string };

/** Strict validation: only our own keys, only strings that are themselves valid JSON, bounded size. */
export function parseBackup(text: string): ParsedBackup {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'That file is not valid JSON.' };
  }
  if (typeof raw !== 'object' || raw === null) return { ok: false, error: 'That file is not a Chess Analysis backup.' };
  const r = raw as Record<string, unknown>;
  if (r['app'] !== 'chess-analysis') return { ok: false, error: 'That file is not a Chess Analysis backup.' };
  if (r['format'] !== BACKUP_FORMAT) return { ok: false, error: 'This backup was made by a different version and cannot be read.' };
  const data = r['data'];
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return { ok: false, error: 'The backup has no data section.' };
  const entries = Object.entries(data as Record<string, unknown>);
  if (entries.length === 0) return { ok: false, error: 'The backup is empty.' };
  if (entries.length > MAX_KEYS) return { ok: false, error: 'The backup has too many entries.' };
  const clean: Record<string, string> = {};
  let total = 0;
  for (const [k, v] of entries) {
    if (!KEY_RE.test(k)) return { ok: false, error: `The backup contains an unexpected entry (${k.slice(0, 40)}).` };
    if (typeof v !== 'string') return { ok: false, error: `The entry ${k} is malformed.` };
    total += v.length;
    if (total > MAX_TOTAL_CHARS) return { ok: false, error: 'The backup is too large.' };
    try {
      JSON.parse(v);
    } catch {
      return { ok: false, error: `The entry ${k} is damaged.` };
    }
    clean[k] = v;
  }
  const exportedAt = typeof r['exportedAt'] === 'string' ? r['exportedAt'] : '';
  return { ok: true, backup: { app: 'chess-analysis', format: BACKUP_FORMAT, exportedAt, data: clean }, keys: Object.keys(clean).sort() };
}

/**
 * Replace every app key with the backup's. If anything fails (quota), the previous values are put back and an error is returned,
 * so a failed restore never leaves a half-written state.
 */
export function applyBackup(backup: BackupFile, storage: StorageLike): { ok: true } | { ok: false; error: string } {
  const before = new Map<string, string>();
  for (const k of appKeys(storage)) {
    const v = storage.getItem(k);
    if (v !== null) before.set(k, v);
  }
  try {
    for (const k of before.keys()) storage.removeItem(k);
    for (const [k, v] of Object.entries(backup.data)) storage.setItem(k, v);
    return { ok: true };
  } catch {
    try {
      for (const k of appKeys(storage)) storage.removeItem(k);
      for (const [k, v] of before) storage.setItem(k, v);
    } catch {
      /* nothing more we can do */
    }
    return { ok: false, error: 'The browser refused to store the backup (storage full?). Your previous data was kept.' };
  }
}

/** Short human summary of what a backup holds, for the confirmation dialog. */
export function describeBackup(keys: readonly string[], data: Record<string, string>): string {
  const count = (key: string): number => {
    try {
      const v = JSON.parse(data[key] ?? 'null') as unknown;
      if (Array.isArray(v)) return v.length;
      if (typeof v === 'object' && v !== null) {
        const g = (v as Record<string, unknown>)['games'];
        if (Array.isArray(g)) return g.length;
      }
    } catch {
      /* ignore */
    }
    return 0;
  };
  const parts: string[] = [];
  const analysed = count('chess-analysis:strength-games:v1');
  const played = count('chess-analysis:play-history:v1');
  const tracked = count('chess-analysis:tracker:v1');
  const saved = count('chess-analysis:library:v1');
  if (analysed > 0) parts.push(`${analysed} analysed game${analysed === 1 ? '' : 's'}`);
  if (played > 0) parts.push(`${played} played game${played === 1 ? '' : 's'}`);
  if (tracked > 0) parts.push(`${tracked} tracked game${tracked === 1 ? '' : 's'}`);
  if (saved > 0) parts.push(`${saved} saved game${saved === 1 ? '' : 's'}`);
  return `${keys.length} data set${keys.length === 1 ? '' : 's'}${parts.length > 0 ? ` (${parts.join(', ')})` : ''}`;
}
