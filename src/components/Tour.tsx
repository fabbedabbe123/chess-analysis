import { useEffect, useLayoutEffect, useState } from 'react';
import { closeTour, setTourStep, useTourStep } from '@/stores/tourStore';
import { openDialog, setMobileTab, setRightTab } from '@/stores/uiStore';

/**
 * Optional guided tour: a spotlight on one part of the screen at a time with a short card next to it.
 * Each step names what to light up on a wide screen and on a phone (CSS selectors; several are joined).
 */
interface Step { title: string; body: string; desk: string[]; phone: string[]; prepare?: (phone: boolean) => void }
const STEPS: Step[] = [
  { title: 'The board', body: 'Drag a piece, or click it and then the square it should go to. The arrows show the engine’s best moves in the position.', desk: ['.board-wrap'], phone: ['.board-wrap'], prepare: (phone) => { if (phone) setMobileTab('board'); } },
  { title: 'Who is better?', body: 'The bar shows the engine’s verdict. More white means White is better. +0.43 is roughly half a pawn’s edge for White.', desk: ['.eval-bar'], phone: ['.eval-bar'] },
  { title: 'Step through the game', body: 'Go back and forth with these buttons, or with ← → on the keyboard. The moves are listed underneath.', desk: ['.board-controls', '.moves-panel'], phone: ['.board-controls', '.moves-panel'] },
  { title: 'Your own game', body: 'Import a game: paste a PGN, a FEN or a Lichess link. The plus starts a new, empty game.', desk: ['[data-testid=open-import]', '.sidebar .btn.primary'], phone: ['.mobile-tabs button:last-child'] },
  { title: 'Four parts', body: 'Analyse, Train, My games and Play. Hover over an icon to see its name.', desk: ['.tab-row.primary'], phone: ['.mobile-tabs'] },
  { title: 'Review a game', body: 'Analyse has Engine, Review, Openings and Tactics. The review grades every move and explains the mistakes.', desk: ['.tab-row.sub'], phone: ['.mobile-tabs button:nth-child(2)'], prepare: () => setRightTab('engine') },
  { title: 'Play Stockfish', body: 'Pick a level from beginner to maximum, add a clock and ask for a hint when you are stuck.', desk: ['.tab-row.primary button[aria-label="Play"]'], phone: ['.mobile-tabs button:nth-child(5)'] },
  { title: 'Train with puzzles', body: 'Puzzles by theme, repetition of the ones you miss, and puzzles from your own games.', desk: ['.tab-row.primary button[aria-label="Train"]'], phone: ['.mobile-tabs button:nth-child(3)'] },
  { title: 'Settings and help', body: 'Board colours, pieces, sound and the engine live in Settings. The question mark has tips and shortcuts, and you can start this tour again from there.', desk: ['[data-testid=open-settings]', '.sidebar [aria-label="Help, tips and shortcuts"]'], phone: ['.mobile-tabs button:last-child'] },
];
const LAST = STEPS.length + 1; // index of the "done" card

type Rect = { x: number; y: number; w: number; h: number };
function unionRect(selectors: string[]): Rect | null {
  let r: Rect | null = null;
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (!el) continue;
    const b = el.getBoundingClientRect();
    if (b.width === 0 && b.height === 0) continue;
    if (r === null) r = { x: b.left, y: b.top, w: b.width, h: b.height };
    else {
      const x = Math.min(r.x, b.left), y = Math.min(r.y, b.top);
      r = { x, y, w: Math.max(r.x + r.w, b.right) - x, h: Math.max(r.y + r.h, b.bottom) - y };
    }
  }
  return r;
}

export function Tour() {
  const step = useTourStep();
  const [rect, setRect] = useState<Rect | null>(null);
  const [vw, setVw] = useState(() => window.innerWidth);
  const [vh, setVh] = useState(() => window.innerHeight);
  const phone = vw <= 900;
  const s = step >= 1 && step <= STEPS.length ? STEPS[step - 1]! : null;

  useEffect(() => { if (s?.prepare) s.prepare(phone); }, [s, phone]);

  useLayoutEffect(() => {
    if (s === null) { setRect(null); return; }
    let raf = 0;
    const measure = () => {
      setVw(window.innerWidth); setVh(window.innerHeight);
      const r = unionRect(window.innerWidth <= 900 ? s.phone : s.desk);
      if (r === null) { setRect(null); return; }
      const W = window.innerWidth, H = window.innerHeight;
      const x = Math.max(4, r.x - 8), y = Math.max(4, r.y - 8);
      setRect({ x, y, w: Math.min(W - 4, r.x + r.w + 8) - x, h: Math.min(H - 4, r.y + r.h + 8) - y });
    };
    measure();
    const again = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(measure); };
    const t = setTimeout(measure, 120); // after the step's layout change
    window.addEventListener('resize', again);
    window.addEventListener('scroll', again, true);
    return () => { clearTimeout(t); cancelAnimationFrame(raf); window.removeEventListener('resize', again); window.removeEventListener('scroll', again, true); };
  }, [s]);

  useEffect(() => {
    if (step < 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); closeTour(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [step]);

  if (step < 0) return null;

  // card position: beside the spotlight where there is room (phone: above or below it)
  const cardW = phone ? Math.min(vw - 24, 420) : 360;
  let cardStyle: React.CSSProperties = {};
  if (s !== null && rect !== null) {
    if (phone) {
      const below = vh - (rect.y + rect.h);
      const top = below > 230 ? rect.y + rect.h + 12 : Math.max(12, rect.y - 12 - 220);
      cardStyle = { left: (vw - cardW) / 2, top, width: cardW };
    } else {
      const right = vw - (rect.x + rect.w);
      const left = rect.x;
      const x = right >= cardW + 24 ? rect.x + rect.w + 16 : left >= cardW + 24 ? rect.x - cardW - 16 : Math.max(12, Math.min(vw - cardW - 12, rect.x));
      const besides = right >= cardW + 24 || left >= cardW + 24;
      const y = besides ? Math.max(12, Math.min(vh - 260, rect.y)) : rect.y + rect.h + 16 < vh - 240 ? rect.y + rect.h + 16 : Math.max(12, rect.y - 250);
      cardStyle = { left: x, top: y, width: cardW };
    }
  }

  const center = step === 0 || step === LAST || s === null || rect === null;
  const next = () => setTourStep(step + 1 > LAST ? -1 : step + 1);
  const back = () => setTourStep(Math.max(1, step - 1));

  return (
    <div className="tour" role="dialog" aria-modal="true" aria-label="Guided tour" data-testid="tour">
      {center ? <div className="tour-shade" onClick={step === 0 ? undefined : undefined} /> : <div className="tour-spot" style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }} />}
      <div className={`tour-card ${center ? 'center' : ''}`} style={center ? undefined : cardStyle}>
        {step === 0 && (
          <>
            <div className="tour-hello" aria-hidden>♞</div>
            <h2>Want a quick tour?</h2>
            <p>It takes under a minute and shows where everything is. You can skip it now and start it later from Help (?) or Settings.</p>
            <div className="tour-btns center">
              <button className="btn primary" onClick={() => setTourStep(1)} data-testid="tour-start">Start the tour</button>
              <button className="btn" onClick={closeTour} data-testid="tour-no">No thanks</button>
            </div>
          </>
        )}
        {s !== null && (
          <>
            <div className="tour-count">Step {step} of {STEPS.length}</div>
            <h2>{s.title}</h2>
            <p>{s.body}</p>
            <div className="tour-prog" aria-hidden>{STEPS.map((_, i) => <i key={i} className={i + 1 === step ? 'on' : i + 1 < step ? 'done' : ''} />)}</div>
            <div className="tour-btns">
              <button className="btn ghost" onClick={closeTour} data-testid="tour-skip">Skip</button>
              <span className="spacer" />
              {step > 1 && <button className="btn" onClick={back} data-testid="tour-back">Back</button>}
              <button className="btn primary" onClick={next} data-testid="tour-next" autoFocus>Next</button>
            </div>
          </>
        )}
        {step === LAST && (
          <>
            <div className="tour-hello" aria-hidden>♞</div>
            <h2>All set!</h2>
            <p>Now you know where everything is. Start by importing a game, or play one against Stockfish.</p>
            <div className="tour-btns center">
              <button className="btn primary" onClick={() => { closeTour(); openDialog('import'); }} data-testid="tour-import">Import a game</button>
              <button className="btn" onClick={() => { closeTour(); setRightTab('play'); setMobileTab('play'); }}>Play</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
