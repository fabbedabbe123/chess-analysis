import { useEffect, useMemo, useState } from 'react';
import { loadLessons, MASTERY_LABEL, type Skill } from '@/lessons/lessons';
import { CATEGORY_LABEL } from '@/play/coach';
import {
  buildPlan, estimateStrength, focusAreas, MIN_MOVES_ESTIMATE, MIN_GAMES_FOCUS, MIN_GAMES_TREND, recentActualRating, recentGames, RECENT_GAMES,
  type AnalysedGame, type Trend,
} from '@/strength/strength';
import { analyseTrackedGames, cancelBatch, clearAnalysedGames, removeAnalysedGame, unanalysedTracked, useStrength } from '@/stores/strengthStore';
import { usePuzzle } from '@/stores/puzzleStore';
import { useTracker } from '@/stores/trackerStore';
import { confirmThen, openLesson, setMobileTab, setRightTab } from '@/stores/uiStore';
import { formatDate } from '@/utils/format';

const TREND_TEXT: Record<Trend, string> = { improving: '↘ improving', steady: '→ steady', worse: '↗ getting worse', unknown: '' };
const SOURCE_TEXT = { play: 'Play', chesscom: 'Chess.com', import: 'Imported' } as const;

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
      <div className="card" data-testid="strength-empty">
        <p>No analysed games yet. There are three ways to add some:</p>
        <ul className="plain-list">
          <li>Finish a game in <button className="linklike" onClick={() => setRightTab('play')}>Play</button> and press “Analyse game”.</li>
          <li>Run a review on any game (Review tab) and press “Count this game for my strength”.</li>
          <li>Track your Chess.com account in <button className="linklike" onClick={() => setRightTab('player')}>Player</button> and analyse your recent games below.</li>
        </ul>
      </div>
    );
  }
  const gap = actual === null ? null : est.rating - actual.rating;
  return (
    <div className="card strength-card" data-testid="strength-estimate">
      <div className="strength-range" data-testid="strength-range">{est.low}–{est.high}</div>
      <div className="row wrap">
        <span className="pill tag" data-testid="strength-confidence">{est.confidence} estimate</span>
        <span className="muted small-print">centre ≈ {est.rating} · {est.games} game{est.games === 1 ? '' : 's'} · {est.moves} moves · avg loss {est.acpl.toFixed(0)} cp</span>
      </div>
      {actual !== null && gap !== null && (
        <p className="small-print" data-testid="strength-compare">
          Your recent Chess.com rating: <strong>{actual.rating}</strong> ({actual.games} rated game{actual.games === 1 ? '' : 's'}).{' '}
          {Math.abs(gap) <= 150 ? 'The estimate is in the same range.' : gap > 0 ? 'The analysis suggests you play better than your rating in these games.' : 'The analysis suggests you play below your rating in these games.'}
        </p>
      )}
      <p className="muted small-print">
        This is an estimate of playing strength, not an Elo. It maps the average centipawn loss of your moves (Stockfish, book moves skipped) to a rating with a rule of thumb that was not calibrated here, so it depends on the analysis depth and on the kind of games. The range narrows as you add games; it uses your {RECENT_GAMES} most recent.
      </p>
    </div>
  );
}

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

function Batch() {
  const trackedUser = useTracker((s) => s.username);
  const trackedGames = useTracker((s) => s.games);
  const batch = useStrength((s) => s.batch);
  const games = useStrength((s) => s.games);
  const [count, setCount] = useState(5);
  const waiting = useMemo(() => unanalysedTracked().length, [games, trackedGames]); // eslint-disable-line react-hooks/exhaustive-deps
  const running = batch.status === 'running';
  if (trackedUser === null) {
    return <p className="muted small-print">Track a Chess.com account in the <button className="linklike" onClick={() => setRightTab('player')}>Player</button> tab to analyse your recent games here.</p>;
  }
  return (
    <div className="card" data-testid="batch">
      <div className="row wrap">
        <span>Analyse my recent Chess.com games</span>
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

export function StrengthPanel() {
  const games = useStrength((s) => s.games);
  const saveFailed = useStrength((s) => s.saveFailed);
  return (
    <section className="panel strength-panel" aria-label="Strength estimate and training plan">
      <header className="panel-head"><h2>Strength</h2></header>
      {saveFailed && <div className="callout warn">These results could not be saved in this browser (storage full or blocked). They stay until you reload.</div>}
      <Estimate games={games} />
      <Focus games={games} />
      <h3>Add games</h3>
      <Batch />
      <GameList games={games} />
      <p className="small-print"><button className="linklike" onClick={() => { setRightTab('review'); setMobileTab('review'); }}>Open the Review tab</button></p>
    </section>
  );
}
