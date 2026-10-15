import { Chess } from 'chess.js';
import { useEffect, useMemo, useRef, useState } from 'react';
import { splitUci, pvToSan } from '@/analysis/pv';
import {
  CATEGORY_LABEL,
  CATEGORY_ORDER,
  MASTERY_LABEL,
  exerciseToPuzzle,
  loadLessons,
  skillProgress,
  type LessonExercise,
  type Skill,
  type SkillCategory,
} from '@/lessons/lessons';
import { startPuzzleSession, usePuzzle } from '@/stores/puzzleStore';
import { usePlay } from '@/stores/playStore';
import { setMobileTab, setRightTab, uiStore, useUi } from '@/stores/uiStore';
import { MiniBoard } from './MiniBoard';

/** Positions along an exercise's solution: [start, after move 1, ...] plus the squares of the last move. */
function demoFrames(ex: LessonExercise): { fen: string; highlight: string[]; label: string }[] {
  const frames = [{ fen: ex.fen, highlight: [] as string[], label: 'Start' }];
  const chess = new Chess(ex.fen);
  const san = pvToSan(ex.fen, ex.solution, ex.solution.length).moves;
  ex.solution.forEach((uci, i) => {
    const mv = splitUci(uci);
    if (mv === null) return;
    try {
      chess.move({ from: mv.from, to: mv.to, ...(mv.promotion !== undefined ? { promotion: mv.promotion } : {}) });
    } catch {
      return;
    }
    frames.push({ fen: chess.fen(), highlight: [mv.from, mv.to], label: san[i]?.san ?? uci });
  });
  return frames;
}

function Demo({ ex }: { ex: LessonExercise }) {
  const frames = useMemo(() => demoFrames(ex), [ex]);
  const [i, setI] = useState(0);
  useEffect(() => setI(0), [ex]);
  const frame = frames[Math.min(i, frames.length - 1)];
  if (frame === undefined) return null;
  return (
    <div className="lesson-demo" data-testid="lesson-demo">
      <MiniBoard fen={frame.fen} size={176} highlight={frame.highlight} flip={ex.sideToMove === 'b'} />
      <div>
        <div className="muted small-print">Worked example (you solve it first-hand below): {ex.sideToMove === 'w' ? 'White' : 'Black'} to move</div>
        <div className="demo-controls">
          <button className="btn small" onClick={() => setI(Math.max(0, i - 1))} disabled={i === 0} aria-label="Example: previous move">◀</button>
          <strong data-testid="demo-label">{frame.label}</strong>
          <button className="btn small" onClick={() => setI(Math.min(frames.length - 1, i + 1))} disabled={i >= frames.length - 1} aria-label="Example: next move">▶</button>
        </div>
        <p className="small-print">{ex.why}</p>
      </div>
    </div>
  );
}

export function LearnPanel() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState<SkillCategory | 'all'>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const learnRequest = useUi((s) => s.learnRequest);
  const progress = usePuzzle((s) => s.progress);
  const puzzleOpen = usePuzzle((s) => s.phase !== 'off');
  const playing = usePlay((s) => s.phase === 'playing');

  useEffect(() => {
    let alive = true;
    loadLessons()
      .then((s) => alive && setSkills(s))
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : 'Lessons could not be loaded.'));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (learnRequest === null) return;
    setOpenId(learnRequest);
    setCategory('all');
    uiStore.set({ learnRequest: null });
  }, [learnRequest]);

  const rootRef = useRef<HTMLElement>(null);
  useEffect(() => {
    // Opening a skill (or going back) starts at the top of the panel instead of keeping the old scroll position.
    rootRef.current?.closest('.right-panels')?.scrollTo?.(0, 0);
  }, [openId]);

  const open = skills.find((s) => s.id === openId) ?? null;
  const blocked = puzzleOpen || playing;

  const start = (skill: Skill, only?: LessonExercise) => {
    const list = only !== undefined ? [only] : skill.exercises;
    startPuzzleSession(list.map((ex) => exerciseToPuzzle(skill, ex)));
    setRightTab('puzzles');
    setMobileTab('board');
  };

  const totals = useMemo(() => {
    let solved = 0;
    let all = 0;
    let mastered = 0;
    for (const s of skills) {
      const p = skillProgress(s, progress);
      solved += p.solved;
      all += p.total;
      if (p.mastery === 'mastered') mastered += 1;
    }
    return { solved, all, mastered };
  }, [skills, progress]);

  return (
    <section className="panel learn-panel" aria-label="Learn" ref={rootRef}>
      <header className="panel-head">
        <h2>Learn</h2>
        <div className="spacer" />
        {open && <button className="btn small" onClick={() => setOpenId(null)} data-testid="learn-back">All skills</button>}
      </header>
      {error && <div className="callout error">{error}</div>}
      {blocked && <div className="callout small">{puzzleOpen ? 'An exercise is open. Finish or exit it in the Puzzles tab before starting another.' : 'Finish or leave your Play game before starting a lesson.'}</div>}

      {open === null ? (
        <>
          <p className="muted small-print" data-testid="learn-summary">
            {totals.solved} of {totals.all} exercises solved · {totals.mastered} of {skills.length} skills mastered. Mastery is counted only from your own results: all exercises solved on the first try without hints.
          </p>
          <div className="learn-cats" role="group" aria-label="Skill category">
            {(['all', ...CATEGORY_ORDER] as const).map((c) => (
              <button key={c} className={category === c ? 'active' : ''} onClick={() => setCategory(c)}>{c === 'all' ? 'All' : CATEGORY_LABEL[c]}</button>
            ))}
          </div>
          <ul className="skill-list">
            {skills.filter((s) => category === 'all' || s.category === category).map((s) => {
              const p = skillProgress(s, progress);
              return (
                <li key={s.id}>
                  <button className="skill-card" onClick={() => setOpenId(s.id)} data-testid={`skill-${s.id}`}>
                    <span className="skill-title">{s.title}</span>
                    <span className="skill-blurb">{s.blurb}</span>
                    <span className="skill-meta">
                      <span className="pill">{CATEGORY_LABEL[s.category]}</span>
                      <span className={`mastery-${p.mastery}`}>{MASTERY_LABEL[p.mastery]}</span>
                      <span className="muted">{p.solved}/{p.total} solved</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      ) : (
        <div data-testid="skill-detail">
          <h3>{open.title}</h3>
          {open.color !== undefined && <p className="muted small-print">You play {open.color === 'w' ? 'White' : 'Black'} in this opening.</p>}
          {open.intro.map((t, i) => <p key={i}>{t}</p>)}
          {open.ideas.length > 0 && (
            <>
              <strong>Key ideas</strong>
              <ul className="learn-ideas">{open.ideas.map((t, i) => <li key={i}>{t}</li>)}</ul>
            </>
          )}
          {open.exercises[0] && <Demo ex={open.exercises[0]} />}
          <div className="row wrap">
            <button className="btn primary" disabled={blocked || open.exercises.length === 0} onClick={() => start(open)} data-testid="lesson-start">
              Start lesson ({open.exercises.length} exercise{open.exercises.length === 1 ? '' : 's'})
            </button>
          </div>
          <h3>Exercises</h3>
          <ul className="exercise-list">
            {open.exercises.map((ex, i) => {
              const r = progress.solved[ex.id];
              return (
                <li key={ex.id}>
                  <button disabled={blocked} onClick={() => start(open, ex)} data-testid={`exercise-${ex.id}`}>
                    <strong>{i + 1}.</strong>
                    <span>{ex.kind === 'book' ? (ex.opening ?? 'Opening line') : `${ex.sideToMove === 'w' ? 'White' : 'Black'} to move`}</span>
                    <span className="muted">{r === undefined ? 'not solved' : r.clean ? 'solved first try ✓' : 'solved'}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="muted small-print">
            {open.exercises.some((e) => e.kind === 'book')
              ? 'Opening lines come from the Lichess opening database; there is no single "best" move in a line you are memorising.'
              : 'Every position and answer in this lesson was re-checked with Stockfish.'}
          </p>
        </div>
      )}
    </section>
  );
}
