import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateSkills } from '@/lessons/lessons';
import { EMPTY_PROGRESS, type Puzzle, type PuzzleProgress } from '@/puzzles/puzzles';
import {
  buildCurriculum, buildDaily, buildPlacement, dueReviewCount, knownFromPlacement, nextPractice, pathNodes, pathProgress, practiceCounts, practiceFromRows, practiceId, MASTERED_AT, PRACTISED_AT, type Curriculum,
} from '@/lessons/path';

const dir = resolve(__dirname, '../public/data');
const lessons = validateSkills(JSON.parse(readFileSync(resolve(dir, 'lessons.json'), 'utf8')) as unknown).skills;
const index = JSON.parse(readFileSync(resolve(dir, 'practice/index.json'), 'utf8')) as unknown;
const cur = buildCurriculum(lessons, index);

describe('the bundled learning path', () => {
  it('has three levels and more skills than the hand-written lessons', () => {
    expect(cur.levels.map((l) => l.id)).toEqual(['l1', 'l2', 'l3']);
    expect(cur.skills.length).toBeGreaterThan(lessons.length);
    expect(cur.skills.length).toBe(new Set(cur.skills.map((s) => s.id)).size);
  });
  it('only requires skills that exist, and never requires itself or something later (no cycles)', () => {
    const order = new Map(cur.skills.map((s, i) => [s.id, i]));
    for (const s of cur.skills) for (const r of s.requires) {
      expect(order.has(r), `${s.id} requires unknown ${r}`).toBe(true);
      expect(order.get(r)!, `${s.id} requires a later skill ${r}`).toBeLessThan(order.get(s.id)!);
    }
  });
  it('every skill has something to do: lesson exercises or a practice set', () => {
    for (const s of cur.skills) expect(s.exercises.length + s.practice, s.id).toBeGreaterThan(0);
  });
  it('new skills carry their own explanation', () => {
    for (const s of cur.skills.filter((x) => x.exercises.length === 0)) {
      expect(s.title.length, s.id).toBeGreaterThan(2);
      expect(s.intro.length, s.id).toBeGreaterThan(0);
      expect(s.ideas.length, s.id).toBeGreaterThan(0);
    }
  });
  it('every practice file matches the index and every position is a legal puzzle', () => {
    const files = readdirSync(resolve(dir, 'practice')).filter((f) => f !== 'index.json');
    for (const s of cur.skills.filter((x) => x.practice > 0)) {
      expect(files, s.id).toContain(`${s.id}.json`);
      const raw = JSON.parse(readFileSync(resolve(dir, `practice/${s.id}.json`), 'utf8')) as { p: unknown[] };
      const puzzles = practiceFromRows(s.id, raw);
      expect(puzzles.length, s.id).toBe(raw.p.length);
      expect(puzzles.length, s.id).toBe(s.practice);
      expect(puzzles.every((p, i) => i === 0 || (puzzles[i - 1]!.rating ?? 0) <= (p.rating ?? 0))).toBe(true);
    }
  });
  it('has at least 3000 practice positions in total', () => {
    expect(cur.skills.reduce((n, s) => n + s.practice, 0)).toBeGreaterThan(3000);
  });
});

const mini: Curriculum = {
  levels: [{ id: 'l1', title: 'One', blurb: '' }],
  skills: [
    { id: 'a', title: 'A', category: 'tactics', blurb: '', intro: [], ideas: [], exercises: [], level: 'l1', requires: [], practice: 30 },
    { id: 'b', title: 'B', category: 'tactics', blurb: '', intro: [], ideas: [], exercises: [], level: 'l1', requires: ['a'], practice: 30 },
    { id: 'c', title: 'C', category: 'tactics', blurb: '', intro: [], ideas: [], exercises: [], level: 'l1', requires: ['b'], practice: 30 },
  ],
};
const solved = (skill: string, n: number, clean: boolean, from = 0): PuzzleProgress['solved'] =>
  Object.fromEntries(Array.from({ length: n }, (_, i) => [`lc-${skill}-${String(from + i).padStart(5, 'x')}`, { attempts: clean ? 1 : 2, clean }]));

describe('progress, unlocking and mastery', () => {
  it('reads practice counts from the ids', () => {
    const c = practiceCounts({ ...EMPTY_PROGRESS, solved: { ...solved('a', 3, true), ...solved('b', 2, false) } });
    expect(c.get('a')).toEqual({ solved: 3, clean: 3 });
    expect(c.get('b')).toEqual({ solved: 2, clean: 0 });
  });
  it('a fresh learner has the first skill next and the rest locked', () => {
    const n = pathNodes(mini, EMPTY_PROGRESS);
    expect(n.map((x) => x.state)).toEqual(['next', 'locked', 'locked']);
  });
  it('practising enough opens the next skill', () => {
    const n = pathNodes(mini, { ...EMPTY_PROGRESS, solved: solved('a', PRACTISED_AT, false) });
    expect(n.map((x) => x.state)).toEqual(['done', 'next', 'locked']);
  });
  it('mastery needs the practice goal and most of it solved first try', () => {
    const counts = (solvedMap: PuzzleProgress['solved']) => pathProgress(mini.skills[0]!, { ...EMPTY_PROGRESS, solved: solvedMap }, practiceCounts({ ...EMPTY_PROGRESS, solved: solvedMap })).mastery;
    expect(counts(solved('a', 5, true))).toBe('learning');
    expect(counts(solved('a', PRACTISED_AT, false))).toBe('practised');
    expect(counts(solved('a', MASTERED_AT, false))).toBe('practised');
    expect(counts(solved('a', MASTERED_AT, true))).toBe('mastered');
  });
  it('a skill known from the placement test counts as done and opens the next one', () => {
    const n = pathNodes(mini, EMPTY_PROGRESS, new Set(['a']));
    expect(n.map((x) => x.state)).toEqual(['done', 'next', 'locked']);
    expect(n[0]!.known).toBe(true);
  });
  it('placement: only positions solved first try make a skill known', () => {
    const p = { sampled: { x1: 'a', x2: 'b' }, takenAt: 1 };
    const known = knownFromPlacement(p, { ...EMPTY_PROGRESS, solved: { x1: { attempts: 1, clean: true }, x2: { attempts: 2, clean: false } } });
    expect([...known]).toEqual(['a']);
  });
});

const puz = (skill: string, n: number): Puzzle[] =>
  Array.from({ length: n }, (_, i) => ({ id: practiceId(skill, String(i).padStart(5, 'x')), fen: '4k3/8/8/8/8/8/8/4K2R w - - 0 1', solution: ['h1h8'], theme: 'lesson' as const, difficulty: 'easy' as const, sideToMove: 'w' as const, rating: 800 + i, practice: true, skillId: skill }));

describe('what to practise', () => {
  it('next positions skip the solved ones, easiest first', () => {
    const set = puz('a', 12);
    const out = nextPractice(set, { ...EMPTY_PROGRESS, solved: { [set[0]!.id]: { attempts: 1, clean: true } } }, 3);
    expect(out.map((p) => p.id)).toEqual([set[1]!.id, set[2]!.id, set[3]!.id]);
  });
  it('the daily set is due reviews first, then new positions from the next skill', async () => {
    const sets = { a: puz('a', 30), b: puz('b', 30), c: puz('c', 30) } as Record<string, Puzzle[]>;
    const now = 10_000_000;
    const progress: PuzzleProgress = { ...EMPTY_PROGRESS, solved: { ...solved('a', PRACTISED_AT, true) }, srs: { [sets.a![0]!.id]: { box: 1, due: now - 1000 }, [sets.a![1]!.id]: { box: 1, due: now + 1000 } } };
    expect(dueReviewCount(progress, now)).toBe(1);
    const daily = await buildDaily(mini, progress, new Set(), now, (id) => Promise.resolve(sets[id] ?? []));
    expect(daily).toHaveLength(10);
    expect(daily[0]!.id).toBe(sets.a![0]!.id);
    expect(daily.slice(1).every((p) => p.skillId !== 'c')).toBe(true);
  });
  it('the placement test picks one mid-difficulty position per sampled skill that has a set', async () => {
    const r = await buildPlacement((id) => Promise.resolve(id === 'forks' ? puz('forks', 5) : []));
    expect(r.puzzles).toHaveLength(1);
    expect(Object.values(r.sampled)).toEqual(['forks']);
  });
});
