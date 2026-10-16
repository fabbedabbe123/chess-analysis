import { createStore, useStore } from '@/stores/createStore';
import { notify } from '@/stores/gameStore';
import { playStore } from '@/stores/playStore';
import { puzzleStore } from '@/stores/puzzleStore';
import { openDialog, uiStore } from '@/stores/uiStore';
import { storageGet, setStorageWriteListener } from '@/utils/storage';
import type { SupabaseClient } from '@supabase/supabase-js';
import { syncConfig } from './config';
import { EMPTY_META, runSync, type SyncMeta, type SyncResult } from './engine';
import { nameForLocalKey } from './keys';
import { localStorageData } from './local';
import { usernameProblem, type Profile } from './profile';
import { buildStats, parseOverview, type Activity, type Friend, type FoundUser } from './social';
import { strengthStore } from '@/stores/strengthStore';
import { isAvatarDataUrl } from '@/utils/avatar';
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
  linkSentAt: number | null;
  lastSync: number | null;
  last: SyncResult | null;
  error: string | null;
  /** The chosen username; `profileLoaded` is false until the cloud has answered. */
  profile: Profile | null;
  profileLoaded: boolean;
  /** Friends and requests (null until loaded). */
  friends: Friend[] | null;
  /** Show my level / puzzle numbers to friends (stored on this device; default on). */
  shareStats: boolean;
  /** Show my online status and what I am doing to friends (stored on this device; default on). */
  sharePresence: boolean;
}

const SHARE_KEY = 'chess-analysis-sync:share-stats:v1'; // outside the backup prefix
function readShare(): boolean {
  try { return localStorage.getItem(SHARE_KEY) !== '0'; } catch { return true; }
}

const PRESENCE_KEY = 'chess-analysis-sync:share-presence:v1'; // outside the backup prefix
function readPresence(): boolean {
  try { return localStorage.getItem(PRESENCE_KEY) !== '0'; } catch { return true; }
}

export const syncStore = createStore<SyncState>({
  configured: syncConfig() !== null, ready: false, userId: null, email: null, busy: 'idle', linkSentTo: null, linkSentAt: null, lastSync: null, last: null, error: null, profile: null, profileLoaded: false, friends: null, shareStats: readShare(), sharePresence: readPresence(),
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
/** The page was opened from the e-mail sign-in link (the link puts the session in the URL). */
let arrivedByLink = typeof window !== 'undefined' && /access_token=|error_description=/.test(window.location.hash);

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
  if (name === 'strength-games' || name === 'puzzles') schedulePublish();
}

async function applySession(session: { user: { id: string; email?: string | null } } | null): Promise<void> {
  if (session === null) { stopPresence(); syncStore.set({ userId: null, email: null, profile: null, profileLoaded: false, friends: null }); return; }
  const already = syncStore.get().userId === session.user.id;
  syncStore.set({ userId: session.user.id, email: session.user.email ?? null, linkSentTo: null, error: null });
  if (!already && arrivedByLink) {
    arrivedByLink = false;
    notify('info', 'Signed in. Your progress now syncs between your devices.');
  }
  if (!already) {
    await loadProfile();
    void loadFriends();
    schedulePublish();
    startPresence();
    if (syncStore.get().profile === null && syncStore.get().profileLoaded) openDialog('account'); // first sign-in: ask for a username
    await syncNow(false);
  }
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
      if (document.visibilityState === 'visible' && userId !== null) { void beat(); void loadFriends(); }
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
  syncStore.set(error ? { busy: 'idle', error: friendlySendError(error.message) } : { busy: 'idle', linkSentTo: address, linkSentAt: Date.now() });
}

/** Back to the e-mail form (wrong address, or the link never arrived). */
export function resetLinkForm(): void {
  syncStore.set({ linkSentTo: null, linkSentAt: null, error: null });
}

function friendlySendError(message: string): string {
  if (/rate limit|too many|seconds/i.test(message)) return 'Too many sign-in e-mails were requested. Wait a few minutes and try again.';
  return `Could not send the link: ${message}`;
}

/** Reads the signed-in user's profile row (if they have chosen a username yet). */
export async function loadProfile(): Promise<void> {
  const { userId } = syncStore.get();
  if (client === null || userId === null) return;
  const { data, error } = await client.from('profiles').select('username,created_at,avatar').eq('user_id', userId).maybeSingle();
  if (error) { syncStore.set({ error: `Could not load your profile: ${error.message}` }); return; }
  const row = data as { username: string; created_at: string; avatar?: string | null } | null;
  syncStore.set({ profile: row === null ? null : { username: row.username, createdAt: Date.parse(row.created_at) || 0, avatar: isAvatarDataUrl(row.avatar) ? row.avatar : null }, profileLoaded: true });
}

export type UsernameCheck = 'ok' | 'taken' | 'same' | { problem: string } | 'error';

/** Asks the database whether a name is free (only a true/false answer, nobody else's data is exposed). */
export async function checkUsername(name: string): Promise<UsernameCheck> {
  const problem = usernameProblem(name);
  if (problem !== null) return { problem };
  if (client === null) return 'error';
  if (syncStore.get().profile?.username === name) return 'same';
  const { data, error } = await client.rpc('username_available', { name });
  if (error) return 'error';
  return data === true ? 'ok' : 'taken';
}

/** Creates the profile (first time) or renames it. Returns an error text or null. */
export async function saveUsername(name: string): Promise<string | null> {
  const { userId, profile } = syncStore.get();
  const problem = usernameProblem(name);
  if (problem !== null) return problem;
  if (client === null || userId === null) return 'You are not signed in.';
  const res = profile === null
    ? await client.from('profiles').insert({ user_id: userId, username: name }).select('username,created_at,avatar').single()
    : await client.from('profiles').update({ username: name }).eq('user_id', userId).select('username,created_at,avatar').single();
  if (res.error) return res.error.code === '23505' ? 'That username was just taken. Try another.' : `Could not save the username: ${res.error.message}`;
  const row = res.data as { username: string; created_at: string; avatar?: string | null };
  syncStore.set({ profile: { username: row.username, createdAt: Date.parse(row.created_at) || 0, avatar: isAvatarDataUrl(row.avatar) ? row.avatar : null }, profileLoaded: true });
  notify('info', `Your username is now ${row.username}.`);
  return null;
}

/** Sets or removes the profile picture (a small JPEG data URL, validated before and by the database). */
export async function saveAvatar(avatar: string | null): Promise<string | null> {
  const { userId, profile } = syncStore.get();
  if (client === null || userId === null || profile === null) return 'Choose a username first.';
  if (avatar !== null && !isAvatarDataUrl(avatar)) return 'That picture is not valid.';
  const { error } = await client.from('profiles').update({ avatar }).eq('user_id', userId);
  if (error) return `Could not save the picture: ${error.message}`;
  syncStore.set({ profile: { ...profile, avatar } });
  return null;
}

// ------------------------------------------------------------------------------------------ friends

const rpcError = (e: { message: string }): string => (/fetch|network/i.test(e.message) ? 'Could not reach the server (are you offline?).' : e.message);

export async function loadFriends(): Promise<void> {
  if (client === null || syncStore.get().userId === null) return;
  const { data, error } = await client.rpc('friends_overview');
  if (error) { syncStore.set({ error: `Could not load friends: ${rpcError(error)}` }); return; }
  syncStore.set({ friends: parseOverview(data) });
}

/** Exact username lookup. Returns null when nobody has that name. */
export async function findUser(name: string): Promise<{ user: FoundUser | null; error: string | null }> {
  const problem = usernameProblem(name);
  if (problem !== null) return { user: null, error: problem };
  if (client === null) return { user: null, error: 'Not signed in.' };
  const { data, error } = await client.rpc('search_user', { p_name: name });
  if (error) return { user: null, error: rpcError(error) };
  const row = (Array.isArray(data) ? data[0] : null) as { user_id?: unknown; username?: unknown; avatar?: unknown } | null | undefined;
  if (row === null || row === undefined || typeof row.user_id !== 'string' || typeof row.username !== 'string') return { user: null, error: null };
  return { user: { userId: row.user_id, username: row.username, avatar: isAvatarDataUrl(row.avatar) ? row.avatar : null }, error: null };
}

async function friendCall(fn: string, args: Record<string, unknown>): Promise<{ result: string | null; error: string | null }> {
  if (client === null) return { result: null, error: 'Not signed in.' };
  const { data, error } = await client.rpc(fn, args);
  if (error) return { result: null, error: rpcError(error) };
  await loadFriends();
  return { result: typeof data === 'string' ? data : null, error: null };
}

export const requestFriend = (userId: string) => friendCall('friend_request', { p_target: userId });
export const respondFriend = (friendshipId: string, accept: boolean) => friendCall('friend_respond', { p_id: friendshipId, p_accept: accept });
export const removeFriend = (friendshipId: string) => friendCall('friend_remove', { p_id: friendshipId });

// ------------------------------------------------------------------------------------------ shared stats

let publishTimer: ReturnType<typeof setTimeout> | null = null;
let lastPublished = '';

export function schedulePublish(): void {
  if (syncStore.get().userId === null) return;
  if (publishTimer !== null) clearTimeout(publishTimer);
  publishTimer = setTimeout(() => { publishTimer = null; void publishStatsNow(); }, PUSH_DELAY_MS);
}

/** Uploads the few numbers friends may see (or removes them when sharing is off). Best effort. */
export async function publishStatsNow(): Promise<void> {
  const { userId, shareStats, profile } = syncStore.get();
  if (client === null || userId === null || profile === null) return;
  try {
    if (!shareStats) {
      if (lastPublished !== 'off') { await client.from('profile_stats').delete().eq('user_id', userId); lastPublished = 'off'; }
      return;
    }
    const stats = buildStats(strengthStore.get().games, puzzleStore.get().progress);
    const json = JSON.stringify(stats);
    if (json === lastPublished) return;
    const { error } = await client.from('profile_stats').upsert({ user_id: userId, stats }, { onConflict: 'user_id' });
    if (!error) lastPublished = json;
  } catch { /* sharing is optional; try again at the next change */ }
}

// ------------------------------------------------------------------------------------------ online status

const BEAT_MS = 60_000;
let beatTimer: ReturnType<typeof setInterval> | null = null;

/** What I am doing, as one coarse word (never anything more specific). */
function currentActivity(): Activity {
  if (playStore.get().phase !== 'off') return 'playing';
  if (puzzleStore.get().phase !== 'off') return 'puzzles';
  switch (uiStore.get().rightTab) {
    case 'engine': case 'review': case 'openings': case 'tactics': return 'analysing';
    case 'puzzles': return 'puzzles';
    case 'play': return 'playing';
    case 'player': case 'strength': return 'games';
    case 'learn': return 'learning';
    default: return 'browsing';
  }
}

async function beat(): Promise<void> {
  const { userId, profile, sharePresence } = syncStore.get();
  if (client === null || userId === null || profile === null || !sharePresence) return;
  if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return; // a hidden tab is not "online"
  await client.rpc('set_presence', { p_activity: currentActivity() });
}

/** Heartbeat + friend list refresh once a minute while signed in and the page is visible. */
function startPresence(): void {
  stopPresence();
  void beat();
  beatTimer = setInterval(() => {
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
    void beat();
    void loadFriends();
  }, BEAT_MS);
}

function stopPresence(): void {
  if (beatTimer !== null) { clearInterval(beatTimer); beatTimer = null; }
}

export function setSharePresence(on: boolean): void {
  try { localStorage.setItem(PRESENCE_KEY, on ? '1' : '0'); } catch { /* not remembered */ }
  syncStore.set({ sharePresence: on });
  if (client === null || syncStore.get().userId === null) return;
  // supabase-js builders only send when awaited, so run it inside an async function
  if (on) void beat(); else void (async () => { await client?.rpc('clear_presence'); })();
}

export function setShareStats(on: boolean): void {
  try { localStorage.setItem(SHARE_KEY, on ? '1' : '0'); } catch { /* not remembered */ }
  syncStore.set({ shareStats: on });
  lastPublished = '';
  void publishStatsNow();
}

export async function signOut(): Promise<void> {
  if (client === null) return;
  if (syncStore.get().sharePresence) await client.rpc('clear_presence'); // appear offline right away
  stopPresence();
  await client.auth.signOut();
  lastPublished = '';
  if (pushTimer !== null) { clearTimeout(pushTimer); pushTimer = null; }
  syncStore.set({ userId: null, email: null, last: null, lastSync: null, profile: null, profileLoaded: false, friends: null });
}

/** Deletes everything this account stored in the cloud (this device keeps its data). */
export async function deleteMyCloudData(): Promise<boolean> {
  const { userId } = syncStore.get();
  if (client === null || userId === null) return false;
  try {
    await deleteCloudData(client, userId);
    await client.from('profile_stats').delete().eq('user_id', userId); // what friends could see is cloud data too
    lastPublished = 'off';
    meta = { userId, base: {}, touched: meta.touched };
    saveMeta();
    notify('info', 'Your cloud data was deleted. This device still has its own copy.');
    return true;
  } catch (e) {
    syncStore.set({ error: describe(e) });
    return false;
  }
}

/** Used by the friends UI. */
export const peekClientReady = (): boolean => client !== null;

/** Test hook. */
export function _setMetaForTests(m: SyncMeta): void { meta = m; }
