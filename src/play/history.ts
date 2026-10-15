import type { PuzzleProgress } from '@/puzzles/puzzles';
import { CATEGORY_LABEL, CATEGORY_ORDER, type CoachCategory } from './coach';

export interface GameRecord {
  id: string;
  endedAt: number;
  userColor: 'w' | 'b';
  levelId: string;
  levelLabel: string;
  result: 'win' | 'draw' | 'loss';
  reason: string;
  plies: number;
  pgn: string;
  opening: string | null;
  /** Filled in when the game has been reviewed. */
  review: null | {
    accuracy: number | null;
    inaccuracies: number;
    mistakes: number;
    blunders: number;
    categories: Partial<Record<CoachCategory, number>>;
  };
}

export const MAX_HISTORY = 150;

export function isGameRecord(v: unknown): v is GameRecord {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return typeof r['id'] === 'string' && typeof r['endedAt'] === 'number' && (r['userColor'] === 'w' || r['userColor'] === 'b')
    && typeof r['levelId'] === 'string' && typeof r['levelLabel'] === 'string' && ['win', 'draw', 'loss'].includes(String(r['result']))
    && typeof r['pgn'] === 'string' && typeof r['plies'] === 'number';
}

export interface HistorySummary {
  games: number;
  wins: number;
  draws: number;
  losses: number;
  byLevel: { level: string; games: number; wins: number; draws: number; losses: number }[];
  /** Accuracy of reviewed games in chronological order. */
  accuracyTrend: { id: string; accuracy: number }[];
  /** Mean accuracy of the last 3 reviewed games minus the 3 before (null if fewer than 6). */
  accuracyChange: number | null;
  reviewed: number;
  topCategories: { category: CoachCategory; label: string; count: number }[];
  puzzles: { solved: number; clean: number; streak: number; bestStreak: number };
  goals: string[];
}

export function summarizeHistory(records: readonly GameRecord[], progress: PuzzleProgress): HistorySummary {
  const chrono = [...records].sort((a, b) => a.endedAt - b.endedAt);
  const s: HistorySummary = {
    games: chrono.length, wins: 0, draws: 0, losses: 0, byLevel: [], accuracyTrend: [], accuracyChange: null, reviewed: 0, topCategories: [],
    puzzles: { solved: 0, clean: 0, streak: progress.streak, bestStreak: progress.bestStreak }, goals: [],
  };
  const levels = new Map<string, HistorySummary['byLevel'][number]>();
  const cats: Record<string, number> = {};
  for (const g of chrono) {
    s[g.result === 'win' ? 'wins' : g.result === 'draw' ? 'draws' : 'losses'] += 1;
    const l = levels.get(g.levelLabel) ?? { level: g.levelLabel, games: 0, wins: 0, draws: 0, losses: 0 };
    l.games += 1;
    l[g.result === 'win' ? 'wins' : g.result === 'draw' ? 'draws' : 'losses'] += 1;
    levels.set(g.levelLabel, l);
    if (g.review !== null) {
      s.reviewed += 1;
      if (g.review.accuracy !== null) s.accuracyTrend.push({ id: g.id, accuracy: g.review.accuracy });
      for (const [c, n] of Object.entries(g.review.categories)) cats[c] = (cats[c] ?? 0) + (n ?? 0);
    }
  }
  s.byLevel = [...levels.values()];
  s.topCategories = CATEGORY_ORDER.map((c) => ({ category: c, label: CATEGORY_LABEL[c], count: cats[c] ?? 0 })).filter((x) => x.count > 0).sort((a, b) => b.count - a.count);
  const t = s.accuracyTrend.map((x) => x.accuracy);
  if (t.length >= 6) {
    const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
    s.accuracyChange = mean(t.slice(-3)) - mean(t.slice(-6, -3));
  }
  const solved = Object.values(progress.solved);
  s.puzzles.solved = solved.length;
  s.puzzles.clean = solved.filter((x) => x.clean).length;

  // Goals: only from real data; nothing is suggested without evidence.
  if (s.games === 0) s.goals.push('Play your first game to start tracking progress.');
  else if (s.reviewed === 0) s.goals.push('Review a finished game to unlock personalised goals.');
  const top = s.topCategories[0];
  if (s.reviewed > 0 && top === undefined) s.goals.push('No recurring mistake area yet in your reviewed games. Keep playing and reviewing to find one.');
  if (top !== undefined) s.goals.push(`Work on ${top.label.toLowerCase()}: ${top.count} of your reviewed mistakes fell here.`);
  for (const l of s.byLevel) {
    if (l.games >= 5 && l.wins / l.games >= 0.7 && l.level !== 'Maximum strength') s.goals.push(`You scored ${l.wins}/${l.games} wins on ${l.level}; try the next level up.`);
  }
  if (s.puzzles.solved > 0 && s.puzzles.clean / s.puzzles.solved < 0.5) s.goals.push('Under half of your solved puzzles were clean (no hints, no wrong tries): slow down and calculate before moving.');
  if (s.accuracyChange !== null) s.goals.push(s.accuracyChange >= 0 ? `Your accuracy over the last 3 reviewed games is ${s.accuracyChange.toFixed(1)} points above the 3 before.` : `Your accuracy over the last 3 reviewed games is ${Math.abs(s.accuracyChange).toFixed(1)} points below the 3 before.`);
  return s;
}
