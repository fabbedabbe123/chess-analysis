import { storageGet, storageSet } from '@/utils/storage';
import { DEFAULT_THRESHOLDS, normalizeThresholds, type ClassifyThresholds } from '@/analysis/classify';
import type { EvalDisplayMode } from '@/analysis/eval';
import type { EngineOptions, SearchLimits } from '@/types/engine';
import { createStore, useStore } from './createStore';

export type ThemeMode = 'dark' | 'light';
export type BoardThemeId = 'green' | 'brown' | 'blue' | 'slate' | 'purple';
export type PieceSetId = 'cburnett' | 'merida' | 'chessnut' | 'rhosgfx';
export type AnalysisMode = 'depth' | 'time' | 'infinite';

export const BOARD_THEMES: readonly { id: BoardThemeId; label: string }[] = [
  { id: 'green', label: 'Green' },
  { id: 'brown', label: 'Walnut' },
  { id: 'blue', label: 'Ocean' },
  { id: 'slate', label: 'Slate' },
  { id: 'purple', label: 'Plum' },
];

export const PIECE_SETS: readonly { id: PieceSetId; label: string; license: string }[] = [
  { id: 'cburnett', label: 'Classic (Cburnett)', license: 'GPLv2+' },
  { id: 'merida', label: 'Merida', license: 'GPLv2+' },
  { id: 'chessnut', label: 'Chessnut', license: 'Apache-2.0' },
  { id: 'rhosgfx', label: 'RhosGFX', license: 'CC0' },
];

export interface Settings {
  theme: ThemeMode;
  boardTheme: BoardThemeId;
  pieceSet: PieceSetId;
  orientation: 'white' | 'black';
  showCoordinates: boolean;
  showLegalMoves: boolean;
  highlightLastMove: boolean;
  showEngineArrows: boolean;
  soundEnabled: boolean;
  winAnimations: boolean;
  evalDisplay: EvalDisplayMode;
  autoAnalyze: boolean;
  /** Start a full-game review right after a PGN is imported. */
  autoReviewOnImport: boolean;

  analysisMode: AnalysisMode;
  analysisDepth: number;
  analysisTimeMs: number;
  multiPv: number;
  hashMb: number;
  threads: number;
  limitStrength: boolean;
  elo: number;
  skillLevel: number;
  showWdl: boolean;

  reviewDepth: number;
  thresholds: ClassifyThresholds;

  explorerSource: 'masters' | 'lichess';
  explorerToken: string;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
  boardTheme: 'green',
  pieceSet: 'cburnett',
  orientation: 'white',
  showCoordinates: true,
  showLegalMoves: true,
  highlightLastMove: true,
  showEngineArrows: true,
  soundEnabled: true,
  winAnimations: true,
  evalDisplay: 'pawns',
  autoAnalyze: true,
  autoReviewOnImport: true,

  analysisMode: 'depth',
  analysisDepth: 18,
  analysisTimeMs: 2000,
  multiPv: 3,
  hashMb: 32,
  threads: 2,
  limitStrength: false,
  elo: 2000,
  skillLevel: 20,
  showWdl: false,

  reviewDepth: 14,
  thresholds: DEFAULT_THRESHOLDS,

  explorerSource: 'masters',
  explorerToken: '',
};

const STORAGE_KEY = 'chess-analysis:settings:v1';

const oneOf = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;

const bool = (value: unknown, fallback: boolean): boolean => (typeof value === 'boolean' ? value : fallback);

const num = (value: unknown, min: number, max: number, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, Math.round(value))) : fallback;

/** Validate untrusted (stored) data field by field; unknown/invalid values fall back to defaults. */
export function sanitizeSettings(raw: unknown): Settings {
  const d = DEFAULT_SETTINGS;
  if (typeof raw !== 'object' || raw === null) return { ...d, thresholds: { ...d.thresholds } };
  const r = raw as Record<string, unknown>;
  const t = (typeof r['thresholds'] === 'object' && r['thresholds'] !== null ? r['thresholds'] : {}) as Record<string, unknown>;
  const thresholds = normalizeThresholds({
    excellent: typeof t['excellent'] === 'number' ? t['excellent'] : d.thresholds.excellent,
    good: typeof t['good'] === 'number' ? t['good'] : d.thresholds.good,
    inaccuracy: typeof t['inaccuracy'] === 'number' ? t['inaccuracy'] : d.thresholds.inaccuracy,
    mistake: typeof t['mistake'] === 'number' ? t['mistake'] : d.thresholds.mistake,
  });
  return {
    theme: oneOf(r['theme'], ['dark', 'light'], d.theme),
    boardTheme: oneOf(r['boardTheme'], BOARD_THEMES.map((b) => b.id), d.boardTheme),
    pieceSet: oneOf(r['pieceSet'], PIECE_SETS.map((p) => p.id), d.pieceSet),
    orientation: oneOf(r['orientation'], ['white', 'black'], d.orientation),
    showCoordinates: bool(r['showCoordinates'], d.showCoordinates),
    showLegalMoves: bool(r['showLegalMoves'], d.showLegalMoves),
    highlightLastMove: bool(r['highlightLastMove'], d.highlightLastMove),
    showEngineArrows: bool(r['showEngineArrows'], d.showEngineArrows),
    soundEnabled: bool(r['soundEnabled'], d.soundEnabled),
    winAnimations: bool(r['winAnimations'], d.winAnimations),
    evalDisplay: oneOf(r['evalDisplay'], ['pawns', 'centipawns', 'winpercent'], d.evalDisplay),
    autoAnalyze: bool(r['autoAnalyze'], d.autoAnalyze),
    autoReviewOnImport: bool(r['autoReviewOnImport'], d.autoReviewOnImport),
    analysisMode: oneOf(r['analysisMode'], ['depth', 'time', 'infinite'], d.analysisMode),
    analysisDepth: num(r['analysisDepth'], 1, 40, d.analysisDepth),
    analysisTimeMs: num(r['analysisTimeMs'], 100, 60_000, d.analysisTimeMs),
    multiPv: num(r['multiPv'], 1, 8, d.multiPv),
    hashMb: num(r['hashMb'], 16, 256, d.hashMb),
    threads: num(r['threads'], 1, 32, d.threads),
    limitStrength: bool(r['limitStrength'], d.limitStrength),
    elo: num(r['elo'], 1320, 3190, d.elo),
    skillLevel: num(r['skillLevel'], 0, 20, d.skillLevel),
    showWdl: bool(r['showWdl'], d.showWdl),
    reviewDepth: num(r['reviewDepth'], 6, 24, d.reviewDepth),
    thresholds,
    explorerSource: oneOf(r['explorerSource'], ['masters', 'lichess'], d.explorerSource),
    explorerToken: typeof r['explorerToken'] === 'string' ? r['explorerToken'].slice(0, 200) : d.explorerToken,
  };
}

function load(): Settings {
  try {
    const text = storageGet(STORAGE_KEY);
    return sanitizeSettings(text === null ? null : (JSON.parse(text) as unknown));
  } catch {
    return sanitizeSettings(null);
  }
}

export const settingsStore = createStore<Settings>(load());

settingsStore.subscribe(() => {
  try {
    storageSet(STORAGE_KEY, JSON.stringify(settingsStore.get()));
  } catch {
    // Storage may be full or blocked (private mode); settings then just last for the session.
  }
});

export function useSettings(): Settings {
  return useStore(settingsStore, (s) => s);
}

export function useSetting<K extends keyof Settings>(key: K): Settings[K] {
  return useStore(settingsStore, (s) => s[key]);
}

export function updateSettings(patch: Partial<Settings>): void {
  settingsStore.set(patch);
}

export function resetSettings(): void {
  settingsStore.replace(sanitizeSettings(null));
}

/** Engine-wide options derived from the settings. */
export function engineOptionsFrom(s: Settings): EngineOptions {
  return {
    hashMb: s.hashMb,
    threads: s.threads,
    skillLevel: s.skillLevel,
    limitStrength: s.limitStrength,
    elo: s.elo,
    showWdl: s.showWdl,
  };
}

export function searchLimitsFrom(s: Settings): SearchLimits {
  if (s.analysisMode === 'depth') return { depth: s.analysisDepth };
  if (s.analysisMode === 'time') return { movetimeMs: s.analysisTimeMs };
  return { infinite: true };
}
