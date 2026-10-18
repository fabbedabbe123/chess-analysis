import { closeDialog } from '@/stores/uiStore';
import { APP_NAME, REPO_URL } from '@/brand';
import { Modal } from './Modal';

export function AboutDialog() {
  return (
    <Modal title={`About ${APP_NAME}`} onClose={closeDialog}>
      <p>{APP_NAME} is a free chess trainer. Type your Chess.com or Lichess username and it analyses your latest games with Stockfish, shows where you lose the most, estimates your level and builds a practice plan from your own mistakes.</p>
      <p>Next to that there is a learning path (levels, lessons, and thousands of real puzzle positions), daily practice that brings back what you got wrong, and a game board to analyse any game or play against Stockfish.</p>
      <p className="muted small-print">The level estimate is a rough guide calibrated on public games, not an Elo. Move grades and accuracy are this app's own estimates. This is a hobby project and has no company behind it. The source code is open: <a href={REPO_URL} target="_blank" rel="noreferrer">GitHub</a>.</p>
    </Modal>
  );
}

export function PrivacyDialog() {
  return (
    <Modal title="Privacy" onClose={closeDialog}>
      <dl className="howto">
        <dt>Stays in your browser</dt>
        <dd>Games, analysis, settings, puzzle progress and the placement test are stored in this browser (localStorage). The engine, Stockfish, runs on your own device. Nothing is sent to a server for the analysis.</dd>
        <dt>What leaves your browser</dt>
        <dd>When you type a username, your browser asks Chess.com or Lichess for that player's public games (and for your own Lichess games only if you add a token, which is never uploaded). "More from Lichess" fetches puzzles from Lichess. The page itself is hosted on GitHub Pages, which may log requests under GitHub's own policy.</dd>
        <dt>If you sign in</dt>
        <dd>Signing in is optional and only used to sync between devices. It stores your settings, analysed games, puzzle progress, saved games and the usernames you track in a database, protected so that only your account can read its own rows. You can delete the data from Settings.</dd>
        <dt>No tracking</dt>
        <dd>There are no ads, no analytics and no tracking scripts.</dd>
        <dt>Your control</dt>
        <dd>Settings → Your data makes a backup file and can clear everything. Clearing the site data in your browser removes all local data.</dd>
      </dl>
    </Modal>
  );
}

export function CreditsDialog() {
  return (
    <Modal title="Credits and licences" onClose={closeDialog}>
      <ul className="learn-ideas">
        <li><strong>Stockfish</strong> (GPL-3.0) is the chess engine, compiled to WebAssembly.</li>
        <li><strong>Chessground</strong> (GPL-3.0) is the board and <strong>chess.js</strong> (BSD-2-Clause) handles the rules.</li>
        <li><strong>Lichess</strong> puzzle database and opening names (CC0). Thanks to the Lichess community.</li>
        <li><strong>Piece sets:</strong> cburnett and merida (GPLv2+), chessnut (Apache-2.0), rhosgfx (CC0).</li>
        <li><strong>Games</strong> come from the public APIs of Chess.com and Lichess and are used to analyse the player's own play.</li>
      </ul>
      <p className="muted small-print">{APP_NAME} is an independent project. It is not affiliated with, or endorsed by, Chess.com or Lichess. The app is distributed under GPL-3.0; source code at <a href={REPO_URL} target="_blank" rel="noreferrer">GitHub</a>.</p>
    </Modal>
  );
}
