import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'chessground/assets/chessground.base.css';
import './styles/app.css';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { startGamePersistence } from './stores/gameStore';
import { initPuzzles } from './stores/puzzleStore';
import { initPlay } from './stores/playStore';
import { installPieceCss } from './utils/boardStyle';

installPieceCss();
startGamePersistence();
initPuzzles();
initPlay();

const rootEl = document.getElementById('root');
if (rootEl === null) throw new Error('Missing #root element');
createRoot(rootEl).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
