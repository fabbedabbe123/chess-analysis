import { useEffect, useMemo } from 'react';
import { detectTactics, TACTICS_DISCLAIMER } from '@/analysis/tactics';
import { currentFen, useGame } from '@/stores/gameStore';
import { setTacticSquares } from '@/stores/uiStore';

export function TacticsPanel() {
  const fen = useGame((s) => currentFen(s));
  const features = useMemo(() => detectTactics(fen), [fen]);
  useEffect(() => () => setTacticSquares([]), []);
  useEffect(() => setTacticSquares([]), [fen]);

  return (
    <section className="panel tactics-panel" aria-label="Tactical hints">
      <header className="panel-head"><h2>Tactics</h2></header>
      <div className="callout info">{TACTICS_DISCLAIMER}</div>
      {features.length === 0 ? (
        <p className="muted pad">No simple patterns detected here (this does not mean there is no tactic).</p>
      ) : (
        <ul className="tactics">
          {features.map((f, i) => (
            <li key={i}>
              <button className="tactic" onMouseEnter={() => setTacticSquares(f.squares)} onMouseLeave={() => setTacticSquares([])} onFocus={() => setTacticSquares(f.squares)} onBlur={() => setTacticSquares([])} onClick={() => setTacticSquares(f.squares)}>
                <span className={`pill tag kind-${f.kind}`}>{f.kind}</span> {f.text}
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="muted small-print">Not detected: skewers, discovered attacks, deflections, back-rank motifs and anything deeper than one move.</p>
    </section>
  );
}
