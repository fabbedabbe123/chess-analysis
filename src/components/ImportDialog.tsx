import { useRef, useState } from 'react';
import { validateAndNormalizeFen } from '@/chess/fen';
import { loadFen, loadGame, notify, gameStore } from '@/stores/gameStore';
import { parsePgn, type ParsedGame, type PgnParseResult } from '@/pgn/pgn';
import { closeDialog, confirmThen, setRightTab } from '@/stores/uiStore';
import { startReview } from '@/stores/reviewStore';
import { settingsStore } from '@/stores/settingsStore';
import { mainLineLength } from '@/chess/gameTree';
import { fetchLichessPgn, isChessComGameLink, lichessGameId, LichessError } from '@/lichess/api';
import { Modal } from './Modal';

const looksLikeFen = (text: string) => !text.includes('[') && text.trim().split(/\s+/).length >= 4 && text.includes('/');

function describeGame(g: ParsedGame, i: number): string {
  const h = g.tree.headers;
  const players = `${h['White'] ?? '?'} – ${h['Black'] ?? '?'}`;
  return `${i + 1}. ${players}${h['Event'] && h['Event'] !== '?' ? ` · ${h['Event']}` : ''}${h['Date'] && h['Date'] !== '????.??.??' ? ` · ${h['Date']}` : ''} · ${g.result ?? '*'} · ${mainLineLength(g.tree)} plies`;
}

export function ImportDialog() {
  const [text, setText] = useState('');
  const [result, setResult] = useState<PgnParseResult | null>(null);
  const [fenError, setFenError] = useState<string | null>(null);
  const [selected, setSelected] = useState(0);
  const [loading, setLoading] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  const apply = (game: ParsedGame) => {
    const hasWork = Object.keys(gameStore.get().tree.nodes).length > 1;
    confirmThen(hasWork, 'Loading replaces the game on the board. Export or save it first if you want to keep it.', 'Replace game', () => {
      loadGame(game.tree);
      if (game.warnings.length > 0) notify('warning', `Imported with ${game.warnings.length} warning(s): ${game.warnings[0] ?? ''}`);
      else notify('info', 'Game imported.');
      closeDialog();
      if (settingsStore.get().autoReviewOnImport && mainLineLength(game.tree) >= 4) {
        setRightTab('review');
        void startReview();
      }
    });
  };

  const fetchLink = async (id: string) => {
    setLoading(true);
    try {
      const pgn = await fetchLichessPgn(id);
      setText(pgn);
      parse(pgn);
    } catch (e) {
      setResult(null);
      setFenError(e instanceof LichessError ? e.message : 'Could not load that Lichess game.');
    } finally {
      setLoading(false);
    }
  };

  const parse = (source: string) => {
    setFenError(null);
    const input = source.trim();
    if (!input.includes('\n') && isChessComGameLink(input)) {
      setResult(null);
      setFenError("Chess.com game links can't be opened from a browser app (Chess.com blocks it). Track your account in the Player tab to load its games, or paste the game's PGN here.");
      return;
    }
    const linkId = input.includes('\n') ? null : lichessGameId(input);
    if (linkId !== null) {
      void fetchLink(linkId);
      return;
    }
    if (input === '') {
      setResult(null);
      setFenError('Paste a PGN or a FEN first.');
      return;
    }
    if (looksLikeFen(input)) {
      const checked = validateAndNormalizeFen(input);
      if (!checked.ok) {
        setResult(null);
        setFenError(checked.error);
        return;
      }
      confirmThen(Object.keys(gameStore.get().tree.nodes).length > 1, 'Loading a position replaces the game on the board.', 'Replace game', () => {
        const r = loadFen(input);
        if (r.ok) {
          notify('info', 'Position loaded.');
          closeDialog();
        }
      });
      return;
    }
    let parsed = parsePgn(input);
    // Plain text that is not PGN at all must not turn into an empty "game".
    if (!input.includes('[') && parsed.games.length > 0 && parsed.games.every((g) => Object.keys(g.tree.nodes).length <= 1)) {
      parsed = {
        games: [],
        errors: [...parsed.errors, ...parsed.games.flatMap((g) => g.warnings), 'That text does not look like a PGN or a FEN, so nothing was imported.'],
      };
    }
    setResult(parsed);
    setSelected(0);
    if (parsed.games.length === 1 && parsed.errors.length === 0 && (parsed.games[0]?.warnings.length ?? 0) === 0) {
      const only = parsed.games[0];
      if (only) apply(only);
    }
  };

  return (
    <Modal title="Import game or position" onClose={closeDialog} wide>
      <p className="muted">Paste a PGN (one or many games, with variations and comments), a FEN or a Lichess game link, or choose a file.</p>
      <textarea
        className="import-text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={'[Event "Casual game"]\n\n1. e4 e5 2. Nf3 Nc6 *\n\n— or a FEN —\nrnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'}
        aria-label="PGN or FEN"
        rows={10}
        spellCheck={false}
      />
      <div className="row wrap">
        <button className="btn primary" onClick={() => parse(text)} disabled={loading} data-testid="import-submit">{loading ? 'Fetching…' : 'Import'}</button>
        <button className="btn" onClick={() => file.current?.click()}>Choose file…</button>
        <input
          ref={file}
          type="file"
          accept=".pgn,.txt,text/plain"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            const content = await f.text();
            setText(content);
            parse(content);
            e.target.value = '';
          }}
        />
        <button className="btn" onClick={closeDialog}>Cancel</button>
      </div>
      {fenError && <div className="callout error" role="alert">{fenError}</div>}
      {result && result.errors.length > 0 && (
        <div className="callout error" role="alert">
          <strong>Problems:</strong>
          <ul>{result.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
        </div>
      )}
      {result && result.games.length === 0 && result.errors.length === 0 && <div className="callout error">No game found in that text.</div>}
      {result && result.games.length > 0 && (
        <div className="game-choices">
          <h3>{result.games.length === 1 ? 'Game found' : `${result.games.length} games found – choose one`}</h3>
          <ul>
            {result.games.map((g, i) => (
              <li key={i}>
                <label className="choice">
                  <input type="radio" name="game" checked={selected === i} onChange={() => setSelected(i)} />
                  <span>{describeGame(g, i)}</span>
                </label>
                {selected === i && g.warnings.length > 0 && (
                  <div className="callout warn">
                    <strong>Warnings (nothing was silently dropped):</strong>
                    <ul>{g.warnings.map((w, k) => <li key={k}>{w}</li>)}</ul>
                  </div>
                )}
              </li>
            ))}
          </ul>
          <button className="btn primary" onClick={() => { const g = result.games[selected]; if (g) apply(g); }}>
            Load selected game
          </button>
        </div>
      )}
    </Modal>
  );
}
