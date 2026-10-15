import { validatePuzzle, type Puzzle, type PuzzleProgress } from '@/puzzles/puzzles';

export type SkillCategory = 'tactics' | 'openings' | 'endgames';

export interface LessonExercise {
  id: string;
  fen: string;
  /** UCI: solver, opponent reply, solver, ... */
  solution: string[];
  sideToMove: 'w' | 'b';
  why: string;
  exact: boolean;
  kind: 'engine' | 'book';
  opening?: string;
  difficulty: 'easy' | 'medium' | 'hard';
}

export interface Skill {
  id: string;
  title: string;
  category: SkillCategory;
  color?: 'w' | 'b';
  blurb: string;
  intro: string[];
  ideas: string[];
  exercises: LessonExercise[];
}

export const CATEGORY_LABEL: Record<SkillCategory, string> = { tactics: 'Tactics', openings: 'Openings', endgames: 'Endgames' };
export const CATEGORY_ORDER: SkillCategory[] = ['tactics', 'openings', 'endgames'];

/** Well-formed skills only; anything with an illegal start position or move is dropped (and counted). */
export function validateSkills(raw: unknown): { skills: Skill[]; rejected: number } {
  if (!Array.isArray(raw)) return { skills: [], rejected: 0 };
  const skills: Skill[] = [];
  let rejected = 0;
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) { rejected += 1; continue; }
    const s = item as Record<string, unknown>;
    const category = s['category'];
    if (typeof s['id'] !== 'string' || typeof s['title'] !== 'string' || !(category === 'tactics' || category === 'openings' || category === 'endgames') || !Array.isArray(s['exercises'])) {
      rejected += 1;
      continue;
    }
    const exercises: LessonExercise[] = [];
    for (const e of s['exercises'] as unknown[]) {
      if (typeof e !== 'object' || e === null) { rejected += 1; continue; }
      const ex = e as Record<string, unknown>;
      const check = validatePuzzle({ id: ex['id'], fen: ex['fen'], solution: ex['solution'], theme: 'lesson', difficulty: ex['difficulty'] });
      if (!check.ok || typeof ex['why'] !== 'string') { rejected += 1; continue; }
      exercises.push({
        id: check.puzzle.id,
        fen: check.puzzle.fen,
        solution: check.puzzle.solution,
        sideToMove: check.puzzle.sideToMove,
        why: ex['why'],
        exact: ex['exact'] === true,
        kind: ex['kind'] === 'book' ? 'book' : 'engine',
        ...(typeof ex['opening'] === 'string' ? { opening: ex['opening'] } : {}),
        difficulty: check.puzzle.difficulty,
      });
    }
    const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
    skills.push({
      id: s['id'],
      title: s['title'],
      category,
      ...(s['color'] === 'w' || s['color'] === 'b' ? { color: s['color'] } : {}),
      blurb: typeof s['blurb'] === 'string' ? s['blurb'] : '',
      intro: strings(s['intro']),
      ideas: strings(s['ideas']),
      exercises,
    });
  }
  return { skills, rejected };
}

let cache: Promise<Skill[]> | null = null;

/** Bundled lessons (public/data/lessons.json, built by scripts/build-lessons.mjs and checked with Stockfish). */
export function loadLessons(baseUrl: string = import.meta.env.BASE_URL): Promise<Skill[]> {
  if (cache === null) {
    const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
    cache = fetch(`${base}data/lessons.json`)
      .then((res) => {
        if (!res.ok) throw new Error(`Lessons not available (HTTP ${res.status})`);
        return res.json() as Promise<unknown>;
      })
      .then((raw) => validateSkills(raw).skills)
      .catch((error: unknown) => {
        cache = null;
        throw error;
      });
  }
  return cache;
}

export function setLessonsForTests(skills: Skill[] | null): void {
  cache = skills === null ? null : Promise.resolve(skills);
}

export function exerciseToPuzzle(skill: Skill, ex: LessonExercise): Puzzle {
  return {
    id: ex.id,
    fen: ex.fen,
    solution: ex.solution,
    theme: 'lesson',
    difficulty: ex.difficulty,
    sideToMove: ex.sideToMove,
    explanation: ex.why,
    skillId: skill.id,
    ...(ex.exact ? { exact: true } : {}),
    ...(ex.kind === 'book' ? { book: true } : {}),
  };
}

export type Mastery = 'new' | 'learning' | 'practised' | 'mastered';
export const MASTERY_LABEL: Record<Mastery, string> = { new: 'Not started', learning: 'Learning', practised: 'Practised', mastered: 'Mastered' };

export interface SkillProgress {
  total: number;
  solved: number;
  clean: number;
  mastery: Mastery;
}

/**
 * Mastery comes only from the user's own results (puzzle progress): learning = at least one exercise solved,
 * practised = all solved, mastered = all solved on the first try without hints.
 */
export function skillProgress(skill: Skill, progress: PuzzleProgress): SkillProgress {
  const total = skill.exercises.length;
  let solved = 0;
  let clean = 0;
  for (const ex of skill.exercises) {
    const r = progress.solved[ex.id];
    if (r === undefined) continue;
    solved += 1;
    if (r.clean) clean += 1;
  }
  const mastery: Mastery = total > 0 && clean === total ? 'mastered' : total > 0 && solved === total ? 'practised' : solved > 0 ? 'learning' : 'new';
  return { total, solved, clean, mastery };
}
