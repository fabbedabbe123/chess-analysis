import { useMemo, useState } from 'react';
import { stripClockTags, type TimeClass, type TrackedGame } from '@/chesscom/api';
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

  return (
    <section className="panel player-panel" aria-label="Player tracking">
      <header className="panel-head"><h2>Player</h2></header>
      <div className="tabs small" role="tablist" aria-label="Site">
        {(['chesscom', 'lichess'] as const).map((s) => (
          <button key={s} role="tab" aria-selected={source === s} className={source === s ? 'active' : ''} onClick={() => pick(s)} data-testid={`source-${s}`}>{s === 'lichess' ? 'Lichess' : 'Chess.com'}</button>
        ))}
      </div>
      <form className="row wrap" onSubmit={(e) => { e.preventDefault(); void (lichess ? syncLichess(input) : syncPlayer(input)); }}>
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder={`${name} username`} aria-label={`${name} username`} data-testid="player-input" autoCapitalize="off" spellCheck={false} />
        <button className="btn primary" type="submit" disabled={syncing || input.trim() === ''} data-testid="player-track">{syncing ? 'Syncing…' : t.username?.toLowerCase() === input.trim().toLowerCase() ? 'Refresh' : 'Track'}</button>
        {t.username && <button type="button" className="btn small danger" onClick={() => { if (lichess) clearLichess(); else clearTracker(); setInput(''); }}>Stop tracking</button>}
      </form>
      <p className="muted small-print">Reads public games from {name}'s open API (no login, no token, nothing is sent anywhere else). Data stays in this browser.</p>
      {t.error && <div className="callout error" role="alert" data-testid="player-error">{t.error}</div>}
      {t.note && <div className="callout warn small">{t.note}</div>}

      {t.username && t.games.length === 0 && !syncing && !t.error && <p className="muted">No standard-chess games found in the months loaded.</p>}

      {t.games.length > 0 && (
        <div data-testid="player-stats">
          <div className="row wrap">
            <strong>{t.username}</strong>
            <span className="muted small-print">{t.games.length} games loaded{t.lastSync ? ` · synced ${new Date(t.lastSync).toLocaleString()}` : ''}</span>
          </div>
          <div className="tabs small">
            {(['all', ...CLASSES] as const).map((c) => (
              <button key={c} className={cls === c ? 'active' : ''} onClick={() => setCls(c)}>{c}</button>
            ))}
          </div>
          {games.length === 0 ? <p className="muted">No {cls} games loaded.</p> : (
            <>
              <table className="counts">
                <tbody>
                  <tr><td>Overall</td><td><Wdl r={stats.total} /></td></tr>
                  <tr><td>As White</td><td><Wdl r={stats.asWhite} /></td></tr>
                  <tr><td>As Black</td><td><Wdl r={stats.asBlack} /></td></tr>
                </tbody>
              </table>
              {ratingClass && (
                <>
                  <h3>Rating · {ratingClass}</h3>
                  <RatingChart points={stats.ratings[ratingClass] ?? []} />
                </>
              )}
              <h3>Openings you play</h3>
              <table className="counts" data-testid="player-openings">
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
              <h3>Games</h3>
              <ul className="moments">
                {(showAll ? games : games.slice(0, 10)).map((g) => (
                  <li key={g.url}>
                    <button className="moment" onClick={() => openGame(g)} title="Load on the board">
                      <span className={`pill res-${g.outcome}`}>{g.outcome}</span>
                      <span className="moment-move">{g.color === 'w' ? '⚪' : '⚫'} vs {g.opponent}</span>
                      <span className="muted">{g.timeClass} · {g.reason}{g.opening ? ` · ${g.opening}` : ''}</span>
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
