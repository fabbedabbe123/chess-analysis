import { estimateStrength, type AnalysedGame } from '@/strength/strength';
import type { PuzzleProgress } from '@/puzzles/puzzles';
import { isAvatarDataUrl } from '@/utils/avatar';

/** The numbers a user chooses to show their friends. Nothing else about their play is shared. */
export interface FriendStats {
  level: { low: number; high: number } | null;
  games: number;
  solved: number;
  bestStreak: number;
}

export type Activity = 'analysing' | 'puzzles' | 'playing' | 'games' | 'learning' | 'browsing';
export const ACTIVITY_LABEL: Record<Activity, string> = {
  analysing: 'Analysing', puzzles: 'Solving puzzles', playing: 'Playing Stockfish', games: 'Looking at games', learning: 'Learning', browsing: 'Browsing',
};
const isActivity = (v: unknown): v is Activity => typeof v === 'string' && v in ACTIVITY_LABEL;
/** A heartbeat is sent every minute while the page is visible; two missed beats and a bit means offline. */
export const ONLINE_WITHIN_S = 150;

export interface Friend {
  friendshipId: string;
  userId: string;
  username: string;
  avatar: string | null;
  status: 'pending' | 'accepted';
  /** pending only: true when THEY asked ME. */
  incoming: boolean;
  memberSince: number | null;
  stats: FriendStats | null;
  /** Seconds since their last heartbeat, as measured by the server when `fetchedAt` was taken (null: never / hidden). */
  seenAgo: number | null;
  activity: Activity | null;
  fetchedAt: number;
}

export interface FoundUser { userId: string; username: string; avatar: string | null }

const num = (v: unknown, max: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(max, Math.round(v))) : 0);

/** Everything coming from other users is treated as untrusted: only plain numbers survive. */
export function sanitizeStats(raw: unknown): FriendStats | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const lv = r['level'];
  let level: FriendStats['level'] = null;
  if (typeof lv === 'object' && lv !== null) {
    const l = lv as Record<string, unknown>;
    const low = num(l['low'], 4000);
    const high = num(l['high'], 4000);
    if (low > 0 && high >= low) level = { low, high };
  }
  return { level, games: num(r['games'], 100000), solved: num(r['solved'], 100000), bestStreak: num(r['bestStreak'], 100000) };
}

export function buildStats(games: readonly AnalysedGame[], progress: PuzzleProgress): FriendStats {
  const est = estimateStrength(games);
  return { level: est === null ? null : { low: est.low, high: est.high }, games: games.length, solved: Object.keys(progress.solved).length, bestStreak: progress.bestStreak };
}

interface OverviewRow {
  friendship_id: string; user_id: string; username: string; avatar: string | null; status: string; incoming: boolean; member_since: string | null; stats: unknown; seen_ago?: unknown; activity?: unknown;
}

export function parseOverview(rows: unknown, now: number = Date.now()): Friend[] {
  if (!Array.isArray(rows)) return [];
  const out: Friend[] = [];
  for (const r of rows as OverviewRow[]) {
    if (typeof r?.friendship_id !== 'string' || typeof r.user_id !== 'string' || typeof r.username !== 'string') continue;
    if (r.status !== 'pending' && r.status !== 'accepted') continue;
    out.push({
      friendshipId: r.friendship_id, userId: r.user_id, username: r.username,
      avatar: isAvatarDataUrl(r.avatar) ? r.avatar : null, status: r.status, incoming: r.incoming === true,
      memberSince: typeof r.member_since === 'string' ? Date.parse(r.member_since) || null : null,
      stats: sanitizeStats(r.stats),
      seenAgo: typeof r.seen_ago === 'number' && Number.isFinite(r.seen_ago) && r.seen_ago >= 0 ? r.seen_ago : null,
      activity: isActivity(r.activity) ? r.activity : null,
      fetchedAt: now,
    });
  }
  return out;
}

export function levelText(s: FriendStats | null): string {
  return s === null || s.level === null ? '–' : `${s.level.low}–${s.level.high}`;
}

export interface Presence { online: boolean; label: string }

/** "Online · Solving puzzles", "Last seen 5 min ago" or "Offline". Ages forward from when the data was fetched. */
export function presenceOf(f: Friend, now: number = Date.now()): Presence {
  if (f.seenAgo === null) return { online: false, label: 'Offline' };
  const ago = f.seenAgo + Math.max(0, (now - f.fetchedAt) / 1000);
  if (ago <= ONLINE_WITHIN_S) return { online: true, label: f.activity !== null ? `Online · ${ACTIVITY_LABEL[f.activity]}` : 'Online' };
  if (ago < 3600) return { online: false, label: `Last seen ${Math.max(1, Math.round(ago / 60))} min ago` };
  if (ago < 86400) return { online: false, label: `Last seen ${Math.round(ago / 3600)} h ago` };
  return { online: false, label: 'Offline' };
}
