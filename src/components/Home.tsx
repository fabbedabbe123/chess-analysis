import { useEffect, useMemo, useRef, useState } from 'react';
import { duePuzzles, loadPuzzles, type Puzzle } from '@/puzzles/puzzles';
import { averageAccuracy, estimateStrength, focusAreas, MIN_GAMES_RATING, ratingEstimate } from '@/strength/strength';
import { mainLine } from '@/chess/gameTree';
import { useGame } from '@/stores/gameStore';
import { usePlay, useSavedSession } from '@/stores/playStore';
import { usePuzzle } from '@/stores/puzzleStore';
import { useStrength } from '@/stores/strengthStore';
import { openDialog, setMobileTab, setRightTab, type RightTab } from '@/stores/uiStore';
import { enterApp } from '@/stores/viewStore';
import { AccountButton, SignInBanner } from './AccountSection';

/** Scroll reveal: sets --p (0..1) on [data-sa] children as they scroll into view. No IntersectionObserver or reduced motion = everything visible. */
function useScrollReveal() {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root || typeof IntersectionObserver === 'undefined' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    root.classList.add('js-sa');
    const thresholds = Array.from({ length: 21 }, (_, i) => i / 20);
    const seen = new WeakMap<Element, number>();
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const el = e.target as HTMLElement;
        const p = Math.max(seen.get(el) ?? 0, Math.min(1, e.intersectionRatio / 0.6));
        seen.set(el, p);
        el.style.setProperty('--p', p.toFixed(3));
      }
    }, { threshold: thresholds });
    root.querySelectorAll('[data-sa]').forEach((el) => io.observe(el));
    return () => { io.disconnect(); root.classList.remove('js-sa'); };
  }, []);
  return ref;
}

const go = (tab: RightTab) => { setRightTab(tab); setMobileTab(tab); enterApp(); };

/** The start page: three clear ways in, and what to pick up. Shown when there is nothing to continue. */
export function Home() {
  const tree = useGame((g) => g.tree);
  const plies = mainLine(tree).length - 1;
  const saved = useSavedSession();
  const playPhase = usePlay((p) => p.phase);
  const games = useStrength((s) => s.games);
  const progress = usePuzzle((p) => p.progress);
  const [puzzles, setPuzzles] = useState<Puzzle[]>([]);
  useEffect(() => {
    let alive = true;
    loadPuzzles().then((p) => alive && setPuzzles(p)).catch(() => undefined);
    return () => { alive = false; };
  }, []);
  const est = useMemo(() => estimateStrength(games), [games]);
  const rated = useMemo(() => ratingEstimate(games), [games]);
  const accuracy = useMemo(() => averageAccuracy(games), [games]);
  const focus = useMemo(() => focusAreas(games), [games]);
  const due = useMemo(() => duePuzzles(puzzles, progress, Date.now()).length, [puzzles, progress]);
  const players = `${tree.headers['White'] ?? ''}${tree.headers['White'] && tree.headers['Black'] ? ' – ' : ''}${tree.headers['Black'] ?? ''}`.trim();
  const rootRef = useScrollReveal();
  const hasContinue = plies > 0 || saved !== null || playPhase !== 'off';

  return (
    <main className="home" data-testid="home" ref={rootRef}>
      <div className="home-top"><AccountButton variant="top" /></div>
      <div className="home-inner">
        <div className="home-brand">
          <span className="logo" aria-hidden>♞</span>
          <h1>Chess Analysis</h1>
          <p>Understand your games, see where you lose points, and train what matters. Stockfish runs in your browser, and your data stays there.</p>
        </div>

        <div className="home-cards">
          <button className="home-card" onClick={() => { enterApp(); openDialog('import'); }} data-testid="home-analyse">
            <span className="home-icon" aria-hidden>⌕</span>
            <strong>Analyse a game</strong>
            <span>Paste a PGN or a Lichess link. Every move gets a grade, and the mistakes are explained.</span>
          </button>
          <button className="home-card" onClick={() => go('player')} data-testid="home-games">
            <span className="home-icon" aria-hidden>♟</span>
            <strong>My games</strong>
            <span>Type your Chess.com or Lichess username to see your results, openings and playing level.</span>
          </button>
          <button className="home-card" onClick={() => go('play')} data-testid="home-play">
            <span className="home-icon" aria-hidden>⚔</span>
            <strong>Play Stockfish</strong>
            <span>Pick a level and a clock, get hints and feedback, and review the game afterwards.</span>
          </button>
        </div>

        <SignInBanner />

        {(hasContinue || est !== null || due > 0) && (
          <section className="home-continue" aria-label="Your progress">
            <h2>{hasContinue ? 'Pick up where you left off' : 'Your progress'}</h2>
            <div className="home-rows">
              {saved !== null && (
                <button className="home-row" onClick={() => go('play')} data-testid="home-resume-play">
                  <strong>Unfinished game vs Stockfish</strong>
                  <span>{saved.plies} half-moves · you were {saved.userColor === 'w' ? 'White' : 'Black'}</span>
                </button>
              )}
              {plies > 0 && (
                <button className="home-row" onClick={enterApp} data-testid="home-continue-game">
                  <strong>The game on the board</strong>
                  <span>{players !== '' ? `${players} · ` : ''}{plies} half-moves</span>
                </button>
              )}
              {est !== null && (
                <button className="home-row" onClick={() => go('strength')} data-testid="home-strength">
                  <strong>{rated !== null ? `Your estimated level: ${rated.low}–${rated.high}` : accuracy !== null ? `Your accuracy: ${accuracy.toFixed(0)}%` : 'Your strength so far'}</strong>
                  <span>{focus.areas[0] ? `Biggest weakness: ${focus.areas[0].label}` : rated !== null ? `${est.games} analysed games` : `${est.games} of ${MIN_GAMES_RATING} games analysed for a rating range`}</span>
                </button>
              )}
              {due > 0 && (
                <button className="home-row" onClick={() => go('puzzles')} data-testid="home-due">
                  <strong>{due} puzzle{due === 1 ? '' : 's'} due for review</strong>
                  <span>Short repetition keeps patterns in memory.</span>
                </button>
              )}
            </div>
          </section>
        )}


        <section className="hs" aria-label="Analyse">
          <div className="hs-text" data-sa><span className="hs-kicker">Analyse</span><h2>See exactly where the game turned.</h2><p>Every move gets a grade, with the best alternative and a plain explanation of the mistake.</p></div>
          <div className="hs-vis" data-sa aria-hidden="true">
            <div className="hs-row" data-sa><i style={{ background: '#96bc4b' }} /><span>1. e4</span><span>Best</span></div>
            <div className="hs-row" data-sa><i style={{ background: '#e6b83a' }} /><span>12. Bd3</span><span>Inaccuracy</span></div>
            <div className="hs-row" data-sa><i style={{ background: '#d6453d' }} /><span>14... Qd7</span><span>Blunder</span></div>
          </div>
        </section>
        <section className="hs flip" aria-label="Play">
          <div className="hs-text" data-sa><span className="hs-kicker">Play</span><h2>Practise against Stockfish.</h2><p>Six levels, optional clock, hints and feedback as you go, and a full review afterwards.</p></div>
          <div className="hs-vis" data-sa aria-hidden="true">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              {['Beginner', 'Easy', 'Intermediate', 'Advanced', 'Expert', 'Maximum'].map((l) => <span key={l} className={`hs-pill${l === 'Intermediate' ? ' on' : ''}`}>{l}</span>)}
            </div>
          </div>
        </section>
        <section className="hs" aria-label="Train">
          <div className="hs-text" data-sa><span className="hs-kicker">Train</span><h2>Puzzles from your own mistakes.</h2><p>Spaced repetition keeps patterns in memory, and you can make and share your own puzzles.</p></div>
          <div className="hs-vis" data-sa aria-hidden="true">
            <div className="hs-row" data-sa><span>Fork</span><span>13 / 20</span></div>
            <div className="hs-row" data-sa><span>Pin</span><span>5 / 20</span></div>
            <div className="hs-row" data-sa><span>Back rank</span><span>11 / 20</span></div>
          </div>
        </section>
        <section className="hs flip" aria-label="Your level">
          <div className="hs-text" data-sa><span className="hs-kicker">Your level</span><h2>An honest picture of your strength.</h2><p>A rough range from your analysed games. It is a guide, not an Elo, and it says so.</p></div>
          <div className="hs-vis" data-sa aria-hidden="true"><div className="hs-big">850–1750</div><div className="hs-range"><b /></div><span className="muted small-print">Example. Roughly ±450 points.</span></div>
        </section>

        <p className="home-foot">
          <button className="linklike" onClick={() => { enterApp(); openDialog('help'); }}>Help &amp; tips</button>
          <span aria-hidden> · </span>
          <button className="linklike" onClick={enterApp} data-testid="home-skip">Go straight to the board</button>
        </p>
      </div>
    </main>
  );
}
