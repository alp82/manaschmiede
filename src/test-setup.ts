/**
 * Vitest setup for the node-only suite. The runner stays on the `node`
 * environment (the suite is pure logic and needs no DOM).
 *
 * This used to install a global `localStorage` polyfill, because the
 * persistence modules reached for `localStorage` directly. They go through
 * `StorageBackend` now (issue #29), so the polyfill is gone and every test
 * starts against a fresh in-memory backend instead — which is the per-test
 * reset the polyfill never had, and why no suite needs `localStorage.clear()`
 * in a `beforeEach` any more.
 *
 * A test that wants its own isolated store can build one directly with
 * `createInMemoryDeckStore()` and skip the installed backend entirely.
 */
import { beforeEach } from 'vitest'
import { memoryBackend, setStorageBackend } from './lib/storage/backend'

beforeEach(() => {
  setStorageBackend(memoryBackend())
})
