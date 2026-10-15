import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { RELATED_LESSONS } from '@/play/coach';
import { validateSkills } from '@/lessons/lessons';
import { sanitizeSession } from '@/stores/playStore';
import { sanitizeSettings } from '@/stores/settingsStore';
import { openLesson, toggleSidebar, uiStore } from '@/stores/uiStore';

const skills = validateSkills(JSON.parse(readFileSync('public/data/lessons.json', 'utf8')) as unknown).skills;

describe('coach -> lessons links', () => {
  it('every related lesson id exists in the lesson set', () => {
    const ids = new Set(skills.map((s) => s.id));
    for (const list of Object.values(RELATED_LESSONS)) for (const id of list) expect(ids.has(id), id).toBe(true);
  });
  it('the new endgame lessons are present', () => {
    for (const id of ['opposition', 'lucena', 'philidor']) expect(skills.some((s) => s.id === id && s.category === 'endgames')).toBe(true);
  });
});

describe('saved play session', () => {
  const pgn = '[Event "x"]\n\n1. e4 e5 2. Nf3 *\n';
  it('accepts a well-formed session', () => {
    const s = sanitizeSession({ pgn, userColor: 'w', level: 'easy', savedAt: 5 });
    expect(s?.plies).toBe(3);
    expect(s?.userColor).toBe('w');
  });
  it('rejects garbage', () => {
    for (const bad of [null, 5, 'x', {}, { pgn, userColor: 'x', level: 'easy' }, { pgn, userColor: 'w', level: 'godlike' }, { pgn: '', userColor: 'w', level: 'easy' }, { pgn: 7, userColor: 'w', level: 'easy' }]) {
      expect(sanitizeSession(bad)).toBeNull();
    }
  });
});

describe('ui additions', () => {
  it('auto review on import is a boolean setting defaulting to on and survives bad data', () => {
    expect(sanitizeSettings({}).autoReviewOnImport).toBe(true);
    expect(sanitizeSettings({ autoReviewOnImport: false }).autoReviewOnImport).toBe(false);
    expect(sanitizeSettings({ autoReviewOnImport: 'no' }).autoReviewOnImport).toBe(true);
  });
  it('openLesson routes to the Learn tab and toggleSidebar flips', () => {
    openLesson('forks');
    expect(uiStore.get().rightTab).toBe('learn');
    expect(uiStore.get().learnRequest).toBe('forks');
    const before = uiStore.get().sidebarCollapsed;
    toggleSidebar();
    expect(uiStore.get().sidebarCollapsed).toBe(!before);
  });
});
