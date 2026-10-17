import { useEffect, useMemo, useState } from 'react';
import { loadLessons, MASTERY_LABEL, type Skill } from '@/lessons/lessons';
import { CATEGORY_LABEL } from '@/play/coach';
import {
  averageAccuracy, buildPlan, estimateStrength, MIN_GAMES_RATING, ratingEstimate, focusAreas, openMistakeCount, progressSeries, trainingPuzzles, MIN_MOVES_ESTIMATE, MIN_GAMES_FOCUS, MIN_GAMES_TREND, recentActualRating, recentGames, RECENT_GAMES,
  type AnalysedGame, type Trend,
} from '@/strength/strength';
import { analyseTrackedGames, cancelBatch, clearAnalysedBySource, clearAnalysedGames, removeAnalysedGame, unanalysedTracked, useStrength } from '@/stores/strengthStore';
import { startPuzzleSession, usePuzzle } from '@/stores/puzzleStore';
import { clearLichess, useLichess } from '@/stores/lichessStore';
import { clearTracker, useTracker } from '@/stores/trackerStore';
import { confirmThen, openLesson, setMobileTab, setRightTab } from '@/stores/uiStore';
import { formatDate } from '@/utils/format';

const TREND_TEXT: Record<Trend, string> = { improving: '↘ improving', steady: '→ steady', worse: '↗ getting worse', unknown: '' };
const SOURCE_TEXT = { play: 'Play', chesscom: 'Chess.com', lichess: 'Lichess', import: 'Imported' } as const;

function Estimate({ games }: { games: AnalysedGame[] }) {
  const est = useMemo(() => estimateStrength(games), [games]);
  const actual = useMemo(() => recentActualRating(games), [games]);
  if (est === null && games.length > 0) {
    const counted = games.reduce((n, g) => n + g.moves, 0);
    return (
      <div className="card" data-testid="strength-too-short">
        <p>Not enough moves to estimate anything yet: {counted} counted, at least {MIN_MOVES_ESTIMATE} needed. Opening-book moves are skipped, so short games count for little. Add a longer game.</p>
      </div>
    );
  }
  if (est === null) {
    return (
      <div className="card sp-empty" data-testid="strength-empty">
        <div className="sp-ei" aria-hidden><svg className="ic" viewBox="0 0 24 24"><path d="M4 18a8 8 0 1116 0M12 18l4-6" /></svg></div>
        <p><b>No analysed games yet.</b> Your level shows after {MIN_GAMES_RATING} games. There are three ways to add some:</p>
        <ol className="pp-steps">
          <li><b>Play Stockfish</b><span>Finish a game in <button className="linklike" onClick={() => setRightTab('play')}>Play</button> and press “Analyse game”.</span></li>
          <li><b>Review any game</b><span>Run a review on any game (Review tab) and press “Count this game for my strength”.</span></li>
          <li><b>Track your account</b><span>Track your Chess.com or Lichess account in <button className="linklike" onClick={() => setRightTab('player')}>Player</button> and analyse your recent games below.</span></li>
        </ol>
      </div>
    );
  }
  if (ratingEstimate(games) === null) {
    const acc = averageAccuracy(games);
    return (
      <div className="card strength-card" data-testid="strength-accuracy">
        <div className="strength-range" data-testid="strength-accuracy-value">{acc === null ? `${est.acpl.toFixed(0)} cp` : `${acc.toFixed(0)}%`}</div>
        <div className="row wrap">
          <span className="pill tag">{acc === null ? 'average loss per move' : 'average accuracy'}</span>
          <span className="muted small-print">{est.games} of {MIN_GAMES_RATING} games · {est.moves} moves · avg loss {est.acpl.toFixed(0)} cp</span>
        </div>
        <progress value={Math.min(est.games, MIN_GAMES_RATING)} max={MIN_GAMES_RATING} aria-label="Games analysed towards a rating range" />
        <p className="muted small-print">
          A rating range is shown after {MIN_GAMES_RATING} analysed games. One or two games say too little: the estimate swings a lot with the opponent and the positions. Until then you get your accuracy, which is measured directly. {MIN_GAMES_RATING - est.games} more to go.
        </p>
      </div>
    );
  }
  const gap = actual === null ? null : est.rating - actual.rating;
  return (
    <div className="card strength-card" data-testid="strength-estimate">
      <div className="rp-label">Estimated level</div>
      <div className="strength-range" data-testid="strength-range">{est.low}–{est.high}</div>
      <div className="sp-track" aria-hidden>
        <b style={{ left: `${pos(est.low)}%`, width: `${pos(est.high) - pos(est.low)}%` }} />
        <i style={{ left: `${pos(est.rating)}%` }} />
      </div>
      <div className="sp-ticks" aria-hidden><span>400</span><span>1200</span><span>2000</span><span>2800</span></div>
      <div className="row wrap">
        <span className="pill tag" data-testid="strength-confidence">{est.confidence} estimate</span>
        <span className="muted small-print">centre ≈ {est.rating} · {est.games} game{est.games === 1 ? '' : 's'} · {est.moves} moves · avg loss {est.acpl.toFixed(0)} cp</span>
      </div>
      {actual !== null && gap !== null && (
        <p className="small-print" data-testid="strength-compare">
          Your recent rating in these games: <strong>{actual.rating}</strong> ({actual.games} rated game{actual.games === 1 ? '' : 's'}).{' '}
          {Math.abs(gap) <= 150 ? 'The estimate is in the same range.' : gap > 0 ? 'The analysis suggests you play better than your rating in these games.' : 'The analysis suggests you play below your rating in these games.'}
        </p>
      )}
      <p className="small-print" data-testid="strength-bias-note">
        {est.rating < 1000
          ? 'Heads up: in this range the estimate tends to run too high (by up to about 300 points in our tests), so your real level may be lower.'
          : est.rating > 1600
            ? 'Heads up: in this range the estimate tends to run too low (by roughly 150-300 points in our tests), so your real level may be higher.'
            : 'In this range the estimate is typically within about 200-300 points.'}
      </p>
      <p className="muted small-print">
        This is an estimate of playing strength, not an Elo. It maps the average centipawn loss of your moves (Stockfish, book moves skipped) to a rating with a formula fitted on public Chess.com games (analysis depth 14). It is a coarse guide, best at about 1000-1600, and it depends on the analysis depth and the kind of games. The range narrows only slowly as you add games; it uses your {RECENT_GAMES} most recent.
      </p>
    </div>
  );
}

/** Position on a 400-2800 scale, in percent. */
const pos = (r: number) => Math.max(0, Math.min(100, ((r - 400) / 2400) * 100));

function Focus({ games }: { games: AnalysedGame[] }) {
  const [skills, setSkills] = useState<Skill[]>([]);
  const progress = usePuzzle((s) => s.progress);
  useEffect(() => {
    let alive = true;
    loadLessons().then((s) => alive && setSkills(s)).catch(() => undefined);
    return () => { alive = false; };
  }, []);
  const focus = useMemo(() => focusAreas(games), [games]);
  const plan = useMemo(() => buildPlan(focus.areas, skills, progress), [focus.areas, skills, progress]);

  if (!focus.enough) {
    return <p className="muted small-print" data-testid="focus-too-few">Focus areas need at least {MIN_GAMES_FOCUS} analysed games (you have {games.length}). One game is too little to tell a pattern from bad luck.</p>;
  }
  if (focus.ranked.length === 0) return <p className="muted small-print">No categorised mistakes in these games. Nothing to focus on.</p>;
  return (
    <>
      <h3>Focus areas</h3>
      <ul className="focus-list" data-testid="focus-list">
        {focus.ranked.slice(0, 4).map((a) => (
          <li key={a.category} className={focus.areas.some((x) => x.category === a.category) ? 'is-focus' : ''}>
            <div className="focus-top">
              <strong>{a.label}</strong>
              <span className="muted small-print">{TREND_TEXT[a.trend]}</span>
            </div>
            <div className="bar"><div style={{ width: `${Math.round(a.share * 100)}%` }} /></div>
            <span className="muted small-print">{Math.round(a.share * 100)}% of the points you lose · {a.mistakes} mistake{a.mistakes === 1 ? '' : 's'} · {a.lossPerGame.toFixed(0)} pts per game</span>
          </li>
        ))}
      </ul>
      {games.length < MIN_GAMES_TREND && <p className="muted small-print">Trends appear after {MIN_GAMES_TREND} analysed games.</p>}
      <p className="muted small-print">Categories are rule-based patterns from the coach, not proven causes. The two highlighted areas lose you the most.</p>

      <h3>Training plan</h3>
      {plan.length === 0 || plan.every((p) => p.lessons.length === 0) ? (
        <p className="muted small-print">No unfinished lesson matches your focus areas. Play and analyse more games to keep the picture current.</p>
      ) : (
        <ol className="plan" data-testid="plan">
          {plan.map((item) => (
            <li key={item.area.category}>
              <strong>{CATEGORY_LABEL[item.area.category]}</strong>
              {item.lessons.length === 0 ? <span className="muted small-print"> – all related lessons mastered</span> : (
                <ul className="plain-list">
                  {item.lessons.map((l) => (
                    <li key={l.skillId} className="row wrap">
                      <button className="btn small" onClick={() => openLesson(l.skillId)} data-testid={`plan-lesson-${l.skillId}`}>{l.title}</button>
                      <span className="muted small-print">{MASTERY_LABEL[l.mastery]} · {l.solved}/{l.total}</span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
          <li><strong>Then play and analyse 3 more games</strong> <span className="muted small-print">– the trend above shows whether the focus areas improved.</span></li>
        </ol>
      )}
    </>
  );
}

function ProgressChart({ games }: { games: AnalysedGame[] }) {
  const enough = games.length >= MIN_GAMES_RATING;
  const series = useMemo(() => progressSeries(games).filter((p) => p.rating !== null), [games]);
  if (!enough || series.length < 4) return null;
  const w = 360, h = 90;
  const vals = series.map((p) => p.rating as number);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const span = Math.max(1, hi - lo);
  const d = vals.map((v, i) => `${i === 0 ? 'M' : 'L'}${((i / (vals.length - 1)) * w).toFixed(1)},${(h - 6 - ((v - lo) / span) * (h - 12)).toFixed(1)}`).join(' ');
  return (
    <div data-testid="strength-progress">
      <h3>Progress</h3>
      <svg className="rating-chart" viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`Rolling strength estimate from ${vals[0]} to ${vals[vals.length - 1]} over ${series.length} games`}>
        <path d={d} className="g-line" fill="none" />
        <text x="2" y="10" className="chart-label">{Math.round(hi)}</text>
        <text x="2" y={h - 2} className="chart-label">{Math.round(lo)}</text>
      </svg>
      <p className="muted small-print">Centre of the estimate over a rolling window of 5 games, {series.length} points. It moves with the opponents and positions you got, so look at the direction over many games, not single steps. Same uncalibrated rule as above.</p>
    </div>
  );
}

function TrainMistakes({ games }: { games: AnalysedGame[] }) {
  const progress = usePuzzle((s) => s.progress);
  const open = useMemo(() => openMistakeCount(games, progress), [games, progress]);
  const puzzles = useMemo(() => trainingPuzzles(games, progress), [games, progress]);
  if (games.length === 0) return null;
  if (games.every((g) => g.mistakes.length === 0)) {
    return <p className="muted small-print" data-testid="train-none">Your own mistakes become practice puzzles once a game is analysed (games analysed before this feature have none saved).</p>;
  }
  return (
    <div className="card" data-testid="train-mistakes">
      <div className="row wrap">
        <strong>Train my mistakes</strong>
        <span className="spacer" />
        <button className="btn small primary" disabled={puzzles.length === 0} onClick={() => { startPuzzleSession(puzzles); setRightTab('puzzles'); setMobileTab('board'); }} data-testid="train-start">
          {puzzles.length === 0 ? 'All done' : `Start ${puzzles.length}`}
        </button>
      </div>
      <p className="muted small-print">{open} of your worst moves from the recent games are still open. Each puzzle is the position before your mistake; find the move Stockfish preferred. Focus-area mistakes come first, then the biggest losses.</p>
    </div>
  );
}

function Batch() {
  const trackedUser = useTracker((s) => s.username);
  const trackedGames = useTracker((s) => s.games);
  const lichessUser = useLichess((s) => s.username);
  const lichessGames = useLichess((s) => s.games);
  const batch = useStrength((s) => s.batch);
  const games = useStrength((s) => s.games);
  const [count, setCount] = useState(5);
  const waiting = useMemo(() => unanalysedTracked().length, [games, trackedGames, lichessGames]); // eslint-disable-line react-hooks/exhaustive-deps
  const running = batch.status === 'running';
  if (trackedUser === null && lichessUser === null) {
    return <p className="muted small-print">Track a Chess.com or Lichess account in the <button className="linklike" onClick={() => setRightTab('player')}>Player</button> tab to analyse your recent games here.</p>;
  }
  return (
    <div className="card" data-testid="batch">
      <div className="row wrap">
        <span>Analyse my recent tracked games</span>
        <span className="spacer" />
        <label className="inline">
          Games
          <select value={count} disabled={running} onChange={(e) => setCount(Number(e.target.value))} aria-label="Number of games to analyse" data-testid="batch-count">
            {[3, 5, 10, 20].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        {running ? (
          <button className="btn small" onClick={cancelBatch} data-testid="batch-cancel">Stop</button>
        ) : (
          <button className="btn small primary" onClick={() => void analyseTrackedGames(count)} disabled={waiting === 0} data-testid="batch-start">Analyse</button>
        )}
      </div>
      <p className="muted small-print">{waiting} tracked game{waiting === 1 ? '' : 's'} not analysed yet. A game takes about a minute (real Stockfish in your browser, depth ≤ 14). Each finished game is saved, so stopping keeps the results.</p>
      {running && (
        <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={batch.total} aria-valuenow={batch.done}>
          <div style={{ width: `${batch.total ? ((batch.done + (batch.currentPlies ? batch.currentPly / batch.currentPlies : 0)) / batch.total) * 100 : 0}%` }} />
          <span>Game {Math.min(batch.done + 1, batch.total)} / {batch.total}</span>
        </div>
      )}
      {batch.error !== null && <div className="callout error" role="alert">{batch.error}</div>}
      {batch.note !== null && !running && <p className="small-print" data-testid="batch-note">{batch.note}</p>}
    </div>
  );
}

function GameList({ games }: { games: AnalysedGame[] }) {
  const shown = recentGames(games);
  if (games.length === 0) return null;
  return (
    <details className="card-details">
      <summary>Analysed games ({games.length})</summary>
      <ul className="strength-games" data-testid="strength-games">
        {games.slice(0, 40).map((g) => (
          <li key={g.id} className={shown.includes(g) ? '' : 'older'}>
            <div className="sg-main">
              <span>{g.label || 'Game'}</span>
              <span className="muted small-print">{SOURCE_TEXT[g.source]} · {formatDate(g.endedAt)} · as {g.userColor === 'w' ? 'White' : 'Black'}</span>
            </div>
            <span className="sg-num" title="Average centipawn loss">{g.acpl.toFixed(0)} cp</span>
            <button className="btn small" onClick={() => removeAnalysedGame(g.id)} aria-label={`Remove ${g.label || 'game'}`}>✕</button>
          </li>
        ))}
      </ul>
      <p className="muted small-print">Games beyond the newest {RECENT_GAMES} are kept but not used for the estimate.</p>
      <button className="btn small danger" onClick={() => confirmThen(true, 'Remove all analysed games from this browser? Your estimate and focus areas start over.', 'Remove all', clearAnalysedGames)} data-testid="strength-clear">Remove all</button>
    </details>
  );
}

function ResetTracking({ games }: { games: AnalysedGame[] }) {
  const ccUser = useTracker((s) => s.username);
  const liUser = useLichess((s) => s.username);
  const count = (src: AnalysedGame['source']) => games.filter((g) => g.source === src).length;
  const rows: { src: 'chesscom' | 'lichess'; name: string; user: string | null; stop: () => void }[] = [
    { src: 'chesscom', name: 'Chess.com', user: ccUser, stop: clearTracker },
    { src: 'lichess', name: 'Lichess', user: liUser, stop: clearLichess },
  ];
  const shown = rows.filter((r) => r.user !== null || count(r.src) > 0);
  if (shown.length === 0 && games.length === 0) return null;
  return (
    <div className="card" data-testid="strength-reset">
      <strong>Switch account or start over</strong>
      <p className="muted small-print">Removes what was collected for an account, so you can track another one or look at other games. Only data in this browser is removed; your accounts are untouched.</p>
      {shown.map((r) => (
        <div className="row wrap" key={r.src}>
          <span>{r.name}{r.user ? ` · ${r.user}` : ''} · {count(r.src)} analysed</span>
          <span className="spacer" />
          <button className="btn small danger" data-testid={`reset-${r.src}`}
            onClick={() => confirmThen(true, `Stop tracking ${r.name}${r.user ? ` (${r.user})` : ''} and remove its ${count(r.src)} analysed game${count(r.src) === 1 ? '' : 's'}? The estimate and focus areas are recalculated without them.`, 'Remove', () => { r.stop(); clearAnalysedBySource(r.src); })}>
            Reset {r.name}
          </button>
        </div>
      ))}
      {games.length > 0 && (
        <div className="row"><button className="btn small danger" data-testid="reset-all"
          onClick={() => confirmThen(true, 'Remove all analysed games (Play, imported and tracked accounts) from this browser? The estimate and focus areas start over.', 'Remove all', clearAnalysedGames)}>Remove all analysed games</button></div>
      )}
    </div>
  );
}

export function StrengthPanel() {
  const games = useStrength((s) => s.games);
  const saveFailed = useStrength((s) => s.saveFailed);
  return (
    <section className="panel strength-panel sp" aria-label="Strength estimate and training plan">
      {saveFailed && <div className="callout warn">These results could not be saved in this browser (storage full or blocked). They stay until you reload.</div>}
      <Estimate games={games} />
      <ProgressChart games={games} />
      <Focus games={games} />
      <TrainMistakes games={games} />
      <h3>Add games</h3>
      <Batch />
      <GameList games={games} />
      <ResetTracking games={games} />
      <p className="small-print"><button className="linklike" onClick={() => { setRightTab('review'); setMobileTab('review'); }}>Open the Review tab</button></p>
    </section>
  );
}
