import { useMemo, useState } from 'react';
import { describeScore, formatScore } from '@/analysis/eval';
import { pvToSan } from '@/analysis/pv';
import { currentFen, playLine, useGame } from '@/stores/gameStore';
import { engineStore, restartEngine, stopAnalysis, useEngine } from '@/stores/engineStore';
import { updateSettings, useSettings } from '@/stores/settingsStore';
import { requestReanalysis, openDialog } from '@/stores/uiStore';
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

  return (
    <section className="panel engine-panel" aria-label="Engine analysis" data-analysed-fen={current?.fen ?? ''}>
      <header className="panel-head">
        <h2>Engine</h2>
        <span className={`status status-${analyzing ? 'searching' : status}`} data-testid="engine-status">
          {puzzleOpen ? 'paused (puzzle / play mode)' : status === 'error' ? 'error' : status === 'loading' ? 'loading…' : analyzing ? 'analysing…' : settings.autoAnalyze ? (fromCache ? 'cached' : 'idle') : 'stopped'}
        </span>
        <div className="spacer" />
        <button className="btn small primary" onClick={toggle}>{settings.autoAnalyze ? 'Stop' : 'Start'}</button>
        <button
          className="btn small"
          onClick={() => {
            restartEngine();
            requestReanalysis();
          }}
          title="Restart the engine worker (clears its state)"
        >
          Restart
        </button>
        <button className="btn small" onClick={() => openDialog('settings')} title="Engine & analysis settings">⚙</button>
      </header>

      {error !== null && status === 'error' && (
        <div className="callout error" role="alert">
          <strong>Engine problem:</strong> {error}
          <div><button className="btn small" onClick={() => { restartEngine(); requestReanalysis(); }}>Try again</button></div>
        </div>
      )}

      <div className="engine-top">
        <div className="big-score" data-testid="engine-score" title={describeScore(headline)}>{formatScore(headline, settings.evalDisplay)}</div>
        <dl className="stats">
          <div><dt>Depth</dt><dd data-testid="engine-depth">{current ? `${current.depth}${current.seldepth ? `/${current.seldepth}` : ''}` : '–'}</dd></div>
          <div><dt>Nodes</dt><dd>{formatCount(current?.nodes)}</dd></div>
          <div><dt>NPS</dt><dd>{formatCount(current?.nps)}</dd></div>
          <div><dt>Time</dt><dd>{formatDuration(current?.timeMs)}</dd></div>
        </dl>
      </div>
      <div className="engine-meta muted">
        {caps ? `${caps.name} · ${caps.flavor === 'multi' ? 'multi-threaded' : 'single-threaded'} WASM` : 'Stockfish WASM'}
        {current?.hashfull !== undefined ? ` · hash ${(current.hashfull / 10).toFixed(0)}%` : ''}
      </div>

      <div className="engine-quick">
        <label>
          Lines
          <select value={settings.multiPv} onChange={(e) => updateSettings({ multiPv: Number(e.target.value) })} aria-label="Number of lines (MultiPV)">
            {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <label>
          Mode
          <select value={settings.analysisMode} onChange={(e) => updateSettings({ analysisMode: e.target.value as typeof settings.analysisMode })} aria-label="Analysis mode">
            <option value="depth">Depth</option>
            <option value="time">Time</option>
            <option value="infinite">Infinite</option>
          </select>
        </label>
        {settings.analysisMode === 'depth' && (
          <label>
            Depth
            <input type="number" min={1} max={40} value={settings.analysisDepth} onChange={(e) => updateSettings({ analysisDepth: Number(e.target.value) })} aria-label="Analysis depth" />
          </label>
        )}
        {settings.analysisMode === 'time' && (
          <label>
            ms
            <input type="number" min={100} max={600000} step={100} value={settings.analysisTimeMs} onChange={(e) => updateSettings({ analysisTimeMs: Number(e.target.value) })} aria-label="Analysis time in milliseconds" />
          </label>
        )}
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
      {hover && (
        <div className="hover-preview" style={{ left: Math.min(hover.x, window.innerWidth - 190), top: hover.y + 6 }}>
          <MiniBoard fen={hover.fen} highlight={hover.last} />
        </div>
      )}
    </section>
  );
}

export const engineSnapshot = () => engineStore.get().snapshot;
