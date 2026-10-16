import type { SyncName } from './keys';

/** Small, stable text hash (djb2 + length) used to tell "changed since the last sync" without storing a copy. */
export function hashText(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i += 1) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
  return `${h.toString(36)}.${text.length}`;
}

const CAP: Partial<Record<SyncName, number>> = { 'strength-games': 200, 'play-history': 150, library: 100 };
const DATE_FIELDS = ['endedAt', 'savedAt'] as const;

function parse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function mergeById(name: SyncName, local: unknown[], remote: unknown[]): unknown[] | null {
  const hasId = (x: unknown): x is Record<string, unknown> => isRecord(x) && typeof x['id'] === 'string';
  if (!local.every(hasId) || !remote.every(hasId)) return null;
  const byId = new Map<string, Record<string, unknown>>();
  for (const x of remote) byId.set(x['id'] as string, x);
  for (const x of local) byId.set(x['id'] as string, x); // this device's copy wins for an id both have
  const items = [...byId.values()];
  const field = DATE_FIELDS.find((f) => items.every((x) => typeof x[f] === 'number'));
  if (field !== undefined) items.sort((a, b) => (b[field] as number) - (a[field] as number));
  return items.slice(0, CAP[name] ?? items.length);
}

function mergePuzzles(local: Record<string, unknown>, remote: Record<string, unknown>): Record<string, unknown> {
  const solved: Record<string, unknown> = { ...(isRecord(remote['solved']) ? remote['solved'] : {}) };
  if (isRecord(local['solved'])) {
    for (const [id, v] of Object.entries(local['solved'])) {
      const other = solved[id];
      // keep the better result: a clean solve beats an unclean one, then fewer attempts
      if (!isRecord(other) || !isRecord(v)) { solved[id] = v; continue; }
      const better = (v['clean'] === true && other['clean'] !== true) || (v['clean'] === other['clean'] && Number(v['attempts']) < Number(other['attempts']));
      if (better) solved[id] = v;
    }
  }
  const srs: Record<string, unknown> = { ...(isRecord(remote['srs']) ? remote['srs'] : {}) };
  if (isRecord(local['srs'])) {
    for (const [id, v] of Object.entries(local['srs'])) {
      const other = srs[id];
      // the entry with the later due date is the more recent review
      if (!isRecord(other) || !isRecord(v) || Number(v['due']) >= Number(other['due'])) srs[id] = v;
    }
  }
  const num = (o: Record<string, unknown>, k: string) => (typeof o[k] === 'number' ? (o[k] as number) : 0);
  const out: Record<string, unknown> = {
    solved,
    streak: Math.max(num(local, 'streak'), num(remote, 'streak')),
    bestStreak: Math.max(num(local, 'bestStreak'), num(remote, 'bestStreak')),
  };
  if (Object.keys(srs).length > 0) out['srs'] = srs;
  return out;
}

/**
 * Combine two versions that were both changed since the last sync. Lists of records with an id are merged (union),
 * puzzle progress is merged entry by entry, anything else: the newer side wins as a whole (`localNewer`).
 * Known limit: when both sides changed, something deleted on one side can come back.
 */
export function mergeValues(name: SyncName, localText: string, remoteText: string, localNewer: boolean): string {
  const l = parse(localText);
  const r = parse(remoteText);
  if (l === undefined || r === undefined) return localNewer ? localText : remoteText;
  if (Array.isArray(l) && Array.isArray(r)) {
    const merged = mergeById(name, l, r);
    if (merged !== null) return JSON.stringify(merged);
  }
  if (name === 'puzzles' && isRecord(l) && isRecord(r)) return JSON.stringify(mergePuzzles(l, r));
  return localNewer ? localText : remoteText;
}
