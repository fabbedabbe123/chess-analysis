import { useEffect, useMemo, useState } from 'react';
import { DIFFICULTY_NOTE, THEME_LABEL, duePuzzles, loadPuzzles, nextDueTime, puzzleFromMistake, type Puzzle, type PuzzleDifficulty, type PuzzleTheme } from '@/puzzles/puzzles';
import { fetchLichessPuzzles, loadSavedLichessPuzzles, mergeLichessPuzzles, PuzzleFetchError, saveLichessPuzzles } from '@/puzzles/lichessPuzzles';
import { PuzzleBuilder } from '@/components/PuzzleBuilder';
import { decodePuzzleCode, puzzleLink } from '@/puzzles/myPuzzles';
import { addMyPuzzle, deleteMyPuzzle, useMyPuzzles } from '@/stores/myPuzzlesStore';
import { confirmThen } from '@/stores/uiStore';
import { mainLineSignature, useReview } from '@/stores/reviewStore';
import { gameStore } from '@/stores/gameStore';
import {
  exitPuzzles,
  hint,
  nextPuzzle,
  resetPuzzleProgress,
  revealSolution,
  setPuzzleFilter,
  startPuzzle,
  startPuzzleSession,
  usePuzzle,
} from '@/stores/puzzleStore';
import { setMobileTab, setRightTab } from '@/stores/uiStore';

const BUNDLED_THEMES: PuzzleTheme[] = ['mate1', 'mate2', 'mate3', 'tactic', 'defence', 'custom'];

export function PuzzlePanel() {
  const state = usePuzzle((s) => s);
  const review = useReview((s) => s.result);
  const reviewSig = useReview((s) => s.signature);
  const [bundled, setBundled] = useState<Puzzle[]>([]);
  const [online, setOnline] = useState<Puzzle[]>(() => loadSavedLichessPuzzles());
  const [fetching, setFetching] = useState(false);
  const [onlineNote, setOnlineNote] = useState<string | null>(null);
  const mine = useMyPuzzles((s) => s.puzzles);
  const all = useMemo(() => [...bundled, ...online, ...mine], [bundled, online, mine]);
  const [importText, setImportText] = useState('');
  const [mineNote, setMineNote] = useState<string | null>(null);
  const [building, setBuilding] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    loadPuzzles()
      .then((p) => alive && setBundled(p))
      .catch((e: unknown) => alive && setLoadError(e instanceof Error ? e.message : 'Puzzles could not be loaded.'));
    return () => {
      alive = false;
    };
  }, []);

  const { phase, puzzle, progress, filter } = state;
  const solvedCount = all.filter((p) => progress.solved[p.id] !== undefined).length;
  const matching = all.filter((p) => (filter.difficulty === 'any' || p.difficulty === filter.difficulty) && (filter.theme === 'any' || p.theme === filter.theme));

  const due = useMemo(() => duePuzzles(all, progress, Date.now()), [all, progress]);
  const nextDue = useMemo(() => nextDueTime(all, progress), [all, progress]);

  const getOnline = async () => {
    setFetching(true);
    setOnlineNote(null);
    try {
      const { puzzles, rejected } = await fetchLichessPuzzles();
      const merged = mergeLichessPuzzles(online, puzzles);
      const added = merged.length - online.length;
      setOnline(merged);
      const saved = saveLichessPuzzles(merged);
      setOnlineNote(`Added ${added} new puzzle${added === 1 ? '' : 's'}${rejected > 0 ? ` (${rejected} skipped as invalid)` : ''}${saved ? '' : '. Could not save them in this browser, so they stay until you reload'}.`);
    } catch (e) {
      setOnlineNote(e instanceof PuzzleFetchError ? e.message : 'Could not load puzzles from Lichess.');
    } finally {
      setFetching(false);
    }
  };

  const mistakes = useMemo(() => {
    if (review === null || reviewSig !== mainLineSignature(gameStore.get().tree)) return [];
    return review.summary.studyPositions.map((m) => ({ move: m, puzzle: puzzleFromMistake(m) })).filter((x): x is { move: typeof x.move; puzzle: Puzzle } => x.puzzle !== null);
  }, [review, reviewSig]);

  const share = async (p: Puzzle) => {
    const link = puzzleLink(p, window.location.href);
    try {
      await navigator.clipboard.writeText(link);
      setMineNote('Link copied. Send it to a friend: opening it offers to add the puzzle.');
    } catch {
      setMineNote(link);
    }
  };
  const importCode = () => {
    const r = decodePuzzleCode(importText);
    if (!r.ok) { setMineNote(r.error); return; }
    const res = addMyPuzzle(r.puzzle);
    setMineNote(!res.ok ? 'You have the maximum number of own puzzles. Delete one first.' : res.added ? `Added “${r.puzzle.title ?? 'Puzzle'}” to My puzzles.` : 'You already have that puzzle.');
    if (res.ok) setImportText('');
  };

  const start = (p: Puzzle) => {
    startPuzzle(p);
    setMobileTab('board');
  };

  return (
    <section className="panel puzzle-panel" aria-label="Puzzles">
      <header className="panel-head">
        <h2>Puzzles</h2>
        <div className="spacer" />
        {phase !== 'off' && <button className="btn small" onClick={exitPuzzles}>Exit puzzles</button>}
      </header>

      {loadError && <div className="callout error">{loadError}</div>}

      <div className="puzzle-stats">
        <div><strong>{solvedCount}</strong><span> / {all.length} solved</span></div>
        <div><strong data-testid="puzzle-streak">{progress.streak}</strong><span> streak</span></div>
        <div><strong>{progress.bestStreak}</strong><span> best</span></div>
      </div>

      {phase === 'off' ? (
        <>
          <p className="muted small-print">
            Puzzles were generated and verified with Stockfish from weak-play positions. Live analysis is switched off while you solve, and your game is restored when you leave.
          </p>
          <div className="row wrap">
            <label className="inline">Difficulty
              <select value={filter.difficulty} onChange={(e) => setPuzzleFilter({ difficulty: e.target.value as PuzzleDifficulty | 'any' })} aria-label="Puzzle difficulty">
                <option value="any">Any</option><option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option>
              </select>
            </label>
            <label className="inline">Type
              <select value={filter.theme} onChange={(e) => setPuzzleFilter({ theme: e.target.value as PuzzleTheme | 'any' })} aria-label="Puzzle type">
                <option value="any">Any</option>
                {BUNDLED_THEMES.map((t) => <option key={t} value={t}>{THEME_LABEL[t]}</option>)}
              </select>
            </label>
          </div>
          <p className="muted small-print">{DIFFICULTY_NOTE}</p>
          <div className="row wrap">
            <button className="btn primary" disabled={matching.length === 0} onClick={() => nextPuzzle(all) && setMobileTab('board')} data-testid="puzzle-start">
              {matching.length === 0 ? 'No puzzles match' : 'Start puzzle'}
            </button>
            <button className="btn small" onClick={resetPuzzleProgress}>Reset progress</button>
          </div>

          <h3>Review (spaced repetition)</h3>
          <div className="row wrap">
            <button className="btn" disabled={due.length === 0} onClick={() => { startPuzzleSession(due.slice(0, 10)); setMobileTab('board'); }} data-testid="puzzle-review">
              {due.length === 0 ? 'Nothing due' : `Review ${Math.min(10, due.length)} due`}
            </button>
            <span className="muted small-print" data-testid="puzzle-due-note">
              {nextDue === null ? 'Solve a puzzle and it comes back after 1, 3, 7, 16 and 35 days as you get it right. A miss sends it back to 1 day.' : due.length > 0 ? `${due.length} due now.` : `Next review ${new Date(nextDue).toLocaleDateString()}.`}
            </span>
          </div>

          <h3>More puzzles from Lichess</h3>
          <div className="row wrap">
            <button className="btn" disabled={fetching} onClick={() => void getOnline()} data-testid="puzzle-online">{fetching ? 'Fetching…' : 'Get 20 Lichess puzzles'}</button>
            <span className="muted small-print">{online.length} saved in this browser</span>
          </div>
          {onlineNote && <p className="muted small-print" data-testid="puzzle-online-note">{onlineNote}</p>}
          <p className="muted small-print">Optional, needs internet. Puzzles come from the Lichess puzzle database (CC0). They are checked for legality here, but unlike the bundled set they were not generated by this app's engine.</p>

          <h3>My puzzles</h3>
          {mine.length === 0 ? (
            <p className="muted small-print" data-testid="mine-empty">Nothing here yet. Make a puzzle from any position, or add one from a friend with a link or code.</p>
          ) : (
            <ul className="moments" data-testid="mine-list">
              {mine.map((p) => (
                <li key={p.id} className="mine-item" data-testid="mine-item">
                  <button className="moment" onClick={() => start(p)}>
                    <span className="moment-move">{p.title ?? 'Puzzle'}</span>
                    <span className={`pill diff-${p.difficulty}`}>{p.difficulty}</span>
                    {progress.solved[p.id] !== undefined && <span className="pill res-win">solved</span>}
                    <span className="muted">{p.sideToMove === 'w' ? 'White' : 'Black'} to move</span>
                  </button>
                  <button className="btn small" onClick={() => void share(p)} data-testid="mine-share" aria-label={`Copy a link to ${p.title ?? 'this puzzle'}`}>Share</button>
                  <button className="btn small danger" onClick={() => confirmThen(true, `Delete “${p.title ?? 'this puzzle'}”? This cannot be undone.`, 'Delete', () => deleteMyPuzzle(p.id))} data-testid="mine-delete" aria-label={`Delete ${p.title ?? 'this puzzle'}`}>✕</button>
                </li>
              ))}
            </ul>
          )}
          {building
            ? <PuzzleBuilder onSaved={() => setBuilding(false)} />
            : <button className="btn" onClick={() => setBuilding(true)} data-testid="mine-new">＋ Make a puzzle</button>}
          <div className="row wrap">
            <input value={importText} onChange={(e) => setImportText(e.target.value)} placeholder="Paste a puzzle link or code (cp1.…)" aria-label="Puzzle link or code" data-testid="mine-import-text" spellCheck={false} />
            <button className="btn" disabled={importText.trim() === ''} onClick={importCode} data-testid="mine-import">Add</button>
          </div>
          {mineNote && <p className="muted small-print" data-testid="mine-note" role="status">{mineNote}</p>}

          <h3>Practice from your game</h3>
          {mistakes.length === 0 ? (
            <p className="muted small-print">Run a game review first. Your mistakes then appear here as puzzles: find the move Stockfish preferred.</p>
          ) : (
            <ul className="moments">
              {mistakes.slice(0, 8).map(({ move, puzzle: p }) => (
                <li key={p.id}>
                  <button className="moment" onClick={() => start(p)}>
                    <span className="moment-move">{move.moveNumber}{move.color === 'w' ? '.' : '...'} {move.san}</span>
                    <span className={`pill cls-${move.classification.moveClass ?? 'good'}`}>{move.classification.moveClass}</span>
                    <span className="muted">find the better move</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        puzzle && (
          <div className="puzzle-active" data-testid="puzzle-active">
            <div className="row wrap">
              <span className="pill">{THEME_LABEL[puzzle.theme]}</span>
              <span className={`pill diff-${puzzle.difficulty}`}>{puzzle.difficulty}</span>
              <span className="muted small-print">{puzzle.sideToMove === 'w' ? 'White' : 'Black'} to move</span>
            </div>
            {state.message && (
              <div className={`callout puzzle-msg msg-${state.message.kind}`} role="status" data-testid="puzzle-message">
                {state.message.text}
              </div>
            )}
            {state.wrong > 0 && phase === 'solving' && <p className="muted small-print">Wrong attempts: {state.wrong}</p>}
            {puzzle.explanation !== undefined && phase !== 'solving' && (
              <div className="callout lesson-why" data-testid="lesson-why"><strong>Why it works: </strong>{puzzle.explanation}</div>
            )}
            {state.solutionSan && <p className="solution">Solution: <strong data-testid="puzzle-solution">{state.solutionSan}</strong></p>}
            <div className="row wrap">
              {phase === 'solving' ? (
                <>
                  <button className="btn" onClick={hint} disabled={state.hints >= 2 || state.checking}>Hint{state.hints > 0 ? ` (${state.hints}/2)` : ''}</button>
                  <button className="btn" onClick={revealSolution} disabled={state.checking}>Show solution</button>
                  <button className="btn" onClick={() => (puzzle.skillId !== undefined && state.sessionLeft === 0 ? (exitPuzzles(), setRightTab('learn')) : nextPuzzle(all))} disabled={state.checking} title="Skip; counts as not solved">{puzzle.skillId !== undefined && state.sessionLeft === 0 ? 'Leave' : 'Skip'}</button>
                </>
              ) : puzzle.skillId !== undefined && state.sessionLeft === 0 ? (
                <button className="btn primary" onClick={() => { exitPuzzles(); setRightTab('learn'); }} data-testid="lesson-finish">Finish lesson</button>
              ) : (
                <button className="btn primary" onClick={() => nextPuzzle(all)} data-testid="puzzle-next">{puzzle.skillId !== undefined ? 'Next exercise' : 'Next puzzle'}</button>
              )}
            </div>
            <p className="muted small-print">{puzzle.exact === true ? 'Drag a piece to answer. This lesson exercise accepts only the move that shows the idea.' : 'Drag a piece to answer. Moves other than the stored solution are checked with Stockfish.'}</p>
          </div>
        )
      )}
    </section>
  );
}
