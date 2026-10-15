import type { PuzzleProgress, Puzzle, PuzzleTheme } from '@/puzzles/puzzles';
import { THEME_LABEL } from '@/puzzles/puzzles';
import type { CoachExample, CoachReport } from './coach';

export interface PuzzleRecommendation {
  puzzle: Puzzle;
  /** Why this puzzle: tied to a concrete mistake of the user's game. */
  reason: string;
  exampleMove: CoachExample['move'];
}

const DIFF_RANK = { easy: 0, medium: 1, hard: 2 } as const;

/**
 * Picks puzzles whose theme matches a real mistake from the game. Mistakes without a matching theme (quiet
 * positional errors) get NO puzzle: recommending an unrelated tactic would be misleading.
 * Unsolved puzzles first, then easier ones; never the same puzzle twice.
 */
export function recommendPuzzles(report: CoachReport, all: readonly Puzzle[], progress: PuzzleProgress, max = 5): PuzzleRecommendation[] {
  const out: PuzzleRecommendation[] = [];
  const used = new Set<string>();
  const perExample = Math.max(1, Math.ceil(max / Math.max(1, report.mistakes.filter((m) => m.themes.length > 0).length)));

  for (const ex of report.mistakes) {
    if (ex.themes.length === 0) continue;
    const pool = all
      .filter((p) => ex.themes.includes(p.theme) && !used.has(p.id))
      .sort((a, b) => Number(progress.solved[a.id] !== undefined) - Number(progress.solved[b.id] !== undefined) || DIFF_RANK[a.difficulty] - DIFF_RANK[b.difficulty] || a.id.localeCompare(b.id));
    for (const p of pool.slice(0, perExample)) {
      if (out.length >= max) return out;
      used.add(p.id);
      const m = ex.move;
      out.push({ puzzle: p, exampleMove: m, reason: `${THEME_LABEL[p.theme as PuzzleTheme]} puzzle: you ${m.classification.tags.includes('missed-mate') ? 'missed a mate' : m.classification.tags.includes('allowed-mate') ? 'allowed a mate' : 'erred tactically'} at move ${m.moveNumber}${m.color === 'w' ? '' : '...'} (${m.san}).` });
    }
  }
  return out;
}
