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
import { AccountButton } from './AccountSection';

const IC = {
  plus: 'M12 5v14M5 12h14',
  import: 'M12 3v12M7 8l5-5 5 5M5 21h14',
  restore: 'M4 12a8 8 0 108-8M4 4v5h5',
  fromPos: 'M12 4v12M7 11l5 5 5-5M5 21h14',
  sun: 'M12 16a4 4 0 100-8 4 4 0 000 8zM12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.500 1.500M17.500 17.500L19 19M5 19l1.500-1.500M17.500 6.500L19 5',
  moon: 'M20 14.500A8 8 0 019.500 4 8 8 0 1020 14.500z',
  gear: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19 12a7 7 0 00-.100-1.200l2-1.500-2-3.400-2.300 1a7 7 0 00-2-1.200L14.300 3h-4l-.300 2.700a7 7 0 00-2 1.200l-2.300-1-2 3.400 2 1.500A7 7 0 005 12c0 .400 0 .800.100 1.200l-2 1.500 2 3.400 2.300-1a7 7 0 002 1.200l.300 2.700h4l.300-2.700a7 7 0 002-1.200l2.300 1 2-3.400-2-1.500c.100-.400.100-.800.100-1.200z',
  help: 'M9.500 9a2.500 2.500 0 114 2c-.900.600-1.500 1-1.500 2.200M12 17h.010',
} as const;
function Ic({ d }: { d: keyof typeof IC }) {
  return <svg className="ic" viewBox="0 0 24 24" aria-hidden="true"><path d={IC[d]} /></svg>;
}

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
          <strong className="lb">Chess Analysis</strong>
          <small className="lb">⌂ Start page</small>
        </div>
      </button>

      <AccountButton />

      {puzzleOpen && <div className="callout info small side-more">A puzzle or play game is open. Exit it (Puzzles / Play tab) to change the game.</div>}
      <fieldset className="plain" disabled={puzzleOpen}>
      <div className="stack">
        <button className="btn primary" title="New game" aria-label="New game" onClick={() => confirmThen(hasMoves, 'Start a new game? The current game is only kept if you exported or saved it.', 'New game', newGame)}>
          <Ic d="plus" /><span className="lb">New game</span>
        </button>
        <button className="btn" title="Import PGN / FEN" aria-label="Import PGN or FEN" onClick={() => openDialog('import')} data-testid="open-import"><Ic d="import" /><span className="lb">Import PGN / FEN</span></button>
        {changed && (
          <button className="btn side-more" onClick={() => { restoreOriginal(); notify('info', 'Original game restored.'); }} title="Discard all your variations and edits">
            <Ic d="restore" /><span className="lb">Restore imported game</span>
          </button>
        )}
        <button className="btn side-more" onClick={() => confirmThen(hasMoves, 'This replaces the game with a new one starting at the selected position.', 'Continue from here', continueFromHere)}>
          <Ic d="fromPos" /><span className="lb">New game from this position</span>
        </button>
      </div>

      <div className="side-more">
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

      </div>
      </fieldset>

      <div className="spacer" />
      <div className="stack">
        <button className="btn" title={theme === 'dark' ? 'Light theme' : 'Dark theme'} aria-label={theme === 'dark' ? 'Light theme' : 'Dark theme'} onClick={() => updateSettings({ theme: theme === 'dark' ? 'light' : 'dark' })}>
          <Ic d={theme === 'dark' ? 'sun' : 'moon'} /><span className="lb">{theme === 'dark' ? 'Light theme' : 'Dark theme'}</span>
        </button>
        <button className="btn" onClick={() => openDialog('settings')} title="Settings" aria-label="Settings" data-testid="open-settings"><Ic d="gear" /><span className="lb">Settings</span></button>
        <button className="btn" title="Help, tips & shortcuts" aria-label="Help, tips and shortcuts" onClick={() => openDialog('help')}><Ic d="help" /><span className="lb">Help, tips & shortcuts</span></button>
      </div>
    </aside>
  );
}
