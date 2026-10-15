import { closeDialog } from '@/stores/uiStore';
import { Modal } from './Modal';

export function HelpDialog() {
  return (
    <Modal title="Shortcuts & about" onClose={closeDialog}>
      <table className="keys">
        <tbody>
          <tr><td><kbd>←</kbd> <kbd>→</kbd></td><td>Previous / next move</td></tr>
          <tr><td><kbd>Home</kbd> <kbd>End</kbd></td><td>First / last position</td></tr>
          <tr><td><kbd>Ctrl</kbd>+<kbd>Z</kbd></td><td>Undo (step back; redo returns along the same line)</td></tr>
          <tr><td><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd></td><td>Redo</td></tr>
          <tr><td><kbd>F</kbd></td><td>Flip board</td></tr>
          <tr><td>Right-drag on board</td><td>Draw arrows / circle squares (<kbd>Shift</kbd> red, <kbd>Ctrl</kbd> blue, <kbd>Alt</kbd> yellow)</td></tr>
        </tbody>
      </table>
      <h3>About</h3>
      <p>
        Engine: Stockfish (WebAssembly) running in a Web Worker in your browser – nothing is sent to a server.
        Playing a move that is not in the game creates a <em>variation</em>; the main line is only changed when you ask (Promote / Make main line).
        Evaluations are always shown from White's point of view.
      </p>
      <p className="muted small-print">
        The app is distributed under GPL-3.0 because it bundles Stockfish and Chessground. Piece sets: cburnett & merida (GPLv2+), chessnut (Apache-2.0), rhosgfx (CC0). Opening names: Lichess chess-openings dataset (CC0).
        Move classification and accuracy are this app's own estimates, not Chess.com's or Lichess's.
      </p>
    </Modal>
  );
}
