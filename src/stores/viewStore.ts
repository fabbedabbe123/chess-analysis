import { createStore, useStore } from './createStore';
import { gameStore } from './gameStore';
import { savedSessionStore } from './playStore';

export type View = 'home' | 'app';

/**
 * Start page or workspace. The workspace is opened straight away when there is something to continue
 * (a game with moves, or an unfinished game against Stockfish); otherwise the start page is shown.
 * `?workspace` in the address skips the start page (used by the automated tests).
 */
export function initialView(): View {
  try {
    if (typeof location !== 'undefined' && /[?&]workspace\b/.test(location.search)) return 'app';
  } catch {
    /* no location: fall through */
  }
  const tree = gameStore.get().tree;
  const hasGame = (tree.nodes[tree.rootId]?.children.length ?? 0) > 0;
  return hasGame || savedSessionStore.get().session !== null ? 'app' : 'home';
}

export const viewStore = createStore<{ view: View }>({ view: 'app' });
/** Called once at start-up, after the saved game has been restored. */
export const initView = (): void => viewStore.set({ view: initialView() });
export const useView = (): View => useStore(viewStore, (s) => s.view);
export const goHome = (): void => viewStore.set({ view: 'home' });
export const enterApp = (): void => viewStore.set({ view: 'app' });
