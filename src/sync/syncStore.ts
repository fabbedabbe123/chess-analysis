import { createStore, useStore } from '@/stores/createStore';
import { notify } from '@/stores/gameStore';
import { playStore } from '@/stores/playStore';
import { puzzleStore } from '@/stores/puzzleStore';
import { storageGet, setStorageWriteListener } from '@/utils/storage';
import type { SupabaseClient } from '@supabase/supabase-js';
import { syncConfig } from './config';
import { EMPTY_META, runSync, type SyncMeta, type SyncResult } from './engine';
import { nameForLocalKey } from './keys';
import { localStorageData } from './local';
import { deleteCloudData, supabaseRemote } from './remote';

const META_KEY = 'chess-analysis-sync:meta:v1'; // outside the "chess-analysis:" prefix: never part of a backup file
const PUSH_DELAY_MS = 4000;
const FOCUS_SYNC_MS = 60_000;

export interface SyncState {
  configured: boolean;
  ready: boolean;
  userId: string | null;
  email: string | null;
  busy: 'idle' | 'sending' | 'syncing';
  linkSentTo: string | null;
  lastSync: number | null;
  last: SyncResult | null;
  error: string | null;
}

export const syncStore = createStore<SyncState>({
  configured: syncConfig() !== null, ready: false, userId: null, email: null, busy: 'idle', linkSentTo: null, lastSync: null, last: null, error: null,
});
export const useSync = <S,>(sel: (s: SyncState) => S): S => useStore(syncStore, sel);

export function loadMeta(text: string | null): SyncMeta {
  if (text === null) return { ...EMPTY_META, base: {}, touched: {} };
  try {
    const r = JSON.parse(text) as Record<string, unknown>;
    const rec = (v: unknown): Record<string, never> => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, never>) : {});
    return { userId: typeof r['userId'] === 'string' ? r['userId'] : null, base: rec(r['base']), touched: rec(r['touched']) };
  } catch {
    return { ...EMPTY_META, base: {}, touched: {} };
  }
}

let meta: SyncMeta = loadMeta(storageGet(META_KEY));
const saveMeta = () => { try { localStorage.setItem(META_KEY, JSON.stringify(meta)); } catch { /* ignore */ } };

let client: SupabaseClient | null = null;
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let running = false;

function describe(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  return /fetch|network/i.test(m) ? 'Could not reach the sync server (are you offline?).' : `Sync failed: ${m}`;
}

/** A play game or puzzle is open: do not reload the page under the user. */
function sessionActive(): boolean {
  return playStore.get().phase !== 'off' || puzzleStore.get().phase !== 'off';
}

/** Runs one synchronisation round now (also called after local edits, on focus and by the "Sync now" button). */
export async function syncNow(manual = false): Promise<void> {
  const { userId } = syncStore.get();
  if (client === null || userId === null || running) return;
  running = true;
  syncStore.set({ busy: 'syncing', error: null });
  try {
    const out = await runSync(supabaseRemote(client, userId), localStorageData(), meta, userId);
    meta = out.meta;
    saveMeta();
    syncStore.set({ lastSync: Date.now(), last: out.result });
    const changedHere = out.result.pulled.length + out.result.merged.length > 0;
    if (out.result.foreignData) notify('warning', 'This browser had data from another account. It was not uploaded; your cloud data replaced it.');
    if (changedHere && !sessionActive()) {
      notify('info', 'Synced from your cloud data - reloading to apply it.');
      setTimeout(() => window.location.reload(), 900);
    } else if (changedHere) {
      notify('info', 'Cloud data was downloaded. Reload the page after your game or puzzle to see it.');
    } else if (manual) {
      notify('info', out.result.pushed.length > 0 ? 'Uploaded your changes.' : 'Everything is up to date.');
    }
  } catch (e) {
    syncStore.set({ error: describe(e) });
  } finally {
    running = false;
    syncStore.set({ busy: 'idle' });
  }
}

function schedulePush(): void {
  if (syncStore.get().userId === null) return;
  if (pushTimer !== null) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => { pushTimer = null; void syncNow(); }, PUSH_DELAY_MS);
}

function onLocalWrite(key: string): void {
  const name = nameForLocalKey(key);
  if (name === null) return;
  meta.touched[name] = Date.now();
  saveMeta();
  schedulePush();
}

async function applySession(session: { user: { id: string; email?: string | null } } | null): Promise<void> {
  if (session === null) { syncStore.set({ userId: null, email: null }); return; }
  const already = syncStore.get().userId === session.user.id;
  syncStore.set({ userId: session.user.id, email: session.user.email ?? null, linkSentTo: null, error: null });
  if (!already) await syncNow(false);
}

/** Starts the sync service (call once at startup). Does nothing when the site was built without a Supabase project. */
export async function initSync(): Promise<void> {
  const cfg = syncConfig();
  if (cfg === null) { syncStore.set({ configured: false, ready: true }); return; }
  try {
    const { createClient } = await import('@supabase/supabase-js');
    client = createClient(cfg.url, cfg.anonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit' } });
    setStorageWriteListener(onLocalWrite);
    client.auth.onAuthStateChange((event, session) => {
      // The auth library holds a lock while this callback runs; calling it again from here would deadlock, so defer.
      if (event === 'SIGNED_OUT') setTimeout(() => void applySession(null), 0);
      else if (session !== null && (event === 'SIGNED_IN' || event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED')) setTimeout(() => void applySession(session), 0);
    });
    const { data } = await client.auth.getSession();
    syncStore.set({ configured: true, ready: true });
    if (data.session !== null) await applySession(data.session);
    document.addEventListener('visibilitychange', () => {
      const { lastSync, userId } = syncStore.get();
      if (document.visibilityState === 'visible' && userId !== null && (lastSync === null || Date.now() - lastSync > FOCUS_SYNC_MS)) void syncNow();
    });
  } catch (e) {
    syncStore.set({ ready: true, error: describe(e) });
  }
}

/** Sends a sign-in link by e-mail (no password). The address is only used by the sign-in service. */
export async function sendLink(email: string): Promise<void> {
  const address = email.trim();
  if (client === null) return;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) { syncStore.set({ error: 'Enter a valid e-mail address.' }); return; }
  syncStore.set({ busy: 'sending', error: null });
  const { error } = await client.auth.signInWithOtp({ email: address, options: { emailRedirectTo: window.location.href.split(/[?#]/)[0] ?? window.location.origin, shouldCreateUser: true } });
  syncStore.set(error ? { busy: 'idle', error: `Could not send the link: ${error.message}` } : { busy: 'idle', linkSentTo: address });
}

export async function signOut(): Promise<void> {
  if (client === null) return;
  await client.auth.signOut();
  if (pushTimer !== null) { clearTimeout(pushTimer); pushTimer = null; }
  syncStore.set({ userId: null, email: null, last: null, lastSync: null });
}

/** Deletes everything this account stored in the cloud (this device keeps its data). */
export async function deleteMyCloudData(): Promise<boolean> {
  const { userId } = syncStore.get();
  if (client === null || userId === null) return false;
  try {
    await deleteCloudData(client, userId);
    meta = { userId, base: {}, touched: meta.touched };
    saveMeta();
    notify('info', 'Your cloud data was deleted. This device still has its own copy.');
    return true;
  } catch (e) {
    syncStore.set({ error: describe(e) });
    return false;
  }
}

/** Test hook. */
export function _setMetaForTests(m: SyncMeta): void { meta = m; }
