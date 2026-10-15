import { useState } from 'react';
import {
  continueFromHere,
  currentFen,
  currentPgn,
  gameStore,
  hasChangedFromOriginal,
  loadFen,
  loadGame,
  newGame,
  notify,
  restoreOriginal,
  updateHeaders,
  useGame,
} from '@/stores/gameStore';
import { deleteSavedGame, saveGameToLibrary, useLibrary } from '@/stores/libraryStore';
import { updateSettings, useSetting } from '@/stores/settingsStore';
import { goHome } from '@/stores/viewStore';
import { confirmThen, openDialog } from '@/stores/uiStore';
import { usePuzzle } from '@/stores/puzzleStore';
import { usePlay } from '@/stores/playStore';
import { parsePgn } from '@/pgn/pgn';
import { copyText, downloadText } from '@/utils/download';
import { formatDate } from '@/utils/format';

const HEADER_FIELDS = ['White', 'Black', 'Event', 'Site', 'Date', 'Result'] as const;

function Headers() {
  const headers = useGame((s) => s.tree.headers);
  return (
    <details className="headers">
      <summary>Game details</summary>
      {HEADER_FIELDS.map((key) => (
        <label key={key} className="field">
          <span>{key}</span>
          <input
            defaultValue={headers[key] ?? ''}
            key={`${key}:${headers[key] ?? ''}`}
            onBlur={(e) => {
              if (e.target.value !== (headers[key] ?? '')) updateHeaders({ ...gameStore.get().tree.headers, [key]: e.target.value });
            }}
          />
        </label>
      ))}
    </details>
  );
}

export function Sidebar() {
  const theme = useSetting('theme');
  const hasMoves = useGame((s) => Object.keys(s.tree.nodes).length > 1);
  const changed = useGame(hasChangedFromOriginal);
  const library = useLibrary();
  const [fenInput, setFenInput] = useState('');
  const [fenError, setFenError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const puzzleBusy = usePuzzle((p) => p.phase !== 'off');
  const playBusy = usePlay((p) => p.phase !== 'off');
  const puzzleOpen = puzzleBusy || playBusy;

  const copy = async (what: string, text: string) => {
    const ok = await copyText(text);
    notify(ok ? 'info' : 'error', ok ? `${what} copied to clipboard.` : 'The browser blocked clipboard access - use Download PGN instead.');
  };

  return (
    <aside className="sidebar" aria-label="Game menu">
      <button className="brand brand-btn" onClick={goHome} title="Back to the start page" data-testid="go-home">
        <span className="logo" aria-hidden>♞</span>
        <div>
          <strong>Chess Analysis</strong>
          <small>⌂ Start page</small>
        </div>
      </button>

      {puzzleOpen && <div className="callout info small">A puzzle or play game is open. Exit it (Puzzles / Play tab) to change the game.</div>}
      <fieldset className="plain" disabled={puzzleOpen}>
      <div className="stack">
        <button className="btn primary" onClick={() => confirmThen(hasMoves, 'Start a new game? The current game is only kept if you exported or saved it.', 'New game', newGame)}>
          ＋ New game
        </button>
        <button className="btn" onClick={() => openDialog('import')} data-testid="open-import">⇪ Import PGN / FEN</button>
        {changed && (
          <button className="btn" onClick={() => { restoreOriginal(); notify('info', 'Original game restored.'); }} title="Discard all your variations and edits">
            ↺ Restore imported game
          </button>
        )}
        <button className="btn" onClick={() => confirmThen(hasMoves, 'This replaces the game with a new one starting at the selected position.', 'Continue from here', continueFromHere)}>
          ⤵ New game from this position
        </button>
      </div>

      <h3>Export</h3>
      <div className="export-grid">
        <button className="btn" onClick={() => void copy('FEN', currentFen())}>Copy FEN</button>
        <button className="btn" onClick={() => void copy('PGN', currentPgn())}>Copy PGN</button>
        <button className="btn wide" onClick={() => downloadText('game.pgn', currentPgn(), 'application/x-chess-pgn')}>Download PGN</button>
      </div>

      <h3>Load position (FEN)</h3>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          const apply = () => {
            const r = loadFen(fenInput);
            if (r.ok) {
              setFenError(null);
              setFenInput('');
            } else setFenError(r.error);
          };
          confirmThen(hasMoves, 'Loading a position replaces the current game.', 'Load position', apply);
        }}
      >
        <input value={fenInput} onChange={(e) => setFenInput(e.target.value)} placeholder="Paste FEN…" aria-label="FEN" spellCheck={false} />
        <button className="btn" type="submit" disabled={fenInput.trim() === ''}>Load</button>
      </form>
      {fenError && <div className="callout error small" role="alert">{fenError}</div>}

      <Headers />

      <h3>Saved games</h3>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          const white = gameStore.get().tree.headers['White'];
          const black = gameStore.get().tree.headers['Black'];
          const fallback = white && black && white !== '?' ? `${white} – ${black}` : `Game ${formatDate(Date.now())}`;
          const { ok } = saveGameToLibrary(title || fallback, currentPgn());
          if (ok) notify('info', 'Saved in this browser.');
          else notify('error', 'The browser refused to store the game (storage full or blocked). Download the PGN instead.');
          setTitle('');
        }}
      >
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title (optional)" aria-label="Title for the saved game" />
        <button className="btn" type="submit">Save</button>
      </form>
      {library.length === 0 ? <p className="muted small-print">Games you save stay in this browser only.</p> : (
        <ul className="library">
          {library.map((g) => (
            <li key={g.id}>
              <button
                className="lib-item"
                onClick={() => {
                  const parsed = parsePgn(g.pgn).games[0];
                  if (!parsed) return notify('error', 'This saved game could not be read.');
                  confirmThen(hasMoves, 'Loading replaces the current game.', 'Load', () => loadGame(parsed.tree));
                }}
                title={`Saved ${formatDate(g.savedAt)}`}
              >
                <strong>{g.title}</strong>
                <small>{formatDate(g.savedAt)}</small>
              </button>
              <button className="btn small" aria-label={`Delete ${g.title}`} onClick={() => deleteSavedGame(g.id)}>✕</button>
            </li>
          ))}
        </ul>
      )}

      </fieldset>

      <div className="spacer" />
      <div className="stack">
        <button className="btn" onClick={() => updateSettings({ theme: theme === 'dark' ? 'light' : 'dark' })}>
          {theme === 'dark' ? '☀ Light theme' : '☾ Dark theme'}
        </button>
        <button className="btn" onClick={() => openDialog('settings')} data-testid="open-settings">⚙ Settings</button>
        <button className="btn" onClick={() => openDialog('help')}>? Help, tips & shortcuts</button>
      </div>
    </aside>
  );
}
