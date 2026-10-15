import type { EngineCapabilities, EngineOptions, SearchLimits } from '@/types/engine';

/**
 * Playing strength. Verified against the bundled engine (Stockfish 19 lite): it exposes `Skill Level` (0-20) and
 * `UCI_LimitStrength` + `UCI_Elo` (1320-3190). There is NO Elo setting below 1320, so the two weakest levels use
 * Skill Level plus a very shallow search instead.
 *
 * IMPORTANT: none of these levels has been calibrated against human or rated-engine play. The "nominal Elo" is
 * only the number sent to the engine's UCI_Elo option; real strength depends on hardware, time per move and the
 * opponent. Levels are approximate and are described that way in the UI.
 */

export type LevelId = 'beginner' | 'easy' | 'intermediate' | 'advanced' | 'expert' | 'maximum' | 'custom';

export interface LevelSpec {
  id: LevelId;
  label: string;
  blurb: string;
  /** Skill Level 0-20 (used when `elo` is undefined and the level is not max). */
  skill?: number;
  /** Nominal UCI_Elo (enables UCI_LimitStrength). */
  elo?: number;
  depth?: number;
  movetimeMs: number;
}

export const LEVELS: readonly LevelSpec[] = [
  { id: 'beginner', label: 'Beginner', blurb: 'Plays quickly and makes frequent, obvious mistakes. Always legal moves.', skill: 0, depth: 1, movetimeMs: 100 },
  { id: 'easy', label: 'Easy', blurb: 'Sees simple tactics but still errs often.', skill: 5, depth: 4, movetimeMs: 150 },
  { id: 'intermediate', label: 'Intermediate', blurb: 'Solid club-style play with occasional slips (engine setting UCI_Elo 1500).', elo: 1500, movetimeMs: 300 },
  { id: 'advanced', label: 'Advanced', blurb: 'Strong, tactically alert opponent (engine setting UCI_Elo 2000).', elo: 2000, movetimeMs: 600 },
  { id: 'expert', label: 'Expert', blurb: 'Very strong; few mistakes (engine setting UCI_Elo 2600).', elo: 2600, movetimeMs: 1000 },
  { id: 'maximum', label: 'Maximum strength', blurb: 'Full-strength Stockfish with 2 s per move. Expect to lose.', movetimeMs: 2000 },
];

export interface CustomLevel {
  mode: 'skill' | 'elo';
  skill: number;
  elo: number;
  movetimeMs: number;
}

export const DEFAULT_CUSTOM: CustomLevel = { mode: 'skill', skill: 10, elo: 1800, movetimeMs: 400 };
export const MIN_MOVETIME = 30;
export const MAX_MOVETIME = 5000;

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, Number.isFinite(v) ? v : lo));

export function sanitizeCustom(raw: unknown): CustomLevel {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  return {
    mode: r['mode'] === 'elo' ? 'elo' : 'skill',
    skill: Math.round(clamp(Number(r['skill'] ?? DEFAULT_CUSTOM.skill), 0, 20)),
    elo: Math.round(clamp(Number(r['elo'] ?? DEFAULT_CUSTOM.elo), 1320, 3190)),
    movetimeMs: Math.round(clamp(Number(r['movetimeMs'] ?? DEFAULT_CUSTOM.movetimeMs), MIN_MOVETIME, MAX_MOVETIME)),
  };
}

export function specFor(id: LevelId, custom: CustomLevel): LevelSpec {
  if (id === 'custom') {
    const c = sanitizeCustom(custom);
    return c.mode === 'elo'
      ? { id: 'custom', label: 'Custom', blurb: `Engine setting UCI_Elo ${c.elo}, ${c.movetimeMs} ms per move.`, elo: c.elo, movetimeMs: c.movetimeMs }
      : { id: 'custom', label: 'Custom', blurb: `Skill Level ${c.skill}/20, ${c.movetimeMs} ms per move.`, skill: c.skill, movetimeMs: c.movetimeMs };
  }
  return LEVELS.find((l) => l.id === id) ?? (LEVELS[2] as LevelSpec);
}

export interface PlayStrength {
  options: EngineOptions;
  limits: SearchLimits;
  /** Human-readable note on what was actually applied (shown to the user). */
  note: string;
}

/**
 * Translates a level into real UCI options for THIS engine. Falls back honestly when an option is missing:
 * no UCI_Elo support -> Skill Level mapped from the nominal Elo; no Skill Level either -> shallower search only.
 */
export function strengthFor(spec: LevelSpec, caps: EngineCapabilities | null, base: Pick<EngineOptions, 'hashMb'> = { hashMb: 16 }): PlayStrength {
  const limits: SearchLimits = { movetimeMs: spec.movetimeMs, ...(spec.depth !== undefined ? { depth: spec.depth } : {}) };
  const options: EngineOptions = { hashMb: base.hashMb, threads: 1, skillLevel: 20, limitStrength: false, elo: 1500, showWdl: false };
  const canElo = caps === null ? true : caps.supportsLimitStrength;
  const canSkill = caps === null ? true : caps.supportsSkillLevel;

  if (spec.elo !== undefined) {
    if (canElo) {
      options.limitStrength = true;
      options.elo = Math.round(clamp(spec.elo, caps?.minElo ?? 1320, caps?.maxElo ?? 3190));
      return { options, limits, note: `UCI_LimitStrength on, UCI_Elo ${options.elo}, ${spec.movetimeMs} ms/move` };
    }
    if (canSkill) {
      // Rough monotone mapping 1320..3190 -> 0..20, only used when the engine lacks UCI_Elo.
      options.skillLevel = Math.round(clamp(((spec.elo - 1320) / (3190 - 1320)) * 20, 0, 20));
      return { options, limits, note: `Engine has no UCI_Elo; using Skill Level ${options.skillLevel}` };
    }
    return { options, limits: { movetimeMs: Math.min(spec.movetimeMs, 100), depth: 3 }, note: 'Engine has no strength options; limiting search depth only' };
  }
  if (spec.skill !== undefined) {
    if (canSkill) {
      options.skillLevel = Math.round(clamp(spec.skill, 0, 20));
      return { options, limits, note: `Skill Level ${options.skillLevel}/20${spec.depth !== undefined ? `, depth ${spec.depth}` : ''}, ${spec.movetimeMs} ms/move` };
    }
    return { options, limits: { movetimeMs: Math.min(spec.movetimeMs, 100), depth: Math.max(1, Math.round(spec.skill / 3)) }, note: 'Engine has no Skill Level; limiting search depth only' };
  }
  return { options, limits, note: `Full strength, ${spec.movetimeMs} ms/move` };
}

export const STRENGTH_DISCLAIMER =
  'Levels are approximate. They use Stockfish\'s own strength options, but they have not been calibrated against rated players, so no Elo rating is claimed. Beginner and Easy use Skill Level with a shallow search because the engine cannot go below UCI_Elo 1320.';
