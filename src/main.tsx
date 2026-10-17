import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'chessground/assets/chessground.base.css';
import './styles/app.css';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { notify, startGamePersistence } from './stores/gameStore';
import { initPuzzles } from './stores/puzzleStore';
import { initPlay } from './stores/playStore';
import { initView } from './stores/viewStore';
import { initSync } from './sync/syncStore';
import { installPieceCss } from './utils/boardStyle';
import { installAudioUnlock } from './utils/sound';
import { setStorageFailListener } from './utils/storage';
import { importPuzzleFromLocation } from './stores/myPuzzlesStore';
import { VersionBadge } from './components/VersionBadge';

installPieceCss();
startGamePersistence();
initPuzzles();
importPuzzleFromLocation();
initPlay();
initView();
void initSync();
installAudioUnlock();
setStorageFailListener(() => notify('error', 'Your browser storage is full or blocked, so recent changes may not be saved. Export a backup from Settings and free up space (e.g. delete old games).'));

const rootEl = document.getElementById('root');
if (rootEl === null) throw new Error('Missing #root element');
createRoot(rootEl).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
      <VersionBadge />
    </ErrorBoundary>
  </StrictMode>,
);
