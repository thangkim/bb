const LEGACY_STORAGE_PREFIX = "bb-my-tasks:";
const STORAGE_PREFIX = "bb-tomato:";

export function migrateLegacyStorageKeys(): void {
  try {
    const legacyKeys: string[] = [];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key !== null && key.startsWith(LEGACY_STORAGE_PREFIX)) {
        legacyKeys.push(key);
      }
    }
    for (const legacyKey of legacyKeys) {
      const value = window.localStorage.getItem(legacyKey);
      const key = `${STORAGE_PREFIX}${legacyKey.slice(LEGACY_STORAGE_PREFIX.length)}`;
      if (value !== null && window.localStorage.getItem(key) === null) {
        window.localStorage.setItem(key, value);
      }
      window.localStorage.removeItem(legacyKey);
    }
  } catch {}
}
