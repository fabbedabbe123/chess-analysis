import { useEffect, useMemo, useState } from 'react';
import { loadOpeningBook, type OpeningBook } from '@/analysis/openings';
import { buildRepertoire } from '@/strength/repertoire';
import { reasonText, stripClockTags, type TimeClass, type TrackedGame } from '@/chesscom/api';
import { computeStats, scorePct, weakestOpenings, type Record3 } from '@/chesscom/stats';
import { parsePgn } from '@/pgn/pgn';
import { gameStore, loadGame, notify } from '@/stores/gameStore';
import { clearLichess, syncLichess, useLichess } from '@/stores/lichessStore';
import { clearTracker, olderMonthsAvailable, syncPlayer, useTracker } from '@/stores/trackerStore';
import { confirmThen, setMobileTab } from '@/stores/uiStore';

type Source = 'chesscom' | 'lichess';
const CLASSES: TimeClass[] = ['bullet', 'blitz', 'rapid', 'daily'];

function Wdl({ r }: { r: Record3 }) {
  return <span className="muted">{r.win}W {r.draw}D {r.loss}L · {scorePct(r).toFixed(0)}%</span>;
}

function RatingChart({ points }: { points: { t: number; rating: number }[] }) {
  if (points.length < 2) return <p className="muted small-print">Not enough rated games for a chart.</p>;
  const w = 360, h = 90;
  const lo = Math.min(...points.map((p) => p.rating)), hi = Math.max(...points.map((p) => p.rating));
  const span = Math.max(1, hi - lo);
  const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${((i / (points.length - 1)) * w).toFixed(1)},${(h - 6 - ((p.rating - lo) / span) * (h - 12)).toFixed(1)}`).join(' ');
  return (
    <svg className="rating-chart" viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`Rating from ${points[0]!.rating} to ${points[points.length - 1]!.rating}`} data-testid="rating-chart">
      <path d={d} className="g-line" fill="none" />
      <text x="2" y="10" className="chart-label">{hi}</text>
      <text x="2" y={h - 2} className="chart-label">{lo}</text>
    </svg>
  );
}

function RepertoireView({ games }: { games: TrackedGame[] }) {
  const [open, setOpen] = useState(false);
  const [book, setBook] = useState<OpeningBook | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!open || book !== null) return;
    let alive = true;
    loadOpeningBook().then((b) => alive && setBook(b)).catch(() => alive && setFailed(true));
    return () => { alive = false; };
  }, [open, book]);
  const rep = useMemo(() => (book === null ? null : buildRepertoire(games, book)), [games, book]);
  return (
    <details className="card-details" onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)} data-testid="repertoire">
      <summary>Repertoire and book exits</summary>
      {failed && <p className="callout error small">The opening book could not be loaded.</p>}
      {open && !failed && rep === null && <p className="muted small-print">Reading your games…</p>}
      {rep !== null && (rep.rows.length === 0 ? (
        <p className="muted small-print">Needs an opening with at least 2 games in the loaded set.</p>
      ) : (
        <>
          <table className="counts" data-testid="repertoire-table">
            <thead><tr><th></th><th>Games</th><th>Score</th><th title="Average half-move where the game first left the opening book">Book to</th><th title="Share of games where you played the first move out of book">You left</th><th>Your usual first non-book move</th></tr></thead>
            <tbody>
              {rep.rows.slice(0, 12).map((o) => (
                <tr key={o.key}>
                  <td>{o.color === 'w' ? '♔' : '♚'} {o.name}</td><td>{o.games}</td><td>{o.score.toFixed(0)}%</td>
                  <td>ply {o.avgExitPly.toFixed(0)}</td><td>{o.youLeftPct.toFixed(0)}%</td><td>{o.topDeviation ? `${o.topDeviation.label} (${o.topDeviation.count}×)` : '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted small-print">Uses the bundled offline opening book on your latest {rep.considered} loaded games{rep.unreadable > 0 ? ` (${rep.unreadable} unreadable)` : ''}. Leaving the book is not a mistake in itself; it shows where your own preparation ends. A game that stays in the book to its last move counts as leaving after it.</p>
        </>
      ))}
    </details>
  );
}

function openGame(g: TrackedGame) {
  const parsed = parsePgn(stripClockTags(g.pgn));
  const game = parsed.games[0];
  if (game === undefined) { notify('error', `Could not read that game: ${parsed.errors[0] ?? 'invalid PGN'}`); return; }
  const hasWork = Object.keys(gameStore.get().tree.nodes).length > 1;
  confirmThen(hasWork, 'Loading replaces the game on the board. Export or save it first if you want to keep it.', 'Replace game', () => {
    loadGame(game.tree);
    setMobileTab('board');
  });
}

export function PlayerPanel() {
  const cc = useTracker((s) => s);
  const li = useLichess((s) => s);
  const [source, setSource] = useState<Source>(cc.username === null && li.username !== null ? 'lichess' : 'chesscom');
  const lichess = source === 'lichess';
  const t = lichess ? li : cc;
  const [input, setInput] = useState(t.username ?? '');
  const [cls, setCls] = useState<TimeClass | 'all'>('all');
  const [showAll, setShowAll] = useState(false);

  const games = useMemo(() => (cls === 'all' ? t.games : t.games.filter((g) => g.timeClass === cls)), [t.games, cls]);
  const stats = useMemo(() => computeStats(games), [games]);
  const weak = useMemo(() => weakestOpenings(stats), [stats]);
  const ratingClass: TimeClass | null = cls !== 'all' ? cls : (CLASSES.find((c) => (stats.ratings[c]?.length ?? 0) > 1) ?? null);
  const syncing = t.status === 'syncing';
  const older = lichess ? 0 : olderMonthsAvailable(cc);
  const name = lichess ? 'Lichess' : 'Chess.com';
  const pick = (s: Source) => { setSource(s); setInput((s === 'lichess' ? li.username : cc.username) ?? ''); setCls('all'); setShowAll(false); };

  const latest = (pts: { rating: number }[] | undefined) => (pts && pts.length > 0 ? pts[pts.length - 1]!.rating : null);
  const ratingLine = CLASSES.map((c) => [c, latest(stats.ratings[c])] as const).filter(([, r]) => r !== null).map(([c, r]) => `${c[0]!.toUpperCase()}${c.slice(1)} ${r}`).join(' · ');
  const tot = Math.max(1, stats.total.win + stats.total.draw + stats.total.loss);

  return (
    <section className="panel player-panel pp" aria-label="Player tracking">
      <div className="seg" role="tablist" aria-label="Site">
        {(['chesscom', 'lichess'] as const).map((s) => (
          <button key={s} role="tab" aria-selected={source === s} className={source === s ? 'on active' : ''} onClick={() => pick(s)} data-testid={`source-${s}`}>{s === 'lichess' ? 'Lichess' : 'Chess.com'}</button>
        ))}
      </div>
      <form className="pp-form" onSubmit={(e) => { e.preventDefault(); void (lichess ? syncLichess(input) : syncPlayer(input)); }}>
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder={`${name} username`} aria-label={`${name} username`} data-testid="player-input" autoCapitalize="off" spellCheck={false} />
        <button className="btn primary" type="submit" disabled={syncing || input.trim() === ''} data-testid="player-track">{syncing ? 'Syncing…' : t.username?.toLowerCase() === input.trim().toLowerCase() ? 'Refresh' : 'Track'}</button>
        {t.username && t.games.length === 0 && <button type="button" className="btn small danger" onClick={() => { if (lichess) clearLichess(); else clearTracker(); setInput(''); }}>Stop tracking</button>}
      </form>
      {t.username === null && (
        <ol className="pp-steps" data-testid="player-steps">
          <li><b>Type your username</b><span>Choose {lichess ? 'Chess.com' : 'Lichess'} or {name} above and type your username, then press <strong>Track</strong>.</span></li>
          <li><b>See results and openings</b><span>Your latest games load with results, openings and rating over time. Click a game to open it on the board.</span></li>
          <li><b>Find your level</b><span>Open <strong>Strength</strong> to let Stockfish analyse them: you get a level estimate, weak areas and practice puzzles from your own mistakes.</span></li>
        </ol>
      )}
      <p className="ep-note">Reads public games from {name}'s open API (no login, no token, nothing is sent anywhere else). Data stays in this browser.</p>
      {t.error && <div className="callout error" role="alert" data-testid="player-error">{t.error}</div>}
      {t.note && <div className="callout warn small">{t.note}</div>}

      {t.username && t.games.length === 0 && !syncing && !t.error && <p className="muted">No standard-chess games found in the months loaded.</p>}

      {t.games.length > 0 && (
        <div data-testid="player-stats">
          <div className="rp-card pp-prof">
            <div className="pp-top">
              <span className="pp-av" aria-hidden>{(t.username ?? '?')[0]!.toUpperCase()}</span>
              <div className="pp-who"><strong>{t.username}</strong><span className="muted small-print">{t.games.length} games loaded{t.lastSync ? ` · synced ${new Date(t.lastSync).toLocaleString()}` : ''}</span>{ratingLine && <span className="muted small-print">{ratingLine}</span>}</div>
              {t.username && <button type="button" className="btn small ghost" onClick={() => { if (lichess) clearLichess(); else clearTracker(); setInput(''); }}>Stop tracking</button>}
            </div>
            {games.length > 0 && (
              <>
                <div className="pp-rec" aria-hidden><i style={{ width: `${(stats.total.win / tot) * 100}%` }} className="w" /><i style={{ width: `${(stats.total.draw / tot) * 100}%` }} className="d" /><i style={{ width: `${(stats.total.loss / tot) * 100}%` }} className="l" /></div>
                <div className="pp-recnums"><span><b className="w">{stats.total.win}</b> wins</span><span><b>{stats.total.draw}</b> draws</span><span><b className="l">{stats.total.loss}</b> losses</span><span className="pp-score">{scorePct(stats.total).toFixed(0)}% score</span></div>
              </>
            )}
          </div>
          <div className="pz-pills pp-cls">
            {(['all', ...CLASSES] as const).map((c) => (
              <button key={c} className={cls === c ? 'on active' : ''} onClick={() => setCls(c)}>{c === 'all' ? 'All' : c[0]!.toUpperCase() + c.slice(1)}</button>
            ))}
          </div>
          {games.length === 0 ? <p className="muted">No {cls} games loaded.</p> : (
            <>
              <div className="pp-split">
                <div className="rp-card"><span className="rp-label">As White</span><Wdl r={stats.asWhite} /></div>
                <div className="rp-card"><span className="rp-label">As Black</span><Wdl r={stats.asBlack} /></div>
              </div>
              {ratingClass && (
                <>
                  <div className="rp-sechead"><span className="rp-label">Rating · {ratingClass}</span></div>
                  <RatingChart points={stats.ratings[ratingClass] ?? []} />
                </>
              )}
              <div className="rp-sechead"><span className="rp-label">Openings you play</span></div>
              <table className="counts pp-table" data-testid="player-openings">
                <thead><tr><th></th><th>Games</th><th>Score</th></tr></thead>
                <tbody>
                  {stats.openings.slice(0, 8).map((o) => (
                    <tr key={o.key}><td>{o.color === 'w' ? '♔' : '♚'} {o.name}</td><td>{o.games}</td><td>{scorePct(o).toFixed(0)}%</td></tr>
                  ))}
                </tbody>
              </table>
              {weak.length > 0 && (
                <p className="callout small">Weakest openings with at least 5 games: {weak.map((o) => `${o.name} as ${o.color === 'w' ? 'White' : 'Black'} (${scorePct(o).toFixed(0)}% in ${o.games})`).join('; ')}.</p>
              )}
              <RepertoireView games={games} />
              <div className="rp-sechead"><span className="rp-label">Games</span></div>
              <ul className="moments pp-games">
                {(showAll ? games : games.slice(0, 10)).map((g) => (
                  <li key={g.url}>
                    <button className="moment" onClick={() => openGame(g)} title="Load on the board">
                      <span className={`pp-res res-${g.outcome}`} aria-label={g.outcome}>{g.outcome === 'win' ? 'W' : g.outcome === 'loss' ? 'L' : 'D'}</span>
                      <span className="pp-gt"><span className="moment-move">{g.color === 'w' ? '⚪' : '⚫'} vs {g.opponent}</span>
                        <span className="muted">{g.timeClass} · {reasonText(g)}{g.rated === false ? ' · unrated' : ''}{g.opening ? ` · ${g.opening}` : ''}</span></span>
                    </button>
                  </li>
                ))}
              </ul>
              {games.length > 10 && <button className="btn small" onClick={() => setShowAll(!showAll)}>{showAll ? 'Show fewer' : `Show all ${games.length}`}</button>}
            </>
          )}
          {lichess && !li.exhausted && li.cursor !== null && <div className="row"><button className="btn small" disabled={syncing} onClick={() => void syncLichess(li.username ?? '', true)} data-testid="lichess-older">Load 100 older games</button></div>}
          {older > 0 && <div className="row"><button className="btn small" disabled={syncing} onClick={() => void syncPlayer(t.username ?? '', 3)}>Load 3 older months ({older} available)</button></div>}
        </div>
      )}
    </section>
  );
}
