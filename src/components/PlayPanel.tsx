import { useEffect, useMemo, useState } from 'react';
import { formatScore, whiteWinPercent } from '@/analysis/eval';
import { CATEGORY_LABEL, CATEGORY_ORDER, RELATED_LESSONS, type CoachCategory } from '@/play/coach';
import { loadLessons, type Skill } from '@/lessons/lessons';
import { summarizeHistory } from '@/play/history';
import { LEVELS, MAX_MOVETIME, MIN_MOVETIME, STRENGTH_DISCLAIMER, specFor, type LevelId } from '@/play/strength';
import { recommendPuzzles } from '@/play/training';
import { GRADE_LABEL } from '@/analysis/gradeInfo';
import { explainBadMove } from '@/analysis/whyBad';
import { TIME_CONTROLS, TIME_CONTROL_IDS } from '@/play/clock';
import { loadPuzzles, type Puzzle } from '@/puzzles/puzzles';
import { parsePgn } from '@/pgn/pgn';
import { getNode, mainLine } from '@/chess/gameTree';
import { MiniBoard } from '@/components/MiniBoard';
import { EvalGraph } from '@/components/ReviewPanel';
import { currentFen, gameStore, goTo, loadGame, notify, playLine, useGame } from '@/stores/gameStore';
import { clearHistory, useHistory } from '@/stores/historyStore';
import {
  analyzeGame, checkPlayablePosition, discardSavedSession, exitPlay, resumeSavedGame, useSavedSession, offerDraw, requestHint, resign, retryEngineMove, showAlternative, startGame, takeBack, updatePlaySettings, usePlay, visibleFeedback,
  type FeedbackMode, type MoveFeedback,
} from '@/stores/playStore';
import { startPuzzleSession, usePuzzle } from '@/stores/puzzleStore';
import { useReview } from '@/stores/reviewStore';
import { PerfBox } from './ReviewPanel';
import { confirmThen, openLesson, setMobileTab, setRightTab } from '@/stores/uiStore';

const FEEDBACK_LABEL: Record<FeedbackMode, string> = {
  none: 'No feedback during the game',
  every: 'After every move',
  significant: 'Only significant mistakes',
  after: 'Review everything after the game',
};

function useAllPuzzles(): Puzzle[] {
  const [all, setAll] = useState<Puzzle[]>([]);
  useEffect(() => {
    let alive = true;
    loadPuzzles().then((p) => alive && setAll(p)).catch(() => undefined);
    return () => { alive = false; };
  }, []);
  return all;
}

// ---------------------------------------------------------------------- setup

function CoachingSettings() {
  const s = usePlay((p) => p.settings);
  return (
    <div className="coach-settings pl-card">
      <div className="rp-label">Coaching</div>
      <label className="pl-row"><span className="rp-t"><b>Allow hints</b></span><input type="checkbox" className="switch" checked={s.hints} onChange={(e) => updatePlaySettings({ hints: e.target.checked })} data-testid="opt-hints" /></label>
      <label className="pl-row"><span className="rp-t"><b>Show evaluation bar</b></span><input type="checkbox" className="switch" checked={s.showEval} onChange={(e) => updatePlaySettings({ showEval: e.target.checked })} data-testid="opt-eval" /></label>
      <div className="pl-row col"><span className="rp-t"><b>Move feedback</b></span>
        <div className="seg small pl-wrap" role="radiogroup" aria-label="Move feedback" data-testid="opt-feedback">
          {(Object.keys(FEEDBACK_LABEL) as FeedbackMode[]).map((k) => <button key={k} type="button" role="radio" aria-checked={s.feedback === k} className={s.feedback === k ? 'on' : ''} onClick={() => updatePlaySettings({ feedback: k })} title={FEEDBACK_LABEL[k]}>{FEEDBACK_SHORT[k]}</button>)}
        </div>
      </div>
    </div>
  );
}

const FEEDBACK_SHORT: Record<FeedbackMode, string> = { none: 'Off', every: 'Every move', significant: 'Big mistakes', after: 'At the end' };

function Dashboard() {
  const records = useHistory((h) => h.records);
  const progress = usePuzzle((p) => p.progress);
  const sum = useMemo(() => summarizeHistory(records, progress), [records, progress]);
  const recent = records.slice(0, 8);
  const trend = sum.accuracyTrend;
  return (
    <div data-testid="play-dashboard">
      <h3>Your progress</h3>
      {sum.games === 0 ? <p className="muted small-print">No games yet. Results, mistake categories and puzzle stats appear here after you play.</p> : (
        <>
          <table className="counts">
            <tbody>
              <tr><td>Games</td><td>{sum.games}</td></tr>
              <tr><td>Record</td><td>{sum.wins}W {sum.draws}D {sum.losses}L</td></tr>
              {sum.byLevel.map((l) => <tr key={l.level}><td>· {l.level}</td><td>{l.wins}W {l.draws}D {l.losses}L</td></tr>)}
              <tr><td>Puzzles solved</td><td>{sum.puzzles.solved} ({sum.puzzles.clean} clean) · streak {sum.puzzles.streak}</td></tr>
            </tbody>
          </table>
          {trend.length >= 2 && (
            <>
              <p className="muted small-print">Estimated accuracy of reviewed games ({trend.length}), oldest to newest. Not a rating.</p>
              <svg viewBox="0 0 300 50" className="rating-chart" role="img" aria-label="Accuracy trend">
                <path d={trend.map((t, i) => `${i === 0 ? 'M' : 'L'}${((i / (trend.length - 1)) * 296 + 2).toFixed(1)},${(48 - (t.accuracy / 100) * 46).toFixed(1)}`).join(' ')} className="g-line" fill="none" />
              </svg>
            </>
          )}
          {sum.topCategories.length > 0 && (
            <>
              <h3>Common mistake areas</h3>
              <ul className="plain-list">{sum.topCategories.slice(0, 4).map((c) => <li key={c.category}>{c.label}: {c.count}</li>)}</ul>
            </>
          )}
          <h3>Next goals</h3>
          <ul className="plain-list" data-testid="play-goals">{sum.goals.map((g) => <li key={g}>{g}</li>)}</ul>
          <h3>Recent games</h3>
          <ul className="moments">
            {recent.map((g) => (
              <li key={g.id}>
                <button className="moment" onClick={() => {
                  const parsed = parsePgn(g.pgn).games[0];
                  if (parsed === undefined) { notify('error', 'Could not read the saved game.'); return; }
                  confirmThen(Object.keys(gameStore.get().tree.nodes).length > 1, 'Loading replaces the game on the board.', 'Replace game', () => { loadGame(parsed.tree); setMobileTab('board'); });
                }}>
                  <span className={`pill res-${g.result}`}>{g.result}</span>
                  <span className="moment-move">{g.userColor === 'w' ? '⚪' : '⚫'} {g.levelLabel}</span>
                  <span className="muted">{g.reason}{g.opening ? ` · ${g.opening}` : ''}{g.review?.accuracy != null ? ` · ${g.review.accuracy.toFixed(0)}% acc.` : ''}</span>
                </button>
              </li>
            ))}
          </ul>
          <button className="btn small danger" onClick={() => confirmThen(true, 'Delete all saved play history?', 'Delete', clearHistory)}>Clear history</button>
        </>
      )}
    </div>
  );
}

type StartFrom = 'start' | 'board' | 'fen';

function Setup() {
  const s = usePlay((p) => p.settings);
  const spec = specFor(s.level, s.custom);
  const [startFrom, setStartFrom] = useState<StartFrom>('start');
  const [fenText, setFenText] = useState('');
  const [startError, setStartError] = useState<string | null>(null);
  const begin = () => {
    setStartError(null);
    let fen: string | undefined;
    if (startFrom === 'board') fen = currentFen(gameStore.get());
    else if (startFrom === 'fen') fen = fenText.trim();
    if (fen !== undefined) {
      const check = checkPlayablePosition(fen);
      if (!check.ok) { setStartError(check.error); return; }
    }
    if (startGame(Math.random, fen)) setMobileTab('board');
  };
  return (
    <>
      <div className="pl-title">Play Stockfish</div>
      <p className="muted small-print pl-sub">Play a full game against Stockfish. Your current game is kept and restored when you leave.</p>
      <ResumeBanner />
      <div className="rp-label pl-lab">Strength (approximate)</div>
      <div className="pz-pills" role="radiogroup" aria-label="Difficulty">
        {[...LEVELS, { id: 'custom' as LevelId, label: 'Custom', blurb: 'Choose Skill Level or Elo and thinking time.' }].map((l) => (
          <button key={l.id} role="radio" aria-checked={s.level === l.id} className={`level ${s.level === l.id ? 'on active' : ''}`} onClick={() => updatePlaySettings({ level: l.id })} data-testid={`level-${l.id}`} title={l.blurb}>
            {l.label}
          </button>
        ))}
      </div>
      {s.level === 'custom' && (
        <div className="pl-card">
          <div className="rp-label">Custom level</div>
          <label className="field"><span>Strength control</span>
            <select value={s.custom.mode} onChange={(e) => updatePlaySettings({ custom: { ...s.custom, mode: e.target.value as 'skill' | 'elo' } })} data-testid="custom-mode">
              <option value="skill">Skill Level (0–20)</option><option value="elo">UCI_Elo (1320–3190)</option>
            </select>
          </label>
          {s.custom.mode === 'skill'
            ? <label className="field"><span>Skill Level: {s.custom.skill}</span><input type="range" min={0} max={20} value={s.custom.skill} onChange={(e) => updatePlaySettings({ custom: { ...s.custom, skill: Number(e.target.value) } })} data-testid="custom-skill" /></label>
            : <label className="field"><span>UCI_Elo: {s.custom.elo}</span><input type="range" min={1320} max={3190} step={10} value={s.custom.elo} onChange={(e) => updatePlaySettings({ custom: { ...s.custom, elo: Number(e.target.value) } })} /></label>}
          <label className="field"><span>Time per move: {s.custom.movetimeMs} ms</span><input type="range" min={MIN_MOVETIME} max={MAX_MOVETIME} step={10} value={s.custom.movetimeMs} onChange={(e) => updatePlaySettings({ custom: { ...s.custom, movetimeMs: Number(e.target.value) } })} /></label>
        </div>
      )}
      <p className="ep-note">{spec.blurb} {STRENGTH_DISCLAIMER}</p>

      <div className="rp-label pl-lab">Colour</div>
      <div className="seg" role="radiogroup" aria-label="Colour">
        {(['w', 'random', 'b'] as const).map((c) => (
          <button key={c} role="radio" aria-checked={s.color === c} className={s.color === c ? 'on active' : ''} onClick={() => updatePlaySettings({ color: c })} data-testid={`color-${c}`}>
            {c === 'w' ? 'White' : c === 'b' ? 'Black' : 'Random'}
          </button>
        ))}
      </div>

      <div className="rp-label pl-lab">Clock</div>
      <div className="pz-pills" role="radiogroup" aria-label="Clock" data-testid="opt-tc">
        {TIME_CONTROL_IDS.map((id) => <button key={id} role="radio" aria-checked={s.timeControl === id} className={s.timeControl === id ? 'on' : ''} onClick={() => updatePlaySettings({ timeControl: id })} title={TIME_CONTROLS[id].label} data-testid={`tc-${id}`}>{id === 'none' ? 'No clock' : id}</button>)}
      </div>
      {s.timeControl !== 'none' && <p className="ep-note">{TIME_CONTROLS[s.timeControl].label}. Clocks start after both sides have moved once. If your time runs out you lose; if Stockfish's does, you win (a draw if the other side could not mate anyway). Stockfish also shortens its thinking when it is low on time.</p>}

      <div className="rp-label pl-lab">Start from</div>
      <div className="seg small" role="radiogroup" aria-label="Start position">
        {([['start', 'Standard start'], ['board', 'Board position'], ['fen', 'FEN']] as const).map(([k, label]) => (
          <button key={k} role="radio" aria-checked={startFrom === k} className={startFrom === k ? 'on active' : ''} onClick={() => { setStartFrom(k); setStartError(null); }} data-testid={`from-${k}`}>{label}</button>
        ))}
      </div>
      {startFrom === 'board' && <p className="ep-note">Plays on from the position currently shown on the board (your game is kept and restored when you leave).</p>}
      {startFrom === 'fen' && (
        <input className="pl-fen" value={fenText} onChange={(e) => { setFenText(e.target.value); setStartError(null); }} placeholder="Paste a FEN, e.g. a position you want to practise" aria-label="Start FEN" data-testid="from-fen-input" spellCheck={false} />
      )}
      {startError && <div className="callout error small" role="alert" data-testid="from-error">{startError}</div>}

      <div className="pl-card">
        <label className="pl-row"><span className="rp-t"><b>Practice mode</b><span className="muted small-print">Allow taking moves back.</span></span><input type="checkbox" className="switch" checked={s.practice} onChange={(e) => updatePlaySettings({ practice: e.target.checked })} data-testid="opt-practice" /></label>
      </div>
      <CoachingSettings />
      <div className="sticky-start"><button className="btn primary pl-start" onClick={begin} data-testid="play-start">Start game</button></div>
      <Dashboard />
    </>
  );
}

function LessonLinks({ category }: { category: CoachCategory }) {
  const [skills, setSkills] = useState<Skill[]>([]);
  useEffect(() => {
    let alive = true;
    loadLessons().then((s) => alive && setSkills(s)).catch(() => undefined);
    return () => { alive = false; };
  }, []);
  const links = RELATED_LESSONS[category].map((id) => skills.find((s) => s.id === id)).filter((s): s is Skill => s !== undefined);
  if (links.length === 0) return null;
  return (
    <p className="small-print" data-testid="coach-lessons">
      Related lessons:{' '}
      {links.map((s) => (
        <button key={s.id} className="linklike" onClick={() => openLesson(s.id)} data-testid={`coach-lesson-${s.id}`}>{s.title}</button>
      ))}
    </p>
  );
}

function ResumeBanner() {
  const saved = useSavedSession();
  if (saved === null) return null;
  return (
    <div className="resume-banner" data-testid="play-resume-banner">
      <span>Unfinished game vs Stockfish ({saved.plies} half-moves, you were {saved.userColor === 'w' ? 'White' : 'Black'}).</span>
      <div className="row">
        <button className="btn primary small" onClick={() => { if (resumeSavedGame()) setMobileTab('board'); }} data-testid="play-resume">Resume</button>
        <button className="btn small" onClick={discardSavedSession} data-testid="play-discard">Discard</button>
      </div>
    </div>
  );
}

// -------------------------------------------------------------------- playing

function FeedbackStrip({ fb }: { fb: MoveFeedback }) {
  const s = usePlay((p) => p.settings);
  const cls = fb.moveClass ?? 'good';
  return (
    <div className={`callout feedback cls-box-${cls}`} data-testid="play-feedback" role="status">
      <span className={`pill cls-${cls}`}>{fb.moveClass ?? 'not classified'}</span> {fb.text}
      <span className="muted small-print"> (Stockfish depth {fb.depth})</span>
      {fb.bestUci !== null && fb.moveClass !== 'best' && (
        <div className="row wrap">
          <button className="btn small" onClick={() => showAlternative(fb)}>Show better move on board</button>
          {s.practice && <button className="btn small" onClick={() => { takeBack(); }} data-testid="feedback-takeback">Take back and try again</button>}
        </div>
      )}
      {fb.bestLine !== '' && fb.bestUci !== null && <p className="muted small-print">Line: {fb.bestLine}</p>}
    </div>
  );
}

function HintBox() {
  const hint = usePlay((p) => p.hint);
  if (hint === null) return null;
  if (hint.busy) return <div className="callout small" data-testid="play-hint">Analysing the position…</div>;
  if (hint.error !== null) return <div className="callout error small">{hint.error}</div>;
  const c = hint.content;
  if (c === null) return null;
  return (
    <div className="callout hint" data-testid="play-hint">
      <div><strong>Hint 1:</strong> {c.level1}</div>
      {hint.level >= 2 && <div><strong>Hint 2:</strong> {c.level2}</div>}
      {hint.level >= 3 && (
        <div data-testid="hint-3">
          <strong>Hint 3:</strong> play <strong>{c.level3.san}</strong> ({c.level3.scoreText}, Stockfish depth {hint.depth}). {c.level3.purposeText} <span className="muted small-print">[{c.level3.purpose}; wording is rule-based]</span>
          <div className="muted small-print">Line: {c.level3.line}</div>
        </div>
      )}
    </div>
  );
}

function Playing() {
  const s = usePlay((p) => p);
  const tree = useGame((g) => g.tree);
  const plies = mainLine(tree).length - 1;
  const fb = visibleFeedback(s);
  const evalNow = s.tipId !== null && tree.nodes[s.tipId] ? s.evals[tree.nodes[s.tipId]!.fen] : undefined;
  return (
    <>
      <div className="row wrap"><span className="pill">{s.levelLabel}</span><span className="pill">You: {s.userColor === 'w' ? 'White' : 'Black'}</span>{s.settings.practice && <span className="pill">Practice</span>}</div>
      <p className="muted small-print">{s.strengthNote}</p>
      <div className={`callout ${s.error ? 'error' : ''}`} role="status" data-testid="play-status">
        {s.error ?? s.message ?? ' '}
        {s.error && <div className="row"><button className="btn small" onClick={retryEngineMove} data-testid="play-retry">Retry engine move</button></div>}
      </div>
      {s.settings.showEval && evalNow && <p className="muted small-print" data-testid="play-eval">Evaluation: <strong>{formatScore(evalNow.score)}</strong> (White's view, Stockfish depth {evalNow.depth}) — White's winning chances ≈ {whiteWinPercent(evalNow.score).toFixed(0)}%</p>}
      <div className="row wrap">
        {s.settings.hints && <button className="btn" disabled={s.thinking || s.error !== null} onClick={() => void requestHint()} data-testid="play-hint-btn">{s.hint && s.hint.content && s.hint.level < 3 ? `More hint (${s.hint.level}/3)` : s.hint?.level === 3 ? 'Hint shown' : 'Hint'}</button>}
        {s.settings.practice && <button className="btn" disabled={plies < 1 || (plies < 2 && s.userColor === 'b')} onClick={() => takeBack()} data-testid="play-takeback">Take back</button>}
        <button className="btn" disabled={s.thinking} onClick={() => void offerDraw()} data-testid="play-draw">Offer draw</button>
        <button className="btn danger" onClick={() => confirmThen(true, 'Resign this game?', 'Resign', resign)} data-testid="play-resign">Resign</button>
      </div>
      <HintBox />
      {fb && <FeedbackStrip fb={fb} />}
      <div className="row wrap">
        <button className="btn small" onClick={() => confirmThen(plies > 0, 'Restart? The current game will be lost.', 'Restart', () => startGame())} data-testid="play-restart">Restart</button>
        <button className="btn small" onClick={() => confirmThen(plies > 0, 'Leave the game? It will be lost.', 'Leave', exitPlay)} data-testid="play-exit">Exit to analysis</button>
      </div>
      <CoachingSettings />
    </>
  );
}

// ------------------------------------------------------------------- finished

function Finished() {
  const s = usePlay((p) => p);
  const result = useReview((r) => r.result);
  const progressPct = useReview((r) => r.progress);
  const status = useReview((r) => r.status);
  const puzzleProgress = usePuzzle((p) => p.progress);
  const puzzleOpen = usePuzzle((p) => p.phase !== 'off');
  const all = useAllPuzzles();
  const tree = useGame((g) => g.tree);
  const currentId = useGame((g) => g.currentId);
  const line = useMemo(() => mainLine(tree), [tree]);
  const [showSetup, setShowSetup] = useState(false);
  const report = s.report;
  const recs = useMemo(() => (report ? recommendPuzzles(report, all, puzzleProgress) : []), [report, all, puzzleProgress]);
  const summary = result?.summary;
  const me = s.userColor;
  const them = me === 'w' ? 'b' : 'w';
  const acc = (c: 'w' | 'b') => (summary?.accuracy[c] == null || Number.isNaN(summary.accuracy[c]) ? '–' : `${summary.accuracy[c]!.toFixed(0)}%`);

  return (
    <>
      <div className={`callout result-${s.result?.outcome}`} data-testid="play-result" role="status"><strong>{s.result?.text}</strong>{' '}<span className="muted small-print">{line.length - 1} half-moves · {s.levelLabel}</span></div>
      <div className="row wrap">
        <button className="btn primary" onClick={() => void analyzeGame()} disabled={s.review === 'running' || s.review === 'done' || puzzleOpen} data-testid="play-analyze">{s.review === 'running' ? `Analysing… ${progressPct.done}/${progressPct.total}` : s.review === 'done' ? 'Analysis complete' : 'Analyse game'}</button>
        <button className="btn" onClick={() => startGame()} data-testid="play-again">Rematch (same settings)</button>
        <button className={`btn ${showSetup ? 'active' : ''}`} onClick={() => setShowSetup((v) => !v)} aria-expanded={showSetup} data-testid="play-settings">{showSetup ? 'Hide settings' : 'New game…'}</button>
        <button className="btn small" onClick={exitPlay} disabled={puzzleOpen} data-testid="play-exit">Back to analysis</button>
      </div>
      {s.review === 'error' && <div className="callout error" role="alert">{s.reviewError}</div>}
      {showSetup && <div data-testid="finished-setup"><Setup /></div>}

      {!showSetup && s.review === 'done' && result && summary && report && (
        <div data-testid="play-report">
          <h3>Performance</h3>
          <PerfBox result={result} entries={[{ color: me, label: 'You', testId: 'perf-you' }, { color: them, label: 'Stockfish', testId: 'perf-sf' }]} />
          <table className="counts">
            <thead><tr><th></th><th>You</th><th>Stockfish</th></tr></thead>
            <tbody>
              <tr><td>Accuracy (estimate)</td><td data-testid="acc-you">{acc(me)}</td><td>{acc(them)}</td></tr>
              {(['brilliant', 'great', 'best', 'excellent', 'good', 'book', 'inaccuracy', 'mistake', 'miss', 'blunder'] as const)
                .filter((k) => summary.grades[me][k] + summary.grades[them][k] > 0)
                .map((k) => <tr key={k}><td>{GRADE_LABEL[k]}</td><td>{summary.grades[me][k]}</td><td>{summary.grades[them][k]}</td></tr>)}
            </tbody>
          </table>
          <p className="muted small-print">Accuracy is this app's own estimate from winning-chance loss (a model adapted from Lichess's published formula), not Chess.com's or Lichess's number. Review depth {result.depth}. The engine's numbers are affected by its handicap.</p>
          <EvalGraph values={result.whiteWinGraph} ids={line} currentPly={Math.max(0, line.indexOf(currentId))} />
          {report.headline.map((h) => <p key={h}>{h}</p>)}

          <h3>Key moments (your moves)</h3>
          {report.mistakes.length === 0 ? <p className="muted">No mistakes found.</p> : (
            <ul className="moments">
              {report.mistakes.slice(0, 6).map((m) => (
                <li key={m.move.nodeId} className="study">
                  <button className="moment" onClick={() => { const p = getNode(tree, m.move.nodeId).parentId; if (p) goTo(p); }} data-testid="key-moment">
                    <span className="moment-move">{m.move.moveNumber}{m.move.color === 'w' ? '.' : '...'} {m.move.san}</span>
                    <span className={`pill cls-${m.move.classification.grade ?? m.move.classification.moveClass}`}>{m.move.classification.grade ? GRADE_LABEL[m.move.classification.grade] : m.move.classification.moveClass}</span>
                    <span className="muted">{CATEGORY_LABEL[m.category]}{m.bestSan ? ` · better: ${m.bestSan}` : ''}</span>
                  </button>
                  <ul className="why-list" data-testid="key-moment-why">{explainBadMove(m.move).map((r, i) => <li key={i} data-kind={r.kind}>{r.text}</li>)}</ul>
                  {m.move.before.bestPv.length > 0 && <button className="btn small" onClick={() => { const p = getNode(tree, m.move.nodeId).parentId; if (p) { goTo(p); playLine(m.move.before.bestPv.slice(0, 6)); } }}>Play the recommended line</button>}
                </li>
              ))}
            </ul>
          )}

          <h3>Coach report</h3>
          <p className="muted small-print">Evaluations and moves come from Stockfish. Category labels and lessons are rule-based (no AI model is used), so they describe patterns rather than prove causes.</p>
          {report.examples.length === 0 && <p className="muted">Nothing to coach on from this game's mistakes.</p>}
          {report.examples.map((ex) => (
            <div className="coach-card" key={ex.category} data-testid="coach-card">
              <strong>{CATEGORY_LABEL[ex.category]}</strong> <span className="muted small-print">({report.counts[ex.category]} in this game)</span>
              <div className="row top">
                <MiniBoard fen={ex.move.fenBefore} size={132} flip={me === 'b'} highlight={[ex.move.uci.slice(0, 2), ex.move.uci.slice(2, 4)]} />
                <div>
                  <p>{ex.facts}</p>
                  {ex.bestLine && <p className="muted small-print">Recommended: {ex.bestLine}</p>}
                  <p><em>Lesson:</em> {ex.lesson}</p>
                  <LessonLinks category={ex.category} />
                </div>
              </div>
            </div>
          ))}
          {CATEGORY_ORDER.filter((c) => report.counts[c] === 0).length === CATEGORY_ORDER.length && null}
          {report.strengths.length > 0 && (
            <>
              <h3>What you did well</h3>
              <ul className="plain-list">{report.strengths.map((x) => <li key={x.move.nodeId}>{x.text}</li>)}</ul>
            </>
          )}

          <h3>Training from this game</h3>
          {recs.length === 0 ? <p className="muted small-print">No puzzle in the bundled set trains the specific patterns missed in this game, so none is recommended (an unrelated puzzle would not help).</p> : (
            <>
              <ul className="moments" data-testid="play-recs">
                {recs.map((r) => (
                  <li key={r.puzzle.id}><button className="moment" disabled={puzzleOpen} onClick={() => { startPuzzleSession([r.puzzle]); setRightTab('puzzles'); setMobileTab('board'); }}><span className="moment-move">{r.puzzle.id}</span><span className="muted">{r.reason}</span></button></li>
                ))}
              </ul>
              <button className="btn primary" disabled={puzzleOpen} onClick={() => { startPuzzleSession(recs.map((r) => r.puzzle)); setRightTab('puzzles'); setMobileTab('board'); }} data-testid="play-session">Start a {recs.length}-puzzle session</button>
            </>
          )}
        </div>
      )}
      {status === 'running' && s.review !== 'running' && <p className="muted small-print">Another review is running.</p>}
    </>
  );
}

export function PlayPanel() {
  const phase = usePlay((p) => p.phase);
  return (
    <section className="panel play-panel pl" aria-label="Play against Stockfish">
      {phase === 'off' ? <Setup /> : phase === 'playing' ? <Playing /> : <Finished />}
    </section>
  );
}
