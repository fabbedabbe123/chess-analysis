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

  const [family, variation] = opening ? splitName(opening.name) : ['', ''];

  return (
    <section className="panel openings-panel op" aria-label="Opening explorer">
      {bookError && <div className="callout error">{bookError}</div>}
      <div className="opening-name op-hero" data-testid="opening-name">
        {opening ? (
          <>
            <span className="eco">{opening.eco}</span>
            <div><div className="op-name">{variation || family}</div>{variation && <div className="op-sub">{family}</div>}</div>
          </>
        ) : <span className="muted">{book ? 'No named opening for this position.' : 'Loading opening book…'}</span>}
      </div>

      <div className="rp-sechead"><span className="rp-label">Book moves from here</span></div>
      {moves.length === 0 ? (
        <div className="rp-empty"><b>{opening ? 'You have left the book' : 'No book continuations'}</b><span>Names come from the bundled Lichess openings list (no statistics).</span></div>
      ) : (
        <ul className="book-moves op-book">
          {moves.slice(0, 14).map((m) => (
            <li key={m.uci}>
              <button className="book-move" onClick={() => playMove(m.uci)}>
                <strong>{m.san}</strong>
                <span className="muted">{m.opening.name}</span>
                <span className="eco">{m.opening.eco}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="rp-sechead"><span className="rp-label">How others played it</span><div className="spacer" />
        <div className="seg small" role="radiogroup" aria-label="Explorer database">
          <button role="radio" aria-checked={settings.explorerSource === 'masters'} className={settings.explorerSource === 'masters' ? 'on' : ''} onClick={() => updateSettings({ explorerSource: 'masters' })}>Masters</button>
          <button role="radio" aria-checked={settings.explorerSource === 'lichess'} className={settings.explorerSource === 'lichess' ? 'on' : ''} onClick={() => updateSettings({ explorerSource: 'lichess' })}>Lichess</button>
        </div>
      </div>
      <label className="rp-card rp-row op-switch">
        <span className="rp-t"><b>Load from explorer.lichess.ovh</b><span className="muted small-print">{explorerOn ? 'On: the current position is sent to lichess.org.' : 'Off by default: turning it on sends the current position to lichess.org. An API token (Settings) may be required.'}</span></span>
        <input type="checkbox" className="switch" checked={explorerOn} onChange={(e) => setExplorerOn(e.target.checked)} />
      </label>
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
            <table className="explorer rp-card">
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

/** "Italian Game: Two Knights Defense, Fried Liver Attack" -> ["Italian Game: Two Knights Defense", "Fried Liver Attack"]. */
function splitName(name: string): [string, string] {
  const i = name.lastIndexOf(', ');
  if (i > 0) return [name.slice(0, i).replace(':', ' ·'), name.slice(i + 2)];
  const j = name.indexOf(': ');
  if (j > 0) return [name.slice(0, j), name.slice(j + 2)];
  return [name, ''];
}
