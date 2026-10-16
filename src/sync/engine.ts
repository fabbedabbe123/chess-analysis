import { MAX_VALUE_CHARS, SYNC_NAMES, type SyncName } from './keys';
import { hashText, mergeValues } from './merge';

export interface RemoteRow { name: string; value: string; updatedAt: number }
export interface Remote {
  fetchAll(): Promise<RemoteRow[]>;
  upsert(rows: { name: SyncName; value: string }[]): Promise<void>;
}
export interface LocalData {
  read(name: SyncName): string | null;
  write(name: SyncName, text: string): void;
}
/** `base[name]` = hash of the value both sides had at the last successful sync; `touched[name]` = when this device last changed it. */
export interface SyncMeta { userId: string | null; base: Record<string, string>; touched: Record<string, number> }
export interface SyncResult { pushed: SyncName[]; pulled: SyncName[]; merged: SyncName[]; skipped: { name: SyncName; reason: string }[]; foreignData: boolean }

export const EMPTY_META: SyncMeta = { userId: null, base: {}, touched: {} };

/**
 * One synchronisation round between this device and the cloud. Pure apart from the injected `remote` and `local`.
 * Per name: unchanged -> nothing; changed on one side only -> copy it over; changed on both -> merge (see merge.ts).
 * If this browser's data was last synced by ANOTHER account, nothing is uploaded and the cloud data replaces what it
 * has (so one person's data is never copied into someone else's cloud account).
 */
export async function runSync(remote: Remote, local: LocalData, meta: SyncMeta, userId: string): Promise<{ result: SyncResult; meta: SyncMeta }> {
  const rows = await remote.fetchAll();
  const byName = new Map(rows.map((r) => [r.name, r]));
  const foreign = meta.userId !== null && meta.userId !== userId;
  const base: Record<string, string> = foreign ? {} : { ...meta.base };
  const result: SyncResult = { pushed: [], pulled: [], merged: [], skipped: [], foreignData: false };
  const toPush: { name: SyncName; value: string }[] = [];

  for (const name of SYNC_NAMES) {
    const L = local.read(name);
    const R = byName.get(name) ?? null;
    if (L === null && R === null) continue;
    if (foreign) {
      if (L !== null) result.foreignData = true;
      if (R !== null) { local.write(name, R.value); base[name] = hashText(R.value); result.pulled.push(name); }
      continue;
    }
    if (R === null) {
      if (L !== null && L.length > MAX_VALUE_CHARS) { result.skipped.push({ name, reason: 'too large to upload' }); continue; }
      if (L !== null) { toPush.push({ name, value: L }); base[name] = hashText(L); result.pushed.push(name); }
      continue;
    }
    if (L === null) { local.write(name, R.value); base[name] = hashText(R.value); result.pulled.push(name); continue; }
    if (L === R.value) { base[name] = hashText(L); continue; }
    const b = base[name];
    const localChanged = b === undefined || hashText(L) !== b;
    const remoteChanged = b === undefined || hashText(R.value) !== b;
    if (!localChanged) { local.write(name, R.value); base[name] = hashText(R.value); result.pulled.push(name); continue; }
    if (!remoteChanged) {
      if (L.length > MAX_VALUE_CHARS) { result.skipped.push({ name, reason: 'too large to upload' }); continue; }
      toPush.push({ name, value: L }); base[name] = hashText(L); result.pushed.push(name); continue;
    }
    const localNewer = (meta.touched[name] ?? 0) > R.updatedAt;
    const merged = mergeValues(name, L, R.value, localNewer);
    if (merged !== L) local.write(name, merged);
    if (merged !== R.value) {
      if (merged.length > MAX_VALUE_CHARS) { result.skipped.push({ name, reason: 'too large to upload' }); continue; }
      toPush.push({ name, value: merged });
    }
    base[name] = hashText(merged);
    result.merged.push(name);
  }
  if (toPush.length > 0) await remote.upsert(toPush);
  return { result, meta: { userId, base, touched: { ...meta.touched } } };
}
