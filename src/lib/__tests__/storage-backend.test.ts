/**
 * The bottom half of the persistence seam: `StorageBackend` and its two
 * adapters. Everything above it (DeckStore, wizard state) is exercised through
 * the memory adapter, so these tests are the only place the real
 * `localStorage` adapter is pinned.
 *
 * The suite runs on the `node` environment and has no `localStorage`. The
 * adapter reads `globalThis.localStorage` lazily on every call precisely so it
 * can be installed for one test and removed again, which is what the
 * round-trip test below does.
 */
import { describe, it, expect, afterEach } from 'vitest'
import {
  localStorageBackend,
  memoryBackend,
  readJson,
  writeJson,
  storageBackend,
  setStorageBackend,
} from '../storage/backend'

/** Minimal Web Storage stand-in, installed per test rather than globally. */
function installFakeLocalStorage(): Map<string, string> {
  const store = new Map<string, string>()
  const fake = {
    get length() {
      return store.size
    },
    clear: () => store.clear(),
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    removeItem: (k: string) => void store.delete(k),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
  }
  Object.defineProperty(globalThis, 'localStorage', {
    value: fake,
    configurable: true,
    writable: true,
  })
  return store
}

function removeFakeLocalStorage(): void {
  Reflect.deleteProperty(globalThis as object, 'localStorage')
}

afterEach(() => {
  removeFakeLocalStorage()
  setStorageBackend(memoryBackend())
})

describe('memoryBackend', () => {
  it('round-trips a value', () => {
    const backend = memoryBackend()
    backend.write('k', 'v')
    expect(backend.read('k')).toBe('v')
  })

  it('reads an unwritten key as null', () => {
    expect(memoryBackend().read('missing')).toBeNull()
  })

  it('deletes a key', () => {
    const backend = memoryBackend()
    backend.write('k', 'v')
    backend.delete('k')
    expect(backend.read('k')).toBeNull()
  })

  it('deleting an absent key does not throw', () => {
    expect(() => memoryBackend().delete('never-existed')).not.toThrow()
  })

  it('two instances share nothing — this is what gives tests per-test reset', () => {
    const a = memoryBackend()
    const b = memoryBackend()
    a.write('k', 'from-a')
    expect(b.read('k')).toBeNull()
  })
})

describe('localStorageBackend', () => {
  it('round-trips through the real Web Storage API', () => {
    const store = installFakeLocalStorage()
    const backend = localStorageBackend()
    backend.write('k', 'v')
    expect(store.get('k')).toBe('v')
    expect(backend.read('k')).toBe('v')
    backend.delete('k')
    expect(backend.read('k')).toBeNull()
  })

  it('resolves globalThis.localStorage per call, not at construction', () => {
    const backend = localStorageBackend()
    expect(backend.read('k')).toBeNull()
    installFakeLocalStorage()
    backend.write('k', 'v')
    expect(backend.read('k')).toBe('v')
  })

  it('degrades to a no-op when there is no localStorage (server render)', () => {
    const backend = localStorageBackend()
    expect(() => backend.write('k', 'v')).not.toThrow()
    expect(() => backend.delete('k')).not.toThrow()
    expect(backend.read('k')).toBeNull()
  })

  it('swallows a throwing Web Storage — a full quota must not break the app', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        getItem: () => {
          throw new Error('denied')
        },
        setItem: () => {
          throw new Error('quota exceeded')
        },
        removeItem: () => {
          throw new Error('denied')
        },
      },
      configurable: true,
      writable: true,
    })
    const backend = localStorageBackend()
    expect(() => backend.write('k', 'v')).not.toThrow()
    expect(() => backend.delete('k')).not.toThrow()
    expect(backend.read('k')).toBeNull()
  })
})

describe('readJson / writeJson', () => {
  it('round-trips a structured value', () => {
    const backend = memoryBackend()
    writeJson(backend, 'k', { a: 1, b: ['x'] })
    expect(readJson(backend, 'k', null)).toEqual({ a: 1, b: ['x'] })
  })

  it('returns the fallback for an absent key', () => {
    expect(readJson(memoryBackend(), 'missing', 'fallback')).toBe('fallback')
  })

  it('returns the fallback for unparseable JSON instead of throwing', () => {
    const backend = memoryBackend()
    backend.write('k', 'not valid json {{{')
    expect(readJson(backend, 'k', 'fallback')).toBe('fallback')
  })

  it('returns the fallback for a stored null', () => {
    const backend = memoryBackend()
    backend.write('k', 'null')
    expect(readJson(backend, 'k', 'fallback')).toBe('fallback')
  })

  it('writing an unserializable value does not throw', () => {
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(() => writeJson(memoryBackend(), 'k', cyclic)).not.toThrow()
  })
})

describe('the active backend', () => {
  it('setStorageBackend swaps what storageBackend() returns', () => {
    const backend = memoryBackend()
    setStorageBackend(backend)
    expect(storageBackend()).toBe(backend)
  })
})
