import { useEffect, useMemo, useState } from 'react';
import {
  bookContinuations,
  ExplorerError,
  fetchExplorer,
  identifyOpening,
  loadOpeningBook,
  type ExplorerResult,
  type OpeningBook,
} from '@/analysis/openings';
import { currentFen, playMove, useGame } from '@/stores/gameStore';
import { getNode, pathTo } from '@/chess/gameTree';
import { updateSettings, useSettings } from '@/stores/settingsStore';

function WdlBar({ white, draws, black }: { white: number; draws: number; black: number }) {
  const total = white + draws + black || 1;
  const pct = (n: number) => (n / total) * 100;
  return (
    <span className="wdl" title={`White ${pct(white).toFixed(0)}% · draws ${pct(draws).toFixed(0)}% · Black ${pct(black).toFixed(0)}%`}>
      <span className="w" style={{ width: `${pct(white)}%` }}>{pct(white) >= 14 ? `${pct(white).toFixed(0)}%` : ''}</span>
      <span className="d" style={{ width: `${pct(draws)}%` }}>{pct(draws) >= 14 ? `${pct(draws).toFixed(0)}%` : ''}</span>
      <span className="b" style={{ width: `${pct(black)}%` }}>{pct(black) >= 14 ? `${pct(black).toFixed(0)}%` : ''}</span>
    </span>
  );
}

export function OpeningsPanel() {
  const settings = useSettings();
  const tree = useGame((s) => s.tree);
  const currentId = useGame((s) => s.currentId);
  const fen = useGame((s) => currentFen(s));
  const [book, setBook] = useState<OpeningBook | null>(null);
  const [bookError, setBookError] = useState<string | null>(null);
  const [explorerOn, setExplorerOn] = useState(false);
  const [explorer, setExplorer] = useState<{ fen: string; result: ExplorerResult } | null>(null);
  const [explorerError, setExplorerError] = useState<ExplorerError | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    loadOpeningBook()
      .then((b) => alive && setBook(b))
      .catch((e: unknown) => alive && setBookError(e instanceof Error ? e.message : 'Opening book could not be loaded.'));
    return () => {
      alive = false;
    };
  }, []);

  const fens = useMemo(() => pathTo(tree, currentId).map((id) => getNode(tree, id).fen), [tree, currentId]);
  const opening = useMemo(() => (book ? identifyOpening(book, fens) : null), [book, fens]);
  const moves = useMemo(() => (book ? bookContinuations(book, fen) : []), [book, fen]);

  // Statistics only come from the network when the user turns the explorer on; nothing is estimated.
  useEffect(() => {
    if (!explorerOn) return;
    const ctrl = new AbortController();
    setLoading(true);
    setExplorerError(null);
    const timer = setTimeout(() => {
      fetchExplorer(fen, { source: settings.explorerSource, token: settings.explorerToken, signal: ctrl.signal })
        .then((result) => {
          setExplorer({ fen, result });
          setLoading(false);
        })
        .catch((e: unknown) => {
          if (ctrl.signal.aborted) return;
          setExplorer(null);
          setExplorerError(e instanceof ExplorerError ? e : new ExplorerError(e instanceof Error ? e.message : 'Unknown error', 'network'));
          setLoading(false);
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [explorerOn, fen, settings.explorerSource, settings.explorerToken]);

  const shown = explorer !== null && explorer.fen === fen ? explorer.result : null;

  return (
    <section className="panel openings-panel" aria-label="Opening explorer">
      <header className="panel-head"><h2>Openings</h2></header>
      {bookError && <div className="callout error">{bookError}</div>}
      <div className="opening-name" data-testid="opening-name">
        {opening ? <><span className="eco">{opening.eco}</span> {opening.name}</> : <span className="muted">{book ? 'No named opening for this position.' : 'Loading opening book…'}</span>}
      </div>

      <h3>Book moves <span className="muted small-print">(names only – bundled Lichess openings dataset, no statistics)</span></h3>
      {moves.length === 0 ? <p className="muted pad">No book continuations.</p> : (
        <ul className="book-moves">
          {moves.slice(0, 14).map((m) => (
            <li key={m.uci}>
              <button className="book-move" onClick={() => playMove(m.uci)}>
                <strong>{m.san}</strong>
                <span className="eco">{m.opening.eco}</span>
                <span className="muted">{m.opening.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <h3>Game statistics <span className="muted small-print">(Lichess opening explorer, online)</span></h3>
      <div className="row wrap">
        <label className="inline">
          <input type="checkbox" checked={explorerOn} onChange={(e) => setExplorerOn(e.target.checked)} /> Load from explorer.lichess.ovh
        </label>
        <select value={settings.explorerSource} onChange={(e) => updateSettings({ explorerSource: e.target.value as 'masters' | 'lichess' })} aria-label="Explorer database">
          <option value="masters">Masters games</option>
          <option value="lichess">Lichess games</option>
        </select>
      </div>
      {!explorerOn && <p className="muted small-print">Off by default: turning it on sends the current position to lichess.org. An API token (Settings) may be required.</p>}
      {explorerOn && loading && <p className="muted pad">Loading…</p>}
      {explorerOn && explorerError && (
        <div className="callout warn" role="status">
          Explorer statistics unavailable ({explorerError.message}). {explorerError.kind === 'auth' && 'The service needs a Lichess API token – add one in Settings. '}
          The offline book above still works; no numbers are made up.
        </div>
      )}
      {shown && (
        <>
          <p className="muted small-print">{(shown.white + shown.draws + shown.black).toLocaleString()} games in this position ({shown.source}).</p>
          {shown.moves.length === 0 ? <p className="muted pad">No games found.</p> : (
            <table className="explorer">
              <tbody>
                {shown.moves.map((m) => {
                  const total = m.white + m.draws + m.black;
                  return (
                    <tr key={m.uci} onClick={() => playMove(m.uci)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && playMove(m.uci)}>
                      <td><strong>{m.san}</strong></td>
                      <td className="muted">{total.toLocaleString()}</td>
                      <td><WdlBar white={m.white} draws={m.draws} black={m.black} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </>
      )}
    </section>
  );
}
