/**
 * Vitest setup for the node-only suite. The runner stays on the `node`
 * environment (the suite is pure logic and needs no DOM), but the
 * localStorage-backed persistence modules (deck-storage, deck-pending,
 * wizard-state) need a Web Storage stand-in. This is a minimal in-memory
 * localStorage polyfill — enough for getItem / setItem / removeItem / clear.
 */

class MemoryStorage implements Storage {
  private store = new Map<string, string>()

  get length(): number {
    return this.store.size
  }

  clear(): void {
    this.store.clear()
  }

  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null
  }

  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null
  }

  removeItem(key: string): void {
    this.store.delete(key)
  }

  setItem(key: string, value: string): void {
    this.store.set(key, String(value))
  }
}

if (typeof globalThis.localStorage === 'undefined') {
  globalThis.localStorage = new MemoryStorage()
}
