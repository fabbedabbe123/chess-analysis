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

/** Returns false when the value could not be stored. */
export function storageSet(key: string, value: string): boolean {
  try {
    if (typeof localStorage === 'undefined') return false;
    localStorage.setItem(key, value);
    return true;
  } catch {
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
