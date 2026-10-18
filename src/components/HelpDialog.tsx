import { VersionLine } from './VersionBadge';
import { closeDialog } from '@/stores/uiStore';
import { startTour } from '@/stores/tourStore';
import { enterApp } from '@/stores/viewStore';
import { Modal } from './Modal';

export function HelpDialog() {
  return (
    <Modal title="Help & tips" onClose={closeDialog}>
      <div className="help-tour">
        <div><strong>New here?</strong><span>A one-minute guided tour of the screen.</span></div>
        <button className="btn primary" onClick={() => { closeDialog(); enterApp(); startTour(); }} data-testid="help-tour">Show the tour</button>
      </div>
      <h3>What can I do here?</h3>
      <dl className="howto" data-testid="help-howto">
        <dt>Check a game I played</dt>
        <dd>Press <strong>Import PGN / FEN</strong> in the left menu and paste the game (or a Lichess game link). Open <strong>Analyse → Review</strong> and press Run: every move gets a grade, and bad moves come with the reason, based on Stockfish's numbers. “Next error” steps through your mistakes.</dd>
        <dt>Load my own games automatically</dt>
        <dd>Open <strong>My games → Player</strong>, choose Chess.com or Lichess, type your username and press Track. Then open <strong>Strength</strong> to have Stockfish analyse them. The estimate of your playing level, your weak areas and practice puzzles from your own mistakes come from that.</dd>
        <dt>Switch to another account</dt>
        <dd>In <strong>My games → Strength</strong>, use <strong>Switch account or start over</strong> at the bottom, then track the new username.</dd>
        <dt>Play against Stockfish</dt>
        <dd>Open <strong>Play</strong>, choose colour, clock and level. You can start from any position (even the one on the board). After the game, “New game…” lets you change the settings.</dd>
        <dt>Train</dt>
        <dd><strong>Train → Learn</strong> has short lessons with exercises. <strong>Puzzles</strong> has puzzles that come back when you are due to repeat them.</dd>
        <dt>Find good moves in a position</dt>
        <dd><strong>Analyse → Engine</strong> shows Stockfish's best lines. Drag a piece on the board to try your own idea; it becomes a variation.</dd>
        <dt>Your data</dt>
        <dd>Everything stays in this browser. <strong>Settings → Your data</strong> makes a backup file you can restore later.</dd>
      </dl>
      <h3>Shortcuts</h3>
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
      <VersionLine />
      <p className="muted small-print">
        The app is distributed under GPL-3.0 because it bundles Stockfish and Chessground. Piece sets: cburnett & merida (GPLv2+), chessnut (Apache-2.0), rhosgfx (CC0). Opening names: Lichess chess-openings dataset (CC0).
        Move classification and accuracy are this app's own estimates, not Chess.com's or Lichess's.
      </p>
    </Modal>
  );
}
