import { useMemo, useState } from 'react';
import { describeScore, formatScore } from '@/analysis/eval';
import { pvToSan } from '@/analysis/pv';
import { currentFen, playLine, useGame } from '@/stores/gameStore';
import { engineStore, restartEngine, stopAnalysis, useEngine } from '@/stores/engineStore';
import { updateSettings, useSettings } from '@/stores/settingsStore';
import { requestReanalysis, openDialog, setMobileTab, setRightTab } from '@/stores/uiStore';
import { usePuzzle } from '@/stores/puzzleStore';
import { usePlay } from '@/stores/playStore';
import type { EngineLine } from '@/types/engine';
import { formatCount, formatDuration } from '@/utils/format';
import { MiniBoard } from './MiniBoard';

interface Hover {
  fen: string;
  last: string[];
  x: number;
  y: number;
}

function CandidateLine({ fen, line, onHover }: { fen: string; line: EngineLine; onHover: (h: Hover | null) => void }) {
  const settings = useSettings();
  const conv = useMemo(() => pvToSan(fen, line.pv, 24), [fen, line.pv]);
  const white = line.scoreWhite;
  const tone = white.kind === 'mate' ? (white.value >= 0 ? 'pos' : 'neg') : white.value > 20 ? 'pos' : white.value < -20 ? 'neg' : 'eq';
  const bound = line.bound === 'lower' ? '≥ ' : line.bound === 'upper' ? '≤ ' : '';
  return (
    <li className="pv-line" data-testid="pv-line">
      <span className={`pv-score ${tone}`} title={describeScore(white)}>{bound}{formatScore(white, settings.evalDisplay)}</span>
      <span className="pv-moves">
        {conv.moves.map((m, i) => {
          const prefix = m.color === 'w' ? `${m.moveNumber}.` : i === 0 ? `${m.moveNumber}...` : '';
          return (
            <button
              key={i}
              className="pv-move"
              title="Click to play this line up to here as a variation"
              onClick={() => playLine(line.pv.slice(0, i + 1))}
              onMouseEnter={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                onHover({ fen: m.fenAfter, last: [m.uci.slice(0, 2), m.uci.slice(2, 4)], x: r.left, y: r.bottom });
              }}
              onMouseLeave={() => onHover(null)}
            >
              {prefix && <span className="pv-num">{prefix}</span>}
              {m.san}
            </button>
          );
        })}
        {conv.truncated && <span className="muted"> …</span>}
        {conv.moves.length === 0 && <span className="muted">no moves</span>}
      </span>
      <span className="pv-depth" title={`Depth ${line.depth}${line.seldepth ? `, selective depth ${line.seldepth}` : ''}`}>d{line.depth}</span>
    </li>
  );
}

export function EnginePanel() {
  const fen = useGame((s) => currentFen(s));
  const settings = useSettings();
  const status = useEngine((s) => s.status);
  const error = useEngine((s) => s.error);
  const caps = useEngine((s) => s.capabilities);
  const snapshot = useEngine((s) => s.snapshot);
  const requestedFen = useEngine((s) => s.requestedFen);
  const terminal = useEngine((s) => s.terminal);
  const analyzing = useEngine((s) => s.analyzing);
  const fromCache = useEngine((s) => s.fromCache);
  const [hover, setHover] = useState<Hover | null>(null);
  const puzzleBusy = usePuzzle((p) => p.phase !== 'off');
  const playBusy = usePlay((p) => p.phase !== 'off');
  const puzzleOpen = puzzleBusy || playBusy;

  const current = snapshot !== null && requestedFen === fen && snapshot.fen === fen ? snapshot : null;
  const headline = terminal !== null && requestedFen === fen ? terminal : (current?.lines[0]?.scoreWhite ?? null);

  const toggle = () => {
    if (settings.autoAnalyze) {
      updateSettings({ autoAnalyze: false });
      stopAnalysis();
    } else {
      updateSettings({ autoAnalyze: true });
      requestReanalysis();
    }
  };

  const [opts, setOpts] = useState(false);
  const plies = useGame((g) => Object.keys(g.tree.nodes).length - 1);
  const statusText = puzzleOpen ? 'paused (puzzle / play mode)' : status === 'error' ? 'error' : status === 'loading' ? 'loading…' : analyzing ? 'analysing…' : settings.autoAnalyze ? (fromCache ? 'cached' : 'idle') : 'stopped';
  const lineCounts = [1, 2, 3, 5, 8].filter((n) => n <= Math.min(caps?.maxMultiPv ?? 8, 8));

  return (
    <section className="panel engine-panel ep" aria-label="Engine analysis" data-analysed-fen={current?.fen ?? ''}>
      <header className="ep-head">
        <span className={`ep-chip status status-${analyzing ? 'searching' : status} ${analyzing ? 'live' : ''}`} data-testid="engine-status">{statusText}</span>
        <span className="ep-depth">Depth <b data-testid="engine-depth">{current ? `${current.depth}${current.seldepth ? `/${current.seldepth}` : ''}` : '–'}</b></span>
        <div className="spacer" />
        <button className={`btn small ${settings.autoAnalyze ? '' : 'primary'}`} onClick={toggle}>{settings.autoAnalyze ? 'Stop' : 'Start'}</button>
        <button className={`btn small icon ${opts ? 'active' : ''}`} onClick={() => setOpts(!opts)} aria-expanded={opts} aria-label="Engine options" data-tip="Engine options" data-testid="engine-options">
          <svg className="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h4M12 17h8M16 5v4M10 15v4" /></svg>
        </button>
      </header>

      {opts && (
        <div className="ep-opts" data-testid="engine-options-panel">
          <label>Mode
            <select value={settings.analysisMode} onChange={(e) => updateSettings({ analysisMode: e.target.value as typeof settings.analysisMode })} aria-label="Analysis mode">
              <option value="depth">Depth</option>
              <option value="time">Time</option>
              <option value="infinite">Infinite</option>
            </select>
          </label>
          {settings.analysisMode === 'depth' && (
            <label>Depth
              <input type="number" min={1} max={40} value={settings.analysisDepth} onChange={(e) => updateSettings({ analysisDepth: Number(e.target.value) })} aria-label="Analysis depth" />
            </label>
          )}
          {settings.analysisMode === 'time' && (
            <label>ms
              <input type="number" min={100} max={600000} step={100} value={settings.analysisTimeMs} onChange={(e) => updateSettings({ analysisTimeMs: Number(e.target.value) })} aria-label="Analysis time in milliseconds" />
            </label>
          )}
          <button className="btn small" onClick={() => { restartEngine(); requestReanalysis(); }} title="Restart the engine worker (clears its state)">Restart</button>
          <button className="btn small ghost" onClick={() => openDialog('settings')}>More in Settings…</button>
        </div>
      )}

      {error !== null && status === 'error' && (
        <div className="callout error" role="alert">
          <strong>Engine problem:</strong> {error}
          <div><button className="btn small" onClick={() => { restartEngine(); requestReanalysis(); }}>Try again</button></div>
        </div>
      )}

      <div className="ep-hero">
        <div className="big-score" data-testid="engine-score" title={describeScore(headline)}>{formatScore(headline, settings.evalDisplay)}</div>
        <div className={`ep-verdict ${headline === null ? '' : (headline.kind === 'mate' ? headline.value >= 0 : headline.value >= 0) ? 'w' : 'b'}`}>{verdict(headline)}</div>
      </div>
      <div className="ep-stats" title={caps ? `${caps.name} · ${caps.flavor === 'multi' ? 'multi-threaded' : 'single-threaded'} WASM` : 'Stockfish WASM'}>
        <span>Nodes <b>{formatCount(current?.nodes)}</b></span>
        <span>Speed <b>{formatCount(current?.nps)}/s</b></span>
        <span>Time <b>{formatDuration(current?.timeMs)}</b></span>
        {current?.hashfull !== undefined && <span>Memory <b>{(current.hashfull / 10).toFixed(0)}%</b></span>}
      </div>

      <div className="ep-sechead">
        <span className="ep-label">Best lines</span>
        <div className="spacer" />
        <div className="seg small" role="radiogroup" aria-label="Number of lines (MultiPV)">
          {lineCounts.map((n) => <button key={n} type="button" role="radio" aria-checked={settings.multiPv === n} className={settings.multiPv === n ? 'on' : ''} onClick={() => updateSettings({ multiPv: n })}>{n}</button>)}
        </div>
      </div>
      {terminal !== null && requestedFen === fen ? (
        <p className="muted pad">Game is over in this position – nothing to search.</p>
      ) : current && current.lines.length > 0 ? (
        <ol className="pv-list">
          {current.lines.map((line) => (
            <CandidateLine key={line.multipv} fen={fen} line={line} onHover={setHover} />
          ))}
        </ol>
      ) : (
        <p className="muted pad">{settings.autoAnalyze ? (status === 'error' ? '' : 'Waiting for the engine…') : 'Analysis is stopped. Press Start.'}</p>
      )}
      <p className="ep-note">Click a move in a line to play it on the board. Hover to preview.</p>
      {plies >= 6 && !puzzleOpen && (
        <div className="ep-cta">
          <div><strong>Review this game</strong><span>Every move gets a grade.</span></div>
          <button className="btn primary" onClick={() => { setRightTab('review'); setMobileTab('review'); }}>Open review</button>
        </div>
      )}
      {hover && (
        <div className="hover-preview" style={{ left: Math.min(hover.x, window.innerWidth - 190), top: hover.y + 6 }}>
          <MiniBoard fen={hover.fen} highlight={hover.last} />
        </div>
      )}
    </section>
  );
}

/** Plain-words verdict next to the big number. */
function verdict(score: ReturnType<typeof engineStore.get>['terminal'] | EngineLine['scoreWhite'] | null): string {
  if (score === null) return 'No evaluation yet';
  if (score.kind === 'mate') return describeScore(score);
  const v = Math.abs(score.value);
  const who = score.value > 0 ? 'White' : 'Black';
  if (v < 30) return 'About equal';
  if (v < 90) return `${who} is slightly better`;
  if (v < 250) return `${who} is better`;
  return `${who} is winning`;
}

export const engineSnapshot = () => engineStore.get().snapshot;
