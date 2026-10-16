import { canRedo, canUndo, goBack, goEnd, goForward, goStart, redo, undo, useGame } from '@/stores/gameStore';
import { getNode, lineEnd } from '@/chess/gameTree';
import { flipBoard } from '@/stores/puzzleStore';

export function BoardControls() {
  const canU = useGame(canUndo);
  const canR = useGame(canRedo);
  const atEnd = useGame((s) => lineEnd(s.tree, s.currentId) === s.currentId);
  const atStart = useGame((s) => getNode(s.tree, s.currentId).parentId === null);

  return (
    <div className="board-controls" role="toolbar" aria-label="Board controls">
      <button onClick={goStart} disabled={atStart} title="First position (Home)" aria-label="First position">⏮</button>
      <button onClick={goBack} disabled={atStart} title="Previous move (←)" aria-label="Previous move">◀</button>
      <button onClick={goForward} disabled={atEnd} title="Next move (→)" aria-label="Next move">▶</button>
      <button onClick={goEnd} disabled={atEnd} title="Last position (End)" aria-label="Last position">⏭</button>
      <span className="sep" />
      <button onClick={undo} disabled={!canU} title="Undo (Ctrl+Z)" aria-label="Undo"><span aria-hidden>↶</span><span className="btn-lbl"> Undo</span></button>
      <button onClick={redo} disabled={!canR} title="Redo (Ctrl+Shift+Z)" aria-label="Redo"><span aria-hidden>↷</span><span className="btn-lbl"> Redo</span></button>
      <span className="sep" />
      <button
        onClick={flipBoard}
        title="Flip board (F)"
        aria-label="Flip board"
      >
        <span aria-hidden>⇅</span><span className="btn-lbl"> Flip</span>
      </button>
    </div>
  );
}
