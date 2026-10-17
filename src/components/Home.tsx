import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import { duePuzzles, loadPuzzles, type Puzzle } from '@/puzzles/puzzles';
import { averageAccuracy, estimateStrength, focusAreas, MIN_GAMES_RATING, ratingEstimate } from '@/strength/strength';
import { mainLine } from '@/chess/gameTree';
import { useGame } from '@/stores/gameStore';
import { usePlay, useSavedSession } from '@/stores/playStore';
import { usePuzzle } from '@/stores/puzzleStore';
import { useSettings } from '@/stores/settingsStore';
import { useStrength } from '@/stores/strengthStore';
import { useSync } from '@/sync/syncStore';
import { openDialog, setMobileTab, setRightTab, type RightTab } from '@/stores/uiStore';
import { enterApp } from '@/stores/viewStore';
import { BOARD_COLORS } from '@/utils/boardStyle';
import { AccountButton, SignInBanner } from './AccountSection';

const go = (tab: RightTab) => { setRightTab(tab); setMobileTab(tab); enterApp(); };
const analyse = () => { enterApp(); openDialog('import'); };

/**
 * Scroll motion: each [data-sa] element gets --p (0..1), the largest share of it seen in view so far.
 * CSS turns --p into fades, slides, a drawn arrow, a filling ring and so on. Without IntersectionObserver,
 * or with reduced motion, --p stays unset and everything is simply shown.
 */
function useScrollReveal() {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root || typeof IntersectionObserver === 'undefined' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const els = Array.from(root.querySelectorAll<HTMLElement>('[data-sa]'));
    const seen = new WeakMap<Element, number>();
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const h = e.boundingClientRect.height || 1;
        const vh = e.rootBounds?.height || window.innerHeight || h;
        const cap = Math.min(1, vh / h); // tall elements never reach ratio 1
        const p = Math.max(seen.get(e.target) ?? 0, Math.min(1, e.intersectionRatio / Math.max(cap, 0.01)));
        seen.set(e.target, p);
        (e.target as HTMLElement).style.setProperty('--p', p.toFixed(3));
      }
    }, { threshold: Array.from({ length: 41 }, (_, i) => i / 40) });
    for (const el of els) { el.style.setProperty('--p', '0'); io.observe(el); }
    return () => { io.disconnect(); for (const el of els) el.style.removeProperty('--p'); };
  }, []);
  return ref;
}

const BACK = ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'];
type Sq = { key: string; x: number; y: number; img: string; cls?: string; delay?: number };
function startPieces(base: string, set: string, afterE4E5: boolean, hero: boolean): Sq[] {
  const out: Sq[] = [];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      let p: string | null = null;
      let col = '';
      if (r === 0) { p = BACK[c]!; col = 'b'; } else if (r === 1) { p = 'p'; col = 'b'; } else if (r === 6) { p = 'p'; col = 'w'; } else if (r === 7) { p = BACK[c]!; col = 'w'; }
      if (afterE4E5) {
        if ((r === 6 || r === 1) && c === 4) p = null;
        if (r === 4 && c === 4) { p = 'p'; col = 'w'; }
        if (r === 3 && c === 4) { p = 'p'; col = 'b'; }
      }
      if (p === null) continue;
      out.push({
        key: `${r}${c}`, x: c * 12.5, y: r * 12.5, img: `${base}pieces/${set}/${col}${p.toUpperCase()}.svg`,
        cls: afterE4E5 && r === 7 && c === 6 ? 'hp-hop' : undefined,
        delay: hero ? 0.15 + (7 - r) * 0.05 + c * 0.04 : undefined,
      });
    }
  }
  return out;
}

function Board({ pieces, light, dark, className, children }: { pieces: Sq[]; light: string; dark: string; className?: string; children?: ReactNode }) {
  return (
    <div className={`hp-board ${className ?? ''}`} style={{ backgroundColor: light, backgroundImage: `conic-gradient(${dark} 25%, transparent 0 50%, ${dark} 0 75%, transparent 0)` }}>
      {pieces.map((p) => (
        <div
          key={p.key}
          className={`hp-piece ${p.cls ?? ''} ${p.delay !== undefined ? 'hp-drop' : ''}`}
          style={{ left: `${p.x}%`, top: `${p.y}%`, backgroundImage: `url('${p.img}')`, ...(p.delay !== undefined ? ({ '--d': `${p.delay.toFixed(2)}s` } as CSSProperties) : {}) }}
        />
      ))}
      {children}
    </div>
  );
}

const FRIENDS: { i: string; n: string; a: string; c: string; on: boolean; bob: string }[] = [
  { i: 'A', n: 'anna', a: 'Solving puzzles', c: '#81b64c', on: true, bob: 'hp-bob' },
  { i: 'L', n: 'leo', a: 'Analysing a game', c: '#8fb5e8', on: true, bob: 'hp-bob2' },
  { i: 'M', n: 'maja', a: 'Last seen 2 h ago', c: '#e6b46a', on: false, bob: 'hp-bob' },
];
const SAMPLE_MOVES: [string, string, string, string][] = [
  ['1. e4', 'Opening', '#96bc4b', 'Best'],
  ['1… e5', 'Opening', '#96bc4b', 'Best'],
  ['2. Nf3', 'Develops', '#96bc4b', 'Best'],
  ['2… h6', 'Slow', '#e6b83a', 'Inaccuracy'],
  ['3. Nxe5', 'Wins a pawn', '#96bc4b', 'Good'],
];

/** The start page: a scrolling tour of the features, with the ways in and what to pick up at the top. */
export function Home() {
  const tree = useGame((g) => g.tree);
  const plies = mainLine(tree).length - 1;
  const saved = useSavedSession();
  const playPhase = usePlay((p) => p.phase);
  const games = useStrength((s) => s.games);
  const progress = usePuzzle((p) => p.progress);
  const syncOn = useSync((s) => s.configured);
  const { pieceSet, boardTheme } = useSettings();
  const [light, dark] = BOARD_COLORS[boardTheme];
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
  const hasContinue = plies > 0 || saved !== null || playPhase !== 'off';
  const base = import.meta.env.BASE_URL.endsWith('/') ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`;
  const heroPieces = useMemo(() => startPieces(base, pieceSet, false, true), [base, pieceSet]);
  const anaPieces = useMemo(() => startPieces(base, pieceSet, true, false), [base, pieceSet]);
  const rootRef = useScrollReveal();
  const jump = (id: string) => (e: MouseEvent) => { e.preventDefault(); document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); };

  return (
    <main className="home hp" data-testid="home" ref={rootRef}>
      <div className="hp-blob" style={{ width: 520, height: 520, left: -140, top: 120, background: '#81b64c' }} aria-hidden />
      <div className="hp-blob" style={{ width: 460, height: 460, right: -120, top: 1500, background: '#4a78b8' }} aria-hidden />
      <div className="hp-blob" style={{ width: 480, height: 480, left: -100, top: 2900, background: '#c9873a' }} aria-hidden />

      <header className="hp-nav">
        <button className="hp-brand" onClick={jump('hp-top')}><span className="logo" aria-hidden>♞</span>Chess Analysis</button>
        <nav className="hp-links" aria-label="Start page sections">
          <a href="#hp-analyse" onClick={jump('hp-analyse')}>Analyse</a>
          <a href="#hp-play" onClick={jump('hp-play')}>Play</a>
          <a href="#hp-puzzles" onClick={jump('hp-puzzles')}>Puzzles</a>
          <a href="#hp-level" onClick={jump('hp-level')}>Your level</a>
          {syncOn && <a href="#hp-friends" onClick={jump('hp-friends')}>Friends</a>}
        </nav>
        <div className="home-top"><AccountButton variant="top" /></div>
      </header>

      {/* HERO */}
      <section className="hp-sec hp-hero" id="hp-top">
        <div className="hp-t">
          <div className="hp-eyebrow">Free · runs in your browser</div>
          <h1 className="hp-h1">See every move. Understand every mistake.</h1>
          <p className="hp-lead">Analyse your games with Stockfish, play at your own level and train on puzzles. Your data stays in your browser.</p>
          <div className="hp-btns">
            <button className="home-card hp-btn" onClick={analyse} data-testid="home-analyse"><strong>Analyse a game</strong></button>
            <button className="home-card hp-btn ghost" onClick={() => go('play')} data-testid="home-play"><strong>Play Stockfish</strong></button>
            <button className="home-card hp-btn ghost" onClick={() => go('player')} data-testid="home-games"><strong>My games</strong></button>
          </div>
          <button className="hp-scrollhint" onClick={jump('hp-analyse')}><span className="hp-mouse" aria-hidden /> Scroll to see what&apos;s inside</button>
        </div>
        <div className="hp-v" aria-hidden>
          <div className="hp-stage"><Board pieces={heroPieces} light={light} dark={dark} /></div>
        </div>
      </section>

      {(hasContinue || est !== null || due > 0) && (
        <section className="hp-sec home-continue" aria-label="Your progress">
          <div className="hp-wide">
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
          </div>
        </section>
      )}

      <div className="hp-banner"><SignInBanner /></div>

      {/* ANALYSE */}
      <section className="hp-sec" id="hp-analyse">
        <div className="hp-t">
          <div data-sa className="hp-eyebrow rv-up">01 · Analyse</div>
          <h2 data-sa className="hp-h2 rv-up">Every move, graded.</h2>
          <p data-sa className="hp-lead rv-up">Stockfish reviews your game and tells you what was best, what slipped and why, move by move.</p>
          <div data-sa className="hp-muted hp-small rv-up" style={{ marginTop: 22 }}>Example game</div>
          {SAMPLE_MOVES.map(([san, note, color, grade]) => (
            <div key={san} data-sa className="hp-row rv-row"><span className="hp-san">{san}</span><span className="hp-muted">{note}</span><span className="hp-grade"><i style={{ background: color }} />{grade}</span></div>
          ))}
          <div data-sa className="hp-btns rv-up"><button className="hp-btn" onClick={analyse}>Analyse a game</button></div>
        </div>
        <div className="hp-v" aria-hidden>
          <div className="hp-stage hp-ana" data-sa>
            <div className="hp-evalbar"><div className="hp-evalfill" /></div>
            <Board pieces={anaPieces} light={light} dark={dark} className="rv-pop">
              <svg className="hp-arrow" viewBox="0 0 8 8">
                <path className="hp-arrow-line" pathLength={1} d="M6.5 7.5 L6.5 5.5 L5.8 5.5" fill="none" stroke="#81b64c" strokeWidth="0.2" strokeLinecap="round" strokeLinejoin="round" opacity="0.9" />
                <polygon className="hp-arrow-head" points="5.3,5.5 5.8,5.2 5.8,5.8" fill="#81b64c" />
              </svg>
            </Board>
          </div>
        </div>
      </section>

      {/* PLAY */}
      <section className="hp-sec hp-rev" id="hp-play">
        <div className="hp-t">
          <div data-sa className="hp-eyebrow rv-up">02 · Play</div>
          <h2 data-sa className="hp-h2 rv-up">Play Stockfish at your level.</h2>
          <p data-sa className="hp-lead rv-up">Pick a strength from beginner to maximum, add a clock and ask for a hint when you are stuck. Get feedback after every move, or only at the end.</p>
          <div data-sa className="hp-btns rv-up"><button className="hp-btn" onClick={() => go('play')}>Play a game</button></div>
        </div>
        <div className="hp-v hp-col" aria-hidden>
          <div data-sa className="hp-muted hp-small rv-up">Strength</div>
          <div className="hp-pills">
            {['Beginner', 'Easy', 'Intermediate', 'Advanced', 'Expert', 'Maximum'].map((l) => <div key={l} data-sa className={`hp-pill rv-left${l === 'Intermediate' ? ' on' : ''}`}>{l}</div>)}
          </div>
          <div data-sa className="hp-card rv-pop" style={{ marginTop: 14 }}>
            <div className="hp-muted hp-small">Clock</div>
            <div className="hp-pills" style={{ marginTop: 10 }}><span className="hp-pill">3+2</span><span className="hp-pill on">10+0</span><span className="hp-pill">15+10</span></div>
            <div className="hp-muted hp-small" style={{ marginTop: 18 }}>Hint</div>
            <div style={{ marginTop: 6, fontSize: 17, lineHeight: 1.5 }}>Look at your knight. Is it doing anything?</div>
          </div>
        </div>
      </section>

      {/* PUZZLES */}
      <section className="hp-sec" id="hp-puzzles">
        <div className="hp-t">
          <div data-sa className="hp-eyebrow rv-up">03 · Puzzles</div>
          <h2 data-sa className="hp-h2 rv-up">Train. Or make your own.</h2>
          <p data-sa className="hp-lead rv-up">Puzzles by theme, spaced repetition for the ones you miss, and puzzles from your own games. Record a position, let Stockfish check it and share it with a link.</p>
          <div data-sa className="hp-btns rv-up"><button className="hp-btn" onClick={() => go('puzzles')}>Train puzzles</button><button className="hp-btn ghost" onClick={() => go('learn')}>Lessons</button></div>
        </div>
        <div className="hp-v hp-col" aria-hidden>
          <div data-sa className="hp-card rv-up">
            <div className="hp-muted hp-small">Theme</div>
            <div className="hp-disp" style={{ fontSize: 30, marginTop: 4 }}>Fork</div>
            <div className="hp-muted" style={{ marginTop: 8, lineHeight: 1.5 }}>Find the move that attacks two pieces at once.</div>
            <div className="hp-solved"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12.5l5 5L20 6.5" /></svg>Solved</div>
          </div>
          <div data-sa className="hp-card rv-up hp-flexrow"><span className="hp-disp" style={{ fontSize: 20 }}>My puzzle</span><span className="hp-muted hp-small" style={{ marginLeft: 'auto' }}>Record → Stockfish check → Share</span></div>
          <div data-sa className="hp-row rv-pop hp-code">cp1.eyJmIjoi…<span className="hp-grade" style={{ color: '#81b64c' }}>Copy link</span></div>
        </div>
      </section>

      {/* LEVEL */}
      <section className="hp-sec hp-rev" id="hp-level">
        <div className="hp-t">
          <div data-sa className="hp-eyebrow rv-up">04 · Your level</div>
          <h2 data-sa className="hp-h2 rv-up">See how you are improving.</h2>
          <p data-sa className="hp-lead rv-up">After {MIN_GAMES_RATING} analysed games you get an honest range, plus your accuracy, your weakest themes and a training plan built from your own mistakes.</p>
          <div data-sa className="hp-btns rv-up"><button className="hp-btn" onClick={() => go('strength')}>See my level</button></div>
        </div>
        <div className="hp-v hp-col" aria-hidden>
          <div data-sa className="hp-card rv-up hp-flexrow" style={{ gap: 24 }}>
            <svg width="132" height="132" viewBox="0 0 120 120">
              <circle cx="60" cy="60" r="50" fill="none" stroke="#3d3935" strokeWidth="12" />
              <circle className="hp-ring" cx="60" cy="60" r="50" fill="none" stroke="#81b64c" strokeWidth="12" strokeLinecap="round" pathLength={1} transform="rotate(-90 60 60)" />
            </svg>
            <div><div className="hp-muted hp-small">Accuracy · example</div><div className="hp-disp" style={{ fontSize: 44 }}>82%</div></div>
          </div>
          <div data-sa className="hp-card rv-up hp-levelcard">
            <div className="hp-muted hp-small">Estimated level · example</div>
            <div className="hp-disp" style={{ fontSize: 38, margin: '4px 0 24px' }}>850–1750</div>
            <div className="hp-track"><div className="hp-range" /><div className="hp-centre" /></div>
            <div className="hp-ticks"><span>400</span><span>1200</span><span>2000</span><span>2800</span></div>
            <div className="hp-muted hp-small" style={{ marginTop: 16 }}>A rough guide: about ±450 points. It tends to run high below 1000 and low above 1600.</div>
          </div>
        </div>
      </section>

      {/* FRIENDS (only when accounts are available) */}
      {syncOn && (
        <section className="hp-sec" id="hp-friends">
          <div className="hp-t">
            <div data-sa className="hp-eyebrow rv-up">05 · Friends</div>
            <h2 data-sa className="hp-h2 rv-up">Do it together.</h2>
            <p data-sa className="hp-lead rv-up">Sign in with an e-mail link, add friends by username and see who is online and what they are working on. Your progress follows you between devices.</p>
            <div data-sa className="hp-btns rv-up"><button className="hp-btn" onClick={() => openDialog('account')}>Account &amp; friends</button></div>
          </div>
          <div className="hp-v hp-friends" aria-hidden>
            {FRIENDS.map((f) => (
              <div key={f.n} className={f.bob}>
                <div className="hp-avatar" style={{ background: f.c }}>{f.i}{f.on && <span className="hp-online" />}</div>
                <div style={{ marginTop: 10, fontWeight: 700 }}>{f.n}</div>
                <div className="hp-muted hp-small">{f.a}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* CTA */}
      <section className="hp-sec hp-cta">
        <div>
          <h2 data-sa className="hp-h2 rv-up">Ready when you are.</h2>
          <p data-sa className="hp-lead rv-up">Paste a game, import from Chess.com or Lichess, or just start playing.</p>
          <div data-sa className="hp-btns rv-pop" style={{ justifyContent: 'center' }}>
            <button className="hp-btn" onClick={analyse}>Analyse a game</button>
            <button className="hp-btn ghost" onClick={enterApp} data-testid="home-skip">Go straight to the board</button>
          </div>
        </div>
      </section>
      <p className="home-foot">
        <button className="linklike" onClick={() => { enterApp(); openDialog('help'); }}>Help &amp; tips</button>
        <span aria-hidden> · </span>
        <button className="linklike" onClick={jump('hp-top')}>Back to top</button>
      </p>
    </main>
  );
}
