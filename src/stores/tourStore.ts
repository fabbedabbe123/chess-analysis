import { createStore, useStore } from './createStore';

/**
 * The optional guided tour. step -1 = closed, 0 = the "want a tour?" offer, 1..n = spotlight steps,
 * and the last step is the "done" card. Whether the offer was already answered is remembered in localStorage.
 */
const SEEN_KEY = 'chess-analysis:tour-seen:v1';

export const tourStore = createStore<{ step: number }>({ step: -1 });
export const useTourStep = (): number => useStore(tourStore, (s) => s.step);

export function tourSeen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return true; // storage blocked: never nag
  }
}
export function markTourSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, '1');
  } catch {
    /* not remembered */
  }
}
/** Offer the tour once (first visit to the board). */
export function offerTourOnce(): void {
  if (!tourSeen() && tourStore.get().step < 0) tourStore.set({ step: 0 });
}
/** Start straight at step 1 (from Help or Settings). */
export function startTour(): void {
  markTourSeen();
  tourStore.set({ step: 1 });
}
export function setTourStep(step: number): void {
  tourStore.set({ step });
}
export function closeTour(): void {
  markTourSeen();
  tourStore.set({ step: -1 });
}
