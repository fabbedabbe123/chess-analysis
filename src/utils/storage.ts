/**
 * localStorage that never throws. Browsers may throw on *access* (blocked cookies / privacy
 * modes) as well as on writes (quota), so every call is wrapped; the app then just works
 * without persistence.
 */
export function storageGet(key: string): string | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage.getItem(key);
  } catch {
    return null;
  }
}

let writeListener: ((key: string) => void) | null = null;
/** Lets the cloud sync notice which keys the app changed (one listener; null removes it). */
export function setStorageWriteListener(fn: ((key: string) => void) | null): void {
  writeListener = fn;
}

let failListener: ((key: string) => void) | null = null;
let lastFailAt = 0;
/** Called (at most once a minute) when a write fails, e.g. because the browser storage is full. */
export function setStorageFailListener(fn: ((key: string) => void) | null): void {
  failListener = fn;
}

/** Returns false when the value could not be stored. */
export function storageSet(key: string, value: string): boolean {
  try {
    if (typeof localStorage === 'undefined') return false;
    localStorage.setItem(key, value);
    writeListener?.(key);
    return true;
  } catch {
    const now = Date.now();
    if (failListener !== null && now - lastFailAt > 60_000) {
      lastFailAt = now;
      failListener(key);
    }
    return false;
  }
}

export function storageRemove(key: string): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(key);
  } catch {
    // ignore
  }
}
