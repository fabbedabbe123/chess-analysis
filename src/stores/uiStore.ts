import type { Square } from '@/types/game';
import { createStore, useStore } from './createStore';

export type RightTab = 'engine' | 'review' | 'openings' | 'tactics' | 'puzzles' | 'play' | 'player' | 'learn' | 'strength';
export type MobileTab = 'board' | 'engine' | 'moves' | 'review' | 'openings' | 'tactics' | 'puzzles' | 'play' | 'player' | 'learn' | 'strength' | 'menu';
export type DialogId = 'import' | 'settings' | 'help' | 'account' | null;

export interface UiState {
  rightTab: RightTab;
  mobileTab: MobileTab;
  dialog: DialogId;
  /** Squares highlighted by the tactics panel. */
  tacticSquares: Square[];
  /** Incremented to force a fresh engine analysis of the current position. */
  reanalyzeNonce: number;
  /** Desktop/tablet: left column folded to a thin rail so the board can grow. */
  sidebarCollapsed: boolean;
  /** Moves list under the board folded to a thin bar so the board can grow. */
  movesCollapsed: boolean;
  /** A lesson (skill id) another panel wants the Learn tab to open; consumed by the Learn tab. */
  learnRequest: string | null;
  confirm: { message: string; confirmLabel: string; onConfirm: () => void } | null;
}

const COLLAPSE_KEY = 'chess-analysis:sidebar-collapsed:v2';
function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) !== '0'; // icon rail is the default
  } catch {
    return true;
  }
}
export function toggleSidebar(): void {
  const next = !uiStore.get().sidebarCollapsed;
  uiStore.set({ sidebarCollapsed: next });
  try {
    localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0');
  } catch {
    /* storage unavailable: the choice just isn't remembered */
  }
}

const MOVES_KEY = 'chess-analysis:moves-collapsed:v1';
function readMovesCollapsed(): boolean {
  try {
    return localStorage.getItem(MOVES_KEY) === '1';
  } catch {
    return false;
  }
}
export function toggleMoves(): void {
  const next = !uiStore.get().movesCollapsed;
  uiStore.set({ movesCollapsed: next });
  try {
    localStorage.setItem(MOVES_KEY, next ? '1' : '0');
  } catch {
    /* not remembered */
  }
}

export const uiStore = createStore<UiState>({
  rightTab: 'engine',
  mobileTab: 'board',
  dialog: null,
  tacticSquares: [],
  reanalyzeNonce: 0,
  sidebarCollapsed: readCollapsed(),
  movesCollapsed: readMovesCollapsed(),
  learnRequest: null,
  confirm: null,
});

export function useUi<S>(selector: (s: UiState) => S): S {
  return useStore(uiStore, selector);
}

export const openDialog = (dialog: DialogId) => uiStore.set({ dialog });
export const closeDialog = () => uiStore.set({ dialog: null });
export const setRightTab = (rightTab: RightTab) => uiStore.set({ rightTab });
export const setMobileTab = (mobileTab: MobileTab) => uiStore.set({ mobileTab });
export const setTacticSquares = (tacticSquares: Square[]) => uiStore.set({ tacticSquares });
export const requestReanalysis = () => uiStore.set((s) => ({ reanalyzeNonce: s.reanalyzeNonce + 1 }));

/** Ask before a destructive action (replaces the whole game). Runs `action` immediately when `needed` is false. */
export function confirmThen(needed: boolean, message: string, confirmLabel: string, action: () => void): void {
  if (!needed) {
    action();
    return;
  }
  uiStore.set({ confirm: { message, confirmLabel, onConfirm: action } });
}
export const dismissConfirm = () => uiStore.set({ confirm: null });

/** Jump to a lesson in the Learn tab. */
export function openLesson(skillId: string): void {
  uiStore.set({ learnRequest: skillId, rightTab: 'learn', mobileTab: 'learn' });
}
