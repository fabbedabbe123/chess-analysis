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
  friendship_id: string; user_id: string; username: string; avatar: string | null; status: string; incoming: boolean; member_since: string | null; stats: unknown;
}

export function parseOverview(rows: unknown): Friend[] {
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
    });
  }
  return out;
}

export function levelText(s: FriendStats | null): string {
  return s === null || s.level === null ? '–' : `${s.level.low}–${s.level.high}`;
}
