import { validatePuzzle, type Puzzle, type PuzzleProgress, type PuzzleDifficulty } from '@/puzzles/puzzles';
import { loadLessons, skillProgress, type Mastery, type Skill, type SkillCategory } from './lessons';

/** The learning path: levels, skill order and unlocking (data/practice/index.json, built from data-src/path.src.mjs). */
export interface PathLevel { id: string; title: string; blurb: string }
export interface PathSkill extends Skill {
  level: string;
  requires: string[];
  /** Positions in this skill's practice set (0 = none). */
  practice: number;
}
export interface Curriculum { levels: PathLevel[]; skills: PathSkill[] }

/** Practice positions solved for a skill to count as practised / mastered (mastered also needs most of them first try). */
export const PRACTISED_AT = 10;
export const MASTERED_AT = 20;
export const MASTERED_CLEAN = 14;

const base = (b: string) => (b.endsWith('/') ? b : `${b}/`);

function asSkill(m: Record<string, unknown>): Skill | null {
  const cat = m['category'];
  if (typeof m['id'] !== 'string' || typeof m['title'] !== 'string' || !(cat === 'tactics' || cat === 'openings' || cat === 'endgames')) return null;
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  return { id: m['id'], title: m['title'], category: cat as SkillCategory, blurb: typeof m['blurb'] === 'string' ? m['blurb'] : '', intro: strings(m['intro']), ideas: strings(m['ideas']), exercises: [] };
}

/** Merges the hand-written lessons with the path index. Without the index every skill is one flat level. */
export function buildCurriculum(lessons: Skill[], index: unknown): Curriculum {
  const idx = typeof index === 'object' && index !== null ? (index as Record<string, unknown>) : null;
  const levels: PathLevel[] = [];
  const metas = new Map<string, Record<string, unknown>>();
  if (idx !== null && Array.isArray(idx['levels']) && Array.isArray(idx['skills'])) {
    for (const l of idx['levels'] as unknown[]) {
      const r = l as Record<string, unknown>;
      if (typeof r['id'] === 'string' && typeof r['title'] === 'string') levels.push({ id: r['id'], title: r['title'], blurb: typeof r['blurb'] === 'string' ? r['blurb'] : '' });
    }
    for (const s of idx['skills'] as unknown[]) {
      const r = s as Record<string, unknown>;
      if (typeof r['id'] === 'string') metas.set(r['id'], r);
    }
  }
  if (levels.length === 0 || metas.size === 0) {
    return { levels: [{ id: 'all', title: 'All skills', blurb: '' }], skills: lessons.map((s) => ({ ...s, level: 'all', requires: [], practice: 0 })) };
  }
  const byId = new Map(lessons.map((s) => [s.id, s]));
  const skills: PathSkill[] = [];
  for (const [id, m] of metas) {
    const level = typeof m['level'] === 'string' && levels.some((l) => l.id === m['level']) ? (m['level'] as string) : (levels[0]?.id ?? 'all');
    const skill = byId.get(id) ?? asSkill(m);
    if (skill === null) continue;
    const requires = Array.isArray(m['requires']) ? (m['requires'] as unknown[]).filter((x): x is string => typeof x === 'string') : [];
    skills.push({ ...skill, level, requires, practice: typeof m['practice'] === 'number' ? m['practice'] : 0 });
  }
  for (const s of lessons) if (!metas.has(s.id)) skills.push({ ...s, level: levels[0]?.id ?? 'all', requires: [], practice: 0 });
  return { levels, skills };
}

let cache: Promise<Curriculum> | null = null;
export function loadCurriculum(baseUrl: string = import.meta.env.BASE_URL): Promise<Curriculum> {
  if (cache === null) {
    const b = base(baseUrl);
    cache = Promise.all([
      loadLessons(baseUrl),
      fetch(`${b}data/practice/index.json`).then((r) => (r.ok ? (r.json() as Promise<unknown>) : null)).catch(() => null),
    ]).then(([lessons, index]) => buildCurriculum(lessons, index)).catch((e: unknown) => { cache = null; throw e; });
  }
  return cache;
}
export function setCurriculumForTests(c: Curriculum | null): void { cache = c === null ? null : Promise.resolve(c); }

// ------------------------------------------------------------------ practice sets

const difficultyOf = (rating: number): PuzzleDifficulty => (rating < 1200 ? 'easy' : rating < 1800 ? 'medium' : 'hard');
export const practiceId = (skillId: string, lichessId: string) => `lc-${skillId}-${lichessId}`;

/** [lichessId, fen (solver to move), "uci uci ...", rating] rows -> validated puzzles. Anything illegal is dropped. */
export function practiceFromRows(skillId: string, raw: unknown): Puzzle[] {
  const rows = typeof raw === 'object' && raw !== null && Array.isArray((raw as { p?: unknown }).p) ? ((raw as { p: unknown[] }).p) : [];
  const out: Puzzle[] = [];
  for (const row of rows) {
    if (!Array.isArray(row) || typeof row[0] !== 'string' || typeof row[1] !== 'string' || typeof row[2] !== 'string' || typeof row[3] !== 'number') continue;
    const solution = row[2].split(' ').filter(Boolean);
    const v = validatePuzzle({ id: practiceId(skillId, row[0]), fen: row[1], solution, theme: 'lesson', difficulty: difficultyOf(row[3]), skillId, exact: true, rating: row[3], practice: true });
    if (v.ok) out.push(v.puzzle);
  }
  return out.sort((a, b) => (a.rating ?? 0) - (b.rating ?? 0));
}

const practiceCache = new Map<string, Promise<Puzzle[]>>();
export function loadPractice(skillId: string, baseUrl: string = import.meta.env.BASE_URL): Promise<Puzzle[]> {
  let p = practiceCache.get(skillId);
  if (p === undefined) {
    p = fetch(`${base(baseUrl)}data/practice/${skillId}.json`)
      .then((r) => { if (!r.ok) throw new Error(`Practice set not available (HTTP ${r.status})`); return r.json() as Promise<unknown>; })
      .then((raw) => practiceFromRows(skillId, raw))
      .catch((e: unknown) => { practiceCache.delete(skillId); throw e; });
    practiceCache.set(skillId, p);
  }
  return p;
}
export function setPracticeForTests(skillId: string, puzzles: Puzzle[] | null): void {
  if (puzzles === null) practiceCache.delete(skillId); else practiceCache.set(skillId, Promise.resolve(puzzles));
}

// ------------------------------------------------------------------ progress and unlocking

const PRACTICE_KEY = /^lc-(.+)-[A-Za-z0-9]{5}$/;
/** Practice positions solved per skill, read from the id prefix, so no practice file has to be loaded. */
export function practiceCounts(progress: PuzzleProgress): Map<string, { solved: number; clean: number }> {
  const out = new Map<string, { solved: number; clean: number }>();
  for (const [id, r] of Object.entries(progress.solved)) {
    const m = PRACTICE_KEY.exec(id);
    const skill = m?.[1];
    if (skill === undefined) continue;
    const cur = out.get(skill) ?? { solved: 0, clean: 0 };
    cur.solved += 1;
    if (r.clean) cur.clean += 1;
    out.set(skill, cur);
  }
  return out;
}

export interface PathProgress {
  mastery: Mastery;
  /** 0..1 across lesson exercises and the practice goal. */
  fraction: number;
  lessonSolved: number;
  lessonTotal: number;
  practiceSolved: number;
  practiceClean: number;
}

export function pathProgress(skill: PathSkill, progress: PuzzleProgress, counts: Map<string, { solved: number; clean: number }>): PathProgress {
  const lesson = skillProgress(skill, progress);
  const pr = counts.get(skill.id) ?? { solved: 0, clean: 0 };
  const hasPractice = skill.practice > 0;
  const lessonDone = lesson.total === 0 || lesson.solved === lesson.total;
  const lessonClean = lesson.total === 0 || lesson.clean === lesson.total;
  const goal = Math.min(MASTERED_AT, skill.practice);
  let mastery: Mastery;
  if (lessonClean && (!hasPractice || (pr.solved >= goal && pr.clean >= Math.min(MASTERED_CLEAN, goal)))) mastery = lesson.total === 0 && !hasPractice ? 'new' : 'mastered';
  else if (lessonDone && (!hasPractice || pr.solved >= Math.min(PRACTISED_AT, skill.practice)) && (lesson.total > 0 || hasPractice)) mastery = 'practised';
  else if (lesson.solved > 0 || pr.solved > 0) mastery = 'learning';
  else mastery = 'new';
  const denom = lesson.total + (hasPractice ? goal : 0);
  const fraction = denom === 0 ? 0 : Math.min(1, (lesson.solved + Math.min(pr.solved, goal)) / denom);
  return { mastery, fraction, lessonSolved: lesson.solved, lessonTotal: lesson.total, practiceSolved: pr.solved, practiceClean: pr.clean };
}

export type NodeState = 'mastered' | 'done' | 'next' | 'open' | 'locked';
export interface PathNode { skill: PathSkill; progress: PathProgress; state: NodeState; known: boolean; missing: string[] }

/**
 * A skill opens when everything it requires is practised (or known from the placement test). Locking only guides the order:
 * the UI still lets anyone open a locked skill. "next" is the first open skill that is not practised yet.
 */
export function pathNodes(cur: Curriculum, progress: PuzzleProgress, known: ReadonlySet<string> = new Set()): PathNode[] {
  const counts = practiceCounts(progress);
  const prog = new Map(cur.skills.map((s) => [s.id, pathProgress(s, progress, counts)]));
  const satisfied = (id: string) => known.has(id) || prog.get(id)?.mastery === 'mastered' || prog.get(id)?.mastery === 'practised';
  let nextTaken = false;
  return cur.skills.map((skill) => {
    const p = prog.get(skill.id) as PathProgress;
    const missing = skill.requires.filter((r) => !satisfied(r));
    const isKnown = known.has(skill.id);
    let state: NodeState;
    if (p.mastery === 'mastered') state = 'mastered';
    else if (p.mastery === 'practised' || isKnown) state = 'done';
    else if (missing.length > 0) state = 'locked';
    else if (!nextTaken) { state = 'next'; nextTaken = true; } else state = 'open';
    return { skill, progress: p, state, known: isKnown, missing };
  });
}

// ------------------------------------------------------------------ choosing what to practise

/** The next `limit` unsolved positions of a skill, easiest first. */
export function nextPractice(all: readonly Puzzle[], progress: PuzzleProgress, limit = 10): Puzzle[] {
  return all.filter((p) => progress.solved[p.id] === undefined).slice(0, limit);
}

/** Positions of a set whose spaced-repetition review is due, most overdue first. */
export function duePractice(all: readonly Puzzle[], progress: PuzzleProgress, now: number): Puzzle[] {
  const srs = progress.srs ?? {};
  return all.filter((p) => (srs[p.id]?.due ?? Infinity) <= now).sort((a, b) => (srs[a.id]?.due ?? 0) - (srs[b.id]?.due ?? 0));
}

/** Skill ids that currently have at least one due review (read from the ids, nothing loaded). */
export function skillsWithDueReviews(progress: PuzzleProgress, now: number): string[] {
  const out = new Set<string>();
  for (const [id, e] of Object.entries(progress.srs ?? {})) {
    const m = PRACTICE_KEY.exec(id);
    if (m?.[1] !== undefined && e.due <= now) out.add(m[1]);
  }
  return [...out];
}

export const DAILY_SIZE = 10;

/** Today's practice: due reviews first, then new positions from the skills the path says come next. */
export async function buildDaily(cur: Curriculum, progress: PuzzleProgress, known: ReadonlySet<string>, now: number, load: (id: string) => Promise<Puzzle[]> = loadPractice): Promise<Puzzle[]> {
  const out: Puzzle[] = [];
  const used = new Set<string>();
  const push = (p: Puzzle) => { if (!used.has(p.id) && out.length < DAILY_SIZE) { used.add(p.id); out.push(p); } };
  for (const id of skillsWithDueReviews(progress, now)) {
    const set = await load(id).catch(() => [] as Puzzle[]);
    duePractice(set, progress, now).forEach(push);
  }
  const nodes = pathNodes(cur, progress, known).filter((n) => n.skill.practice > 0 && (n.state === 'next' || n.state === 'open'));
  for (const n of nodes) {
    if (out.length >= DAILY_SIZE) break;
    const set = await load(n.skill.id).catch(() => [] as Puzzle[]);
    nextPractice(set, progress, n.state === 'next' ? DAILY_SIZE : 3).forEach(push);
  }
  return out;
}

/** Counts due reviews across practice sets without loading them (for the badge). */
export function dueReviewCount(progress: PuzzleProgress, now: number): number {
  let n = 0;
  for (const [id, e] of Object.entries(progress.srs ?? {})) if (PRACTICE_KEY.test(id) && e.due <= now) n += 1;
  return n;
}

// ------------------------------------------------------------------ placement

const PLACEMENT_KEY = 'chess-analysis:placement:v1';
export interface Placement { sampled: Record<string, string>; takenAt: number }
export function readPlacement(): Placement | null {
  try {
    const raw = JSON.parse(localStorage.getItem(PLACEMENT_KEY) ?? 'null') as unknown;
    if (typeof raw !== 'object' || raw === null) return null;
    const r = raw as Record<string, unknown>;
    const sampled: Record<string, string> = {};
    if (typeof r['sampled'] === 'object' && r['sampled'] !== null) for (const [k, v] of Object.entries(r['sampled'] as Record<string, unknown>)) if (typeof v === 'string') sampled[k] = v;
    return { sampled, takenAt: typeof r['takenAt'] === 'number' ? r['takenAt'] : 0 };
  } catch { return null; }
}
export function writePlacement(p: Placement | null): void {
  try { if (p === null) localStorage.removeItem(PLACEMENT_KEY); else localStorage.setItem(PLACEMENT_KEY, JSON.stringify(p)); } catch { /* storage may be blocked */ }
}
/** Skills where the placement position was solved first try count as known. */
export function knownFromPlacement(p: Placement | null, progress: PuzzleProgress): Set<string> {
  const out = new Set<string>();
  if (p === null) return out;
  for (const [pid, skill] of Object.entries(p.sampled)) if (progress.solved[pid]?.clean === true) out.add(skill);
  return out;
}
/** Skills sampled by the placement test, in path order; one mid-difficulty position of each. */
export const PLACEMENT_SKILLS = ['mate-in-1', 'loose-pieces', 'forks', 'pins', 'backrank', 'skewers', 'discovered', 'mate-in-2', 'trapped-pieces', 'deflection'] as const;
export async function buildPlacement(load: (id: string) => Promise<Puzzle[]> = loadPractice): Promise<{ puzzles: Puzzle[]; sampled: Record<string, string> }> {
  const puzzles: Puzzle[] = [];
  const sampled: Record<string, string> = {};
  for (const id of PLACEMENT_SKILLS) {
    const set = await load(id).catch(() => [] as Puzzle[]);
    if (set.length === 0) continue;
    const pick = [...set].sort((a, b) => Math.abs((a.rating ?? 1100) - 1100) - Math.abs((b.rating ?? 1100) - 1100))[0];
    if (pick === undefined) continue;
    puzzles.push(pick);
    sampled[pick.id] = id;
  }
  return { puzzles, sampled };
}
