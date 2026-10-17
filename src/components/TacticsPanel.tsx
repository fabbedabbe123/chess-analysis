import { useEffect, useMemo, useState } from 'react';
import { detectTactics, TACTICS_DISCLAIMER } from '@/analysis/tactics';
import { currentFen, useGame } from '@/stores/gameStore';
import { setTacticSquares } from '@/stores/uiStore';

const KIND: Record<string, { label: string; icon: string; tone: 'good' | 'bad' | 'info' }> = {
  fork: { label: 'Fork', icon: 'M12 3v8M12 11l-6 8M12 11l6 8', tone: 'good' },
  pin: { label: 'Pin', icon: 'M12 3v14M8 7h8M12 17l-3 4M12 17l3 4', tone: 'info' },
  hanging: { label: 'Loose piece', icon: 'M12 9v4M12 17h.01M10.3 3.9L2 18a2 2 0 001.7 3h16.6a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z', tone: 'bad' },
  threatened: { label: 'Under attack', icon: 'M12 9v4M12 17h.01M10.3 3.9L2 18a2 2 0 001.7 3h16.6a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z', tone: 'bad' },
};

export function TacticsPanel() {
  const fen = useGame((s) => currentFen(s));
  const features = useMemo(() => detectTactics(fen), [fen]);
  const [picked, setPicked] = useState<number | null>(null);
  const [why, setWhy] = useState(false);
  useEffect(() => () => setTacticSquares([]), []);
  useEffect(() => { setTacticSquares([]); setPicked(null); }, [fen]);

  return (
    <section className="panel tactics-panel tp" aria-label="Tactical hints">
      <div className="tp-head">
        <div className="tp-title">{features.length === 0 ? 'Nothing simple to notice' : `${features.length} thing${features.length === 1 ? '' : 's'} to notice`}</div>
        <button className={`btn small icon ${why ? 'active' : ''}`} onClick={() => setWhy(!why)} aria-expanded={why} aria-label="How this works" data-tip="How this works">i</button>
      </div>
      {why && <div className="callout info">{TACTICS_DISCLAIMER}</div>}
      {features.length === 0 ? (
        <p className="muted rp-quiet">No simple patterns detected here (this does not mean there is no tactic).</p>
      ) : (
        <>
          <p className="tp-hint">Point at one, or click it, to see it on the board.</p>
          <ul className="tactics tp-list">
            {features.map((f, i) => {
              const k = KIND[f.kind] ?? { label: f.kind, icon: 'M12 8v8M8 12h8', tone: 'info' as const };
              return (
                <li key={i}>
                  <button className={`tactic tp-item ${picked === i ? 'on' : ''}`} onMouseEnter={() => setTacticSquares(f.squares)} onMouseLeave={() => picked === null && setTacticSquares([])} onFocus={() => setTacticSquares(f.squares)} onBlur={() => picked === null && setTacticSquares([])} onClick={() => { setPicked(picked === i ? null : i); setTacticSquares(picked === i ? [] : f.squares); }}>
                    <span className={`tp-icon ${k.tone}`}><svg className="ic" viewBox="0 0 24 24" aria-hidden="true"><path d={k.icon} /></svg></span>
                    <span className="tp-text"><b className={`pill tag kind-${f.kind}`}>{k.label}</b><span>{f.text}</span></span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
      <p className="ep-note">Not detected: skewers, discovered attacks, deflections, back-rank motifs and anything deeper than one move.</p>
    </section>
  );
}
