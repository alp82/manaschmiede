/**
 * The bottom half of the persistence seam: where bytes go.
 *
 * Before this module, five localStorage keys across four owners each carried
 * their own `try` / `catch` and `JSON.parse` (issue #29). Two things were wrong
 * with that: the guards drifted, and nothing could be tested without a global
 * `localStorage` polyfill that no test could reset.
 *
 * `StorageBackend` is deliberately the smallest thing that fixes both — three
 * string operations, no JSON, no domain shapes. Serialization lives in
 * `readJson` / `writeJson`; the deck shapes live in `deck-store.ts`. Two
 * adapters implement it: `localStorageBackend` in the browser and
 * `memoryBackend` in tests, where a fresh instance per test is the reset.
 *
 * Every operation is total. A backend never throws, so no caller needs a guard:
 * a server render (no `localStorage`), a private-mode window (throws on read),
 * and a full quota (throws on write) all degrade to "this key has no value".
 */

export interface StorageBackend {
  read(key: string): string | null
  write(key: string, value: string): void
  delete(key: string): void
}

/**
 * The browser adapter.
 *
 * `globalThis.localStorage` is resolved on every call, not captured here. The
 * app server-renders, so a backend built at module scope would otherwise
 * capture "no storage" and stay broken for the life of the page.
 */
export function localStorageBackend(): StorageBackend {
  return {
    read(key) {
      try {
        return globalThis.localStorage?.getItem(key) ?? null
      } catch {
        return null
      }
    },
    write(key, value) {
      try {
        globalThis.localStorage?.setItem(key, value)
      } catch {
        // No storage, or the quota is full. Persistence is best-effort.
      }
    },
    delete(key) {
      try {
        globalThis.localStorage?.removeItem(key)
      } catch {
        // Same.
      }
    },
  }
}

/** The test adapter. Each call returns its own isolated storage. */
export function memoryBackend(): StorageBackend {
  const store = new Map<string, string>()
  return {
    read: (key) => store.get(key) ?? null,
    write: (key, value) => void store.set(key, value),
    delete: (key) => void store.delete(key),
  }
}

/**
 * Read a JSON value, falling back when the key is absent, unparseable, or
 * holds a literal `null`. Collapsing those three into one outcome is what lets
 * callers above the seam skip the guard entirely.
 */
export function readJson<T>(backend: StorageBackend, key: string, fallback: T): T {
  const raw = backend.read(key)
  if (raw === null) return fallback
  try {
    const parsed = JSON.parse(raw)
    return parsed === null ? fallback : (parsed as T)
  } catch {
    return fallback
  }
}

/** Write a JSON value. An unserializable value is dropped, never thrown. */
export function writeJson(backend: StorageBackend, key: string, value: unknown): void {
  let serialized: string
  try {
    serialized = JSON.stringify(value)
  } catch {
    return
  }
  backend.write(key, serialized)
}

// ─── The active backend ──────────────────────────────────────────────────────

/**
 * One installed backend for the whole app, rather than a backend threaded
 * through every hook and component. The browser never swaps it; the test setup
 * installs a fresh `memoryBackend()` before each test, which is what replaced
 * the un-resettable `MemoryStorage` polyfill in `src/test-setup.ts`.
 */
let active: StorageBackend = localStorageBackend()

export function storageBackend(): StorageBackend {
  return active
}

export function setStorageBackend(backend: StorageBackend): void {
  active = backend
}
