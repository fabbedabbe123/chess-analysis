import type { Outcome, TimeClass, TrackedGame } from './api';

export interface Record3 { win: number; draw: number; loss: number; games: number }

const empty = (): Record3 => ({ win: 0, draw: 0, loss: 0, games: 0 });
const add = (r: Record3, o: Outcome): void => { r[o] += 1; r.games += 1; };

/** Score as a percentage: win = 1, draw = 0.5. */
export const scorePct = (r: Record3): number => (r.games === 0 ? 0 : ((r.win + r.draw / 2) / r.games) * 100);

export interface OpeningStat extends Record3 { key: string; eco: string | null; name: string; color: 'w' | 'b' }

export interface PlayerStats {
  total: Record3;
  asWhite: Record3;
  asBlack: Record3;
  byTimeClass: Partial<Record<TimeClass, Record3>>;
  /** chronological rating points per time class */
  ratings: Partial<Record<TimeClass, { t: number; rating: number }[]>>;
  openings: OpeningStat[];
  /** how the player's losses ended */
  lossReasons: Record<string, number>;
}

export function computeStats(games: readonly TrackedGame[]): PlayerStats {
  const sorted = [...games].sort((a, b) => a.endTime - b.endTime);
  const s: PlayerStats = { total: empty(), asWhite: empty(), asBlack: empty(), byTimeClass: {}, ratings: {}, openings: [], lossReasons: {} };
  const ops = new Map<string, OpeningStat>();
  for (const g of sorted) {
    add(s.total, g.outcome);
    add(g.color === 'w' ? s.asWhite : s.asBlack, g.outcome);
    add((s.byTimeClass[g.timeClass] ??= empty()), g.outcome);
    if (g.rating !== null && g.rated !== false) (s.ratings[g.timeClass] ??= []).push({ t: g.endTime, rating: g.rating });
    if (g.outcome === 'loss') s.lossReasons[g.reason] = (s.lossReasons[g.reason] ?? 0) + 1;
    if (g.opening !== null) {
      const key = `${g.color}|${g.opening}`;
      let o = ops.get(key);
      if (o === undefined) { o = { ...empty(), key, eco: g.eco, name: g.opening, color: g.color }; ops.set(key, o); }
      add(o, g.outcome);
    }
  }
  s.openings = [...ops.values()].sort((a, b) => b.games - a.games);
  return s;
}

/** Openings with enough games to say something and a score below 50%, worst first. Small samples are excluded, not guessed. */
export function weakestOpenings(stats: PlayerStats, minGames = 5, limit = 3): OpeningStat[] {
  return stats.openings.filter((o) => o.games >= minGames && scorePct(o) < 50).sort((a, b) => scorePct(a) - scorePct(b)).slice(0, limit);
}
