import { Chess } from 'chess.js';
import { useEffect, useMemo, useRef, useState } from 'react';
import { splitUci, pvToSan } from '@/analysis/pv';
import {
  CATEGORY_LABEL,
  CATEGORY_ORDER,
  MASTERY_LABEL,
  exerciseToPuzzle,
  type LessonExercise,
  type SkillCategory,
} from '@/lessons/lessons';
import {
  DAILY_SIZE,
  MASTERED_AT,
  buildDaily,
  buildPlacement,
  dueReviewCount,
  knownFromPlacement,
  duePractice,
  loadCurriculum,
  loadPractice,
  nextPractice,
  pathNodes,
  readPlacement,
  writePlacement,
  type Curriculum,
  type NodeState,
  type PathNode,
  type PathSkill,
} from '@/lessons/path';
import { RELATED_LESSONS } from '@/play/coach';
import { recentGames, trainingPuzzles } from '@/strength/strength';
import { validatePuzzle, type Puzzle } from '@/puzzles/puzzles';
import { startPuzzleSession, usePuzzle } from '@/stores/puzzleStore';
import { useStrength } from '@/stores/strengthStore';
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


const STATE_LABEL: Record<NodeState, string> = { mastered: 'Mastered', done: 'Done', next: 'Up next', open: 'Open', locked: 'Locked' };
const STATE_MARK: Record<NodeState, string> = { mastered: '★', done: '✓', next: '→', open: '○', locked: '🔒' };

/** The player's own saved mistakes that belong to a skill (via the coach categories that point at it). */
function ownMistakes(skillId: string, games: Parameters<typeof recentGames>[0], solved: Record<string, { clean: boolean }>, limit = 10): Puzzle[] {
  const cats = (Object.keys(RELATED_LESSONS) as (keyof typeof RELATED_LESSONS)[]).filter((c) => RELATED_LESSONS[c].includes(skillId));
  if (cats.length === 0) return [];
  const seen = new Set<string>();
  const out: Puzzle[] = [];
  for (const g of recentGames(games)) {
    for (const m of g.mistakes) {
      const key = `${m.fen}|${m.best}`;
      if (!cats.includes(m.category) || seen.has(key) || solved[m.id]?.clean === true) continue;
      seen.add(key);
      const v = validatePuzzle({ id: m.id, fen: m.fen, solution: [m.best], theme: 'mistake', difficulty: 'medium' });
      if (v.ok) out.push(v.puzzle);
      if (out.length >= limit) return out;
    }
  }
  return out;
}

export function LearnPanel() {
  const [cur, setCur] = useState<Curriculum | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<'path' | 'all'>('path');
  const [category, setCategory] = useState<SkillCategory | 'all'>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const [practiceSet, setPracticeSet] = useState<Puzzle[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [placement, setPlacement] = useState(() => readPlacement());
  const learnRequest = useUi((s) => s.learnRequest);
  const progress = usePuzzle((s) => s.progress);
  const puzzleOpen = usePuzzle((s) => s.phase !== 'off');
  const playing = usePlay((s) => s.phase === 'playing');
  const games = useStrength((s) => s.games);

  useEffect(() => {
    let alive = true;
    loadCurriculum()
      .then((c) => alive && setCur(c))
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
    setNote(null);
  }, [openId]);

  const open = cur?.skills.find((s) => s.id === openId) ?? null;
  useEffect(() => {
    setPracticeSet(null);
    if (open === null || open.practice === 0) return;
    let alive = true;
    loadPractice(open.id).then((set) => alive && setPracticeSet(set)).catch(() => alive && setPracticeSet([]));
    return () => {
      alive = false;
    };
  }, [open?.id, open?.practice]); // eslint-disable-line react-hooks/exhaustive-deps

  const blocked = puzzleOpen || playing;
  const known = useMemo(() => knownFromPlacement(placement, progress), [placement, progress]);
  const nodes = useMemo(() => (cur === null ? [] : pathNodes(cur, progress, known)), [cur, progress, known]);
  const nodeOf = (id: string): PathNode | undefined => nodes.find((n) => n.skill.id === id);
  const now = Date.now();
  const due = dueReviewCount(progress, now);
  const own = useMemo(() => trainingPuzzles(games, progress), [games, progress]);

  const run = (puzzles: Puzzle[]) => {
    if (puzzles.length === 0) return false;
    startPuzzleSession(puzzles);
    setRightTab('puzzles');
    setMobileTab('board');
    return true;
  };
  const start = (skill: PathSkill, only?: LessonExercise) => {
    const list = only !== undefined ? [only] : skill.exercises;
    run(list.map((ex) => exerciseToPuzzle(skill, ex)));
  };

  const startDaily = async () => {
    if (cur === null) return;
    setBusy(true);
    const list = await buildDaily(cur, progress, known, Date.now());
    setBusy(false);
    if (!run(list)) setNote('Nothing is due today. Open a skill on the path to practise something new.');
  };
  const startPlacement = async () => {
    setBusy(true);
    const { puzzles, sampled } = await buildPlacement();
    setBusy(false);
    if (puzzles.length === 0) { setNote('The placement positions could not be loaded.'); return; }
    const p = { sampled, takenAt: Date.now() };
    writePlacement(p);
    setPlacement(p);
    run(puzzles);
  };
  const startPractice = (skill: PathSkill) => {
    if (practiceSet === null) return;
    const fresh = nextPractice(practiceSet, progress, DAILY_SIZE);
    const list = fresh.length > 0 ? fresh : duePractice(practiceSet, progress, Date.now()).slice(0, DAILY_SIZE);
    if (!run(list)) setNote(`You have solved all ${skill.practice} positions here. Reviews come back when they are due.`);
  };

  const totals = useMemo(() => {
    let solved = 0;
    let mastered = 0;
    for (const n of nodes) {
      solved += n.progress.lessonSolved + n.progress.practiceSolved;
      if (n.state === 'mastered') mastered += 1;
    }
    return { solved, mastered, skills: nodes.length };
  }, [nodes]);

  const placed = placement === null ? 0 : Object.keys(placement.sampled).length;
  const placementDone = placement !== null && Object.keys(placement.sampled).every((id) => progress.solved[id] !== undefined);

  const levelNodes = (levelId: string) => nodes.filter((n) => n.skill.level === levelId);

  return (
    <section className="panel learn-panel lp" aria-label="Learn" ref={rootRef}>
      {open && <button className="btn small ghost lp-back" onClick={() => setOpenId(null)} data-testid="learn-back">← All skills</button>}
      {error && <div className="callout error">{error}</div>}
      {blocked && <div className="callout small">{puzzleOpen ? 'An exercise is open. Finish or exit it in the Puzzles tab before starting another.' : 'Finish or leave your Play game before starting a lesson.'}</div>}
      {note && <div className="callout small" role="status" data-testid="learn-note">{note}</div>}

      {cur === null ? (!error && <p className="muted">Loading the path…</p>) : open === null ? (
        <>
          <div className="rp-card lp-sum">
            <div>
              <div className="lp-big">{totals.mastered} / {totals.skills}</div>
              <p className="muted small-print" data-testid="learn-summary">
                {totals.mastered} of {totals.skills} skills mastered · {totals.solved} exercises and positions solved. Mastery is counted only from your own results: the lesson clean, then at least 14 of 20 practice positions on the first try.
              </p>
            </div>
          </div>

          <div className="lp-actions">
            <div className="rp-card lp-today" data-testid="daily-card">
              <strong>Today's practice</strong>
              <p className="muted small-print">{due > 0 ? `${due} review${due === 1 ? '' : 's'} due, then new positions from where you are on the path.` : `${DAILY_SIZE} positions from where you are on the path.`}</p>
              <button className="btn primary" disabled={blocked || busy} onClick={() => void startDaily()} data-testid="daily-start">Start today's {DAILY_SIZE}</button>
            </div>
            <div className="rp-card lp-today" data-testid="placement-card">
              <strong>{placement === null ? 'Where should I start?' : 'Placement test'}</strong>
              <p className="muted small-print">
                {placement === null
                  ? 'Ten quick positions, one per core skill. Skills you solve first try count as known and unlock what comes next.'
                  : placementDone ? `Done: ${known.size} of ${placed} skills counted as known.` : 'Started. Finish the positions in the Puzzles tab, or take it again.'}
              </p>
              <button className="btn" disabled={blocked || busy} onClick={() => void startPlacement()} data-testid="placement-start">{placement === null ? 'Take the test' : 'Take it again'}</button>
            </div>
          </div>
          {own.length > 0 && (
            <div className="rp-card lp-today">
              <strong>From your games</strong>
              <p className="muted small-print">{own.length} position{own.length === 1 ? '' : 's'} from mistakes in your analysed games.</p>
              <button className="btn" disabled={blocked} onClick={() => run(own)} data-testid="own-start">Practise my mistakes</button>
            </div>
          )}

          <div className="lp-views" role="group" aria-label="Learn view">
            <button className={view === 'path' ? 'active' : ''} onClick={() => setView('path')} data-testid="view-path">Path</button>
            <button className={view === 'all' ? 'active' : ''} onClick={() => setView('all')} data-testid="view-all">All skills</button>
          </div>

          {view === 'path' ? (
            <div className="lp-path" data-testid="learn-path">
              {cur.levels.map((lv, li) => {
                const ln = levelNodes(lv.id);
                if (ln.length === 0) return null;
                const done = ln.filter((n) => n.state === 'done' || n.state === 'mastered').length;
                return (
                  <div key={lv.id} className="lp-level">
                    <div className="lp-level-head"><span className="lp-level-n">{li + 1}</span><div><strong>{lv.title}</strong><small className="muted">{lv.blurb}</small></div><span className="muted small-print">{done}/{ln.length}</span></div>
                    <ul className="lp-nodes">
                      {ln.map((n) => (
                        <li key={n.skill.id}>
                          <button className={`path-node st-${n.state}`} onClick={() => setOpenId(n.skill.id)} data-testid={`skill-${n.skill.id}`}>
                            <span className="pn-mark" aria-hidden="true">{STATE_MARK[n.state]}</span>
                            <span className="pn-body">
                              <span className="skill-title">{n.skill.title}</span>
                              <span className="lp-bar"><i style={{ width: `${n.progress.fraction * 100}%` }} /></span>
                            </span>
                            <span className="pn-state">{n.known && n.state === 'done' ? 'Known' : STATE_LABEL[n.state]}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          ) : (
            <>
              <div className="learn-cats lp-cats" role="group" aria-label="Skill category">
                {(['all', ...CATEGORY_ORDER] as const).map((c) => (
                  <button key={c} className={category === c ? 'active' : ''} onClick={() => setCategory(c)}>{c === 'all' ? 'All' : CATEGORY_LABEL[c]}</button>
                ))}
              </div>
              <ul className="skill-list lp-grid">
                {cur.skills.filter((s) => category === 'all' || s.category === category).map((s) => {
                  const n = nodeOf(s.id);
                  const p = n?.progress;
                  return (
                    <li key={s.id}>
                      <button className="skill-card" onClick={() => setOpenId(s.id)} data-testid={`skill-${s.id}`}>
                        <span className="skill-title">{s.title}</span>
                        <span className="skill-blurb">{s.blurb}</span>
                        <span className="lp-bar"><i style={{ width: `${(p?.fraction ?? 0) * 100}%` }} /></span>
                        <span className="skill-meta">
                          <span className="pill">{CATEGORY_LABEL[s.category]}</span>
                          <span className={`mastery-${p?.mastery ?? 'new'}`}>{MASTERY_LABEL[p?.mastery ?? 'new']}</span>
                          <span className="muted">{p ? `${p.lessonSolved + p.practiceSolved} solved` : ''}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </>
      ) : (
        <SkillDetail
          skill={open}
          node={nodeOf(open.id)}
          practiceSet={practiceSet}
          blocked={blocked}
          onStart={start}
          onPractice={() => startPractice(open)}
          mine={ownMistakes(open.id, games, progress.solved)}
          onMine={(list) => run(list)}
          progressSolved={progress.solved}
          nodeName={(id) => cur.skills.find((s) => s.id === id)?.title ?? id}
          onOpen={setOpenId}
        />
      )}
    </section>
  );
}

function SkillDetail(props: {
  skill: PathSkill;
  node: PathNode | undefined;
  practiceSet: Puzzle[] | null;
  blocked: boolean;
  onStart: (s: PathSkill, only?: LessonExercise) => void;
  onPractice: () => void;
  mine: Puzzle[];
  onMine: (list: Puzzle[]) => void;
  progressSolved: Record<string, { attempts: number; clean: boolean }>;
  nodeName: (id: string) => string;
  onOpen: (id: string) => void;
}) {
  const { skill: open, node, practiceSet, blocked } = props;
  const pr = node?.progress;
  const ratings = practiceSet?.map((p) => p.rating ?? 0).filter((r) => r > 0) ?? [];
  const lo = ratings.length ? Math.min(...ratings) : 0;
  const hi = ratings.length ? Math.max(...ratings) : 0;
  const goal = Math.min(MASTERED_AT, open.practice);
  return (
    <div data-testid="skill-detail">
      <h3 className="lp-title">{open.title}</h3>
      {node && node.state === 'locked' && (
        <div className="callout small" data-testid="locked-note">
          This comes after {node.missing.map((id) => props.nodeName(id)).join(', ')}. You can still open it, but the path works best in order.{' '}
          {node.missing.slice(0, 2).map((id) => <button key={id} className="btn small ghost" onClick={() => props.onOpen(id)}>{props.nodeName(id)} →</button>)}
        </div>
      )}
      {open.color !== undefined && <p className="muted small-print">You play {open.color === 'w' ? 'White' : 'Black'} in this opening.</p>}
      {open.intro.map((t, i) => <p key={i}>{t}</p>)}
      {open.ideas.length > 0 && (
        <>
          <strong>Key ideas</strong>
          <ul className="learn-ideas">{open.ideas.map((t, i) => <li key={i}>{t}</li>)}</ul>
        </>
      )}
      {open.exercises[0] && <Demo ex={open.exercises[0]} />}
      {open.exercises.length > 0 && (
        <div className="row wrap">
          <button className="btn primary" disabled={blocked} onClick={() => props.onStart(open)} data-testid="lesson-start">
            Start lesson ({open.exercises.length} exercise{open.exercises.length === 1 ? '' : 's'})
          </button>
        </div>
      )}
      {open.practice > 0 && (
        <div className="rp-card lp-practice" data-testid="practice-card">
          <strong>Practice</strong>
          <p className="muted small-print">
            {open.practice} real positions from Lichess puzzles{lo > 0 ? `, rated ${lo} to ${hi}, easiest first` : ''}. Solved {pr?.practiceSolved ?? 0} of {goal} for mastery ({pr?.practiceClean ?? 0} first try).
          </p>
          <span className="lp-bar"><i style={{ width: `${goal ? Math.min(1, (pr?.practiceSolved ?? 0) / goal) * 100 : 0}%` }} /></span>
          <button className="btn primary" disabled={blocked || practiceSet === null} onClick={props.onPractice} data-testid="practice-start">Practise {DAILY_SIZE} positions</button>
        </div>
      )}
      {props.mine.length > 0 && (
        <div className="row wrap">
          <button className="btn" disabled={blocked} onClick={() => props.onMine(props.mine)} data-testid="mine-start">From your games ({props.mine.length})</button>
        </div>
      )}
      {open.exercises.length > 0 && (
        <>
          <h3>Exercises</h3>
          <ul className="exercise-list">
            {open.exercises.map((ex, i) => {
              const r = props.progressSolved[ex.id];
              return (
                <li key={ex.id}>
                  <button disabled={blocked} onClick={() => props.onStart(open, ex)} data-testid={`exercise-${ex.id}`}>
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
              : 'Every position and answer in the lesson was re-checked with Stockfish.'}
          </p>
        </>
      )}
      {open.practice > 0 && <p className="muted small-print">Practice positions come from the Lichess puzzle database (CC0), which validates them; they were not re-checked with Stockfish here.</p>}
    </div>
  );
}
