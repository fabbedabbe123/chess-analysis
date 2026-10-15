import { MAX_HISTORY, isGameRecord, type GameRecord } from '@/play/history';
import { storageGet, storageSet } from '@/utils/storage';
import { createStore, useStore } from './createStore';

const KEY = 'chess-analysis:play-history:v1';

export function parseHistory(text: string | null): GameRecord[] {
  if (text === null) return [];
  try {
    const raw = JSON.parse(text) as unknown;
    return Array.isArray(raw) ? raw.filter(isGameRecord) : [];
  } catch {
    return [];
  }
}

export const historyStore = createStore<{ records: GameRecord[]; saveFailed: boolean }>({ records: parseHistory(storageGet(KEY)), saveFailed: false });
export const useHistory = <S,>(sel: (s: { records: GameRecord[]; saveFailed: boolean }) => S): S => useStore(historyStore, sel);

function persist(): void {
  const ok = storageSet(KEY, JSON.stringify(historyStore.get().records));
  historyStore.set({ saveFailed: !ok });
}

export function addGameRecord(record: GameRecord): void {
  historyStore.set((s) => ({ records: [record, ...s.records.filter((r) => r.id !== record.id)].slice(0, MAX_HISTORY) }));
  persist();
}

export function attachReview(id: string, review: NonNullable<GameRecord['review']>): void {
  historyStore.set((s) => ({ records: s.records.map((r) => (r.id === id ? { ...r, review } : r)) }));
  persist();
}

export function clearHistory(): void {
  historyStore.set({ records: [] });
  persist();
}
