import { useEffect } from 'react';
import { analyze, stopAnalysis } from '@/stores/engineStore';
import { currentFen, useGame } from '@/stores/gameStore';
import { engineOptionsFrom, searchLimitsFrom, settingsStore } from '@/stores/settingsStore';
import { useStore } from '@/stores/createStore';
import { useUi } from '@/stores/uiStore';
import { usePuzzle } from '@/stores/puzzleStore';
import { usePlay } from '@/stores/playStore';
import { useView } from '@/stores/viewStore';

/**
 * Keeps the engine pointed at the selected position. Navigating quickly only ever
 * results in ONE search for the final position (debounced); the engine layer
 * additionally supersedes any search that is still running.
 */
export function useAutoAnalysis(): void {
  const fen = useGame((s) => currentFen(s));
  const puzzleBusy = usePuzzle((s) => s.phase !== 'off');
  const playBusy = usePlay((s) => s.phase !== 'off');
  const puzzleOpen = puzzleBusy || playBusy;
  const onHome = useView() === 'home';
  const enabled = useStore(settingsStore, (s) => s.autoAnalyze) && !puzzleOpen && !onHome;
  // Fingerprint of everything that changes what the engine should do.
  const fingerprint = useStore(settingsStore, (s) =>
    JSON.stringify([s.analysisMode, s.analysisDepth, s.analysisTimeMs, s.multiPv, s.hashMb, s.threads, s.limitStrength, s.elo, s.skillLevel, s.showWdl]),
  );
  const nonce = useUi((s) => s.reanalyzeNonce);

  useEffect(() => {
    if (!enabled) return;
    const timer = setTimeout(() => {
      const s = settingsStore.get();
      void analyze({ fen, multiPv: s.multiPv, limits: searchLimitsFrom(s), options: engineOptionsFrom(s) });
    }, 120);
    return () => clearTimeout(timer);
  }, [fen, enabled, fingerprint, nonce]);

  useEffect(() => {
    if (!enabled) stopAnalysis();
  }, [enabled]);
}
