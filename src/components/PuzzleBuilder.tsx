import { useMemo, useState } from 'react';
import { Chess } from 'chess.js';
import { getNode, pathTo } from '@/chess/gameTree';
import { currentFen, gameStore, notify, useGame } from '@/stores/gameStore';
import { addMyPuzzle } from '@/stores/myPuzzlesStore';
import { checkFirstMove, type FirstMoveCheck } from '@/stores/puzzleStore';
import { buildMyPuzzle } from '@/puzzles/myPuzzles';
import type { PuzzleDifficulty } from '@/puzzles/puzzles';

interface Start {
  nodeId: string;
  fen: string;
}

function playable(fen: string): string | null {
  try {
    const c = new Chess(fen);
    if (c.isGameOver()) return 'The game is over in this position. Pick a position where a move is still to be made.';
    return null;
  } catch {
    return 'This position is not valid.';
  }
}

/**
 * Make your own puzzle: stand on the position, press "Start here", play the solution on the board (your move, the reply,
 * your move ...), name it, optionally let Stockfish check the first move, and save. The moves are read from the game
 * tree, so ordinary board controls (Undo, variations) work while recording.
 */
export function PuzzleBuilder({ onSaved }: { onSaved: () => void }) {
  const tree = useGame((s) => s.tree);
  const currentId = useGame((s) => s.currentId);
  const [start, setStart] = useState<Start | null>(null);
  const [title, setTitle] = useState('');
  const [why, setWhy] = useState('');
  const [difficulty, setDifficulty] = useState<PuzzleDifficulty>('medium');
  const [exact, setExact] = useState(false);
  const [check, setCheck] = useState<FirstMoveCheck | 'running' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const recorded = useMemo(() => {
    if (start === null) return null;
    const path = pathTo(tree, currentId);
    const idx = path.indexOf(start.nodeId);
    if (idx < 0) return { outside: true as const };
    const nodes = path.slice(idx + 1).map((id) => getNode(tree, id));
    return { outside: false as const, nodes };
  }, [tree, currentId, start]);

  const begin = () => {
    const fen = currentFen(gameStore.get());
    const problem = playable(fen);
    if (problem !== null) { setError(problem); return; }
    setError(null);
    setCheck(null);
    setStart({ nodeId: gameStore.get().currentId, fen });
  };

  const cancel = () => { setStart(null); setCheck(null); setError(null); };

  const solution = recorded !== null && !recorded.outside ? recorded.nodes.map((n) => n.uci) : [];
  const complete = solution.length > 0 && solution.length % 2 === 1;
  const solver = start !== null && start.fen.split(' ')[1] === 'b' ? 'Black' : 'White';

  const verify = async () => {
    if (start === null || solution.length === 0) return;
    setCheck('running');
    setCheck(await checkFirstMove(start.fen, solution[0] as string));
  };

  const save = () => {
    if (start === null) return;
    const built = buildMyPuzzle({ fen: start.fen, solution, title, explanation: why, difficulty, exact });
    if (!built.ok) { setError(built.error); return; }
    const r = addMyPuzzle(built.puzzle);
    if (!r.ok) { setError('You have the maximum number of own puzzles. Delete one first.'); return; }
    notify('info', r.added ? 'Puzzle saved under My puzzles.' : 'That puzzle already existed and was updated.');
    if (!r.saved) notify('warning', 'The browser refused to store it, so it will be gone after a reload.');
    setStart(null); setTitle(''); setWhy(''); setCheck(null); setError(null); setExact(false);
    onSaved();
  };

  if (start === null) {
    return (
      <div className="puzzle-builder" data-testid="builder-idle">
        <p className="muted small-print">Set up the position on the board (import a game, a FEN, or drag pieces in the position editor), make sure it is the solver's turn, then record the solution. The moves you play are added to the game on the board; you can undo or delete them afterwards.</p>
        <button className="btn" onClick={begin} data-testid="builder-start">Start here: make a puzzle from this position</button>
        {error && <div className="callout error small" role="alert" data-testid="builder-error">{error}</div>}
      </div>
    );
  }

  return (
    <div className="puzzle-builder" data-testid="builder-active">
      <p className="small-print"><strong>{solver}</strong> to move. Play the solution on the board: first the solver's move, then the reply, then the solver again (always end on the solver's move). On a phone, play the moves in the Board tab and come back here to save.</p>
      {recorded?.outside === true ? (
        <div className="callout small" data-testid="builder-outside">You have left the start position. Go back to it (Undo / the move list) to keep recording, or cancel.</div>
      ) : (
        <p className="small-print" data-testid="builder-moves">
          {recorded === null || recorded.nodes.length === 0
            ? <span className="muted">No moves yet. Make the first move on the board.</span>
            : recorded.nodes.map((n, i) => <span key={n.id} className={i % 2 === 0 ? 'bld-solver' : 'bld-reply'}>{`${n.color === 'w' ? `${n.moveNumber}.` : i === 0 ? `${n.moveNumber}...` : ''} ${n.san} `}</span>)}
        </p>
      )}
      {recorded !== null && !recorded.outside && recorded.nodes.length > 0 && !complete && <p className="muted small-print">The last move must be the solver's. Play the reply and one more move, or take back one move.</p>}
      <label className="field"><span>Name (optional)</span>
        <input value={title} maxLength={60} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Fork on e6" data-testid="builder-title" />
      </label>
      <label className="field"><span>Why it works (optional, shown after solving)</span>
        <textarea value={why} maxLength={400} rows={2} onChange={(e) => setWhy(e.target.value)} data-testid="builder-why" />
      </label>
      <div className="row wrap">
        <label className="inline">Difficulty
          <select value={difficulty} onChange={(e) => setDifficulty(e.target.value as PuzzleDifficulty)} data-testid="builder-difficulty">
            <option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option>
          </select>
        </label>
        <label className="inline"><input type="checkbox" checked={exact} onChange={(e) => setExact(e.target.checked)} data-testid="builder-exact" /> Only my move counts</label>
      </div>
      <p className="muted small-print">Without “only my move counts”, other moves are checked with Stockfish and accepted if they are about as good (any checkmate counts in mate puzzles).</p>
      {check !== null && (
        <div className="callout small" data-testid="builder-check" role="status">
          {check === 'running' && 'Stockfish is checking your first move…'}
          {typeof check === 'object' && check.kind === 'best' && 'Stockfish also picks your first move (depth 14).'}
          {typeof check === 'object' && check.kind === 'fine' && `Stockfish prefers ${check.best}, but your first move is about as good.`}
          {typeof check === 'object' && check.kind === 'worse' && `Stockfish prefers ${check.best}: your first move is clearly weaker, so solvers who find the engine's move would count as wrong unless "only my move counts" is on.`}
          {typeof check === 'object' && check.kind === 'unavailable' && 'The engine could not check this move right now.'}
        </div>
      )}
      {error && <div className="callout error small" role="alert" data-testid="builder-error">{error}</div>}
      <div className="row wrap">
        <button className="btn primary" disabled={!complete} onClick={save} data-testid="builder-save">Save puzzle</button>
        <button className="btn" disabled={solution.length === 0 || check === 'running'} onClick={() => void verify()} data-testid="builder-verify">Check first move with Stockfish</button>
        <button className="btn small" onClick={cancel} data-testid="builder-cancel">Cancel</button>
      </div>
    </div>
  );
}
