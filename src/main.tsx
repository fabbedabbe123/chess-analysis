import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'chessground/assets/chessground.base.css';
import './styles/app.css';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { startGamePersistence } from './stores/gameStore';
import { initPuzzles } from './stores/puzzleStore';
import { initPlay } from './stores/playStore';
import { initView } from './stores/viewStore';
import { initSync } from './sync/syncStore';
import { installPieceCss } from './utils/boardStyle';
import { installAudioUnlock } from './utils/sound';
import { VersionBadge } from './components/VersionBadge';

installPieceCss();
startGamePersistence();
initPuzzles();
initPlay();
initView();
void initSync();
installAudioUnlock();

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
