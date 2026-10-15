import { useState } from 'react';
import { useGame } from '@/stores/gameStore';
import { usePlay } from '@/stores/playStore';
import { usePuzzle } from '@/stores/puzzleStore';
import { openDialog, setMobileTab, setRightTab } from '@/stores/uiStore';

const KEY = 'chess-analysis:welcome-dismissed:v1';
function read(): boolean {
  try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
}
function write(): void {
  try { localStorage.setItem(KEY, '1'); } catch { /* the card just comes back next visit */ }
}

/** First-visit card: three ways to start. Disappears once a game is open, or when dismissed. */
export function Welcome() {
  const [dismissed, setDismissed] = useState(read);
  const hasMoves = useGame((g) => g.tree.nodes[g.tree.rootId]!.children.length > 0);
  const playing = usePlay((p) => p.phase !== 'off');
  const puzzle = usePuzzle((p) => p.phase !== 'off');
  if (dismissed || hasMoves || playing || puzzle) return null;
  const close = () => { write(); setDismissed(true); };
  return (
    <section className="welcome" aria-label="Getting started" data-testid="welcome">
      <header>
        <strong>What do you want to do?</strong>
        <button className="btn small" onClick={close} aria-label="Hide this" data-testid="welcome-close">✕</button>
      </header>
      <button className="welcome-choice" onClick={() => { close(); openDialog('import'); }} data-testid="welcome-analyse">
        <strong>Analyse a game</strong><span>Paste a PGN or a Lichess link. You get a review with the mistakes explained.</span>
      </button>
      <button className="welcome-choice" onClick={() => { close(); setRightTab('player'); setMobileTab('player'); }} data-testid="welcome-games">
        <strong>See my games</strong><span>Type your Chess.com or Lichess username to load your latest games.</span>
      </button>
      <button className="welcome-choice" onClick={() => { close(); setRightTab('play'); setMobileTab('play'); }} data-testid="welcome-play">
        <strong>Play Stockfish</strong><span>Pick a level, get hints and feedback, then review the game.</span>
      </button>
      <p className="muted small-print">Need more? Press <button className="linklike" onClick={() => openDialog('help')}>? Help &amp; tips</button> any time.</p>
    </section>
  );
}
